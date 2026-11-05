import { api, ApiError } from '@/lib/api';
import { routes } from '@/lib/routes';
import { applyOps } from '@/lib/notes/ops';
import type { AppState, CanvasElement, PagePattern } from '@/lib/db/models';
import * as journal from './journal';

// One note's lifecycle on the client: load (cache first, then server, then
// replay unsynced local edits), save element-level changes, survive offline
// and reloads, and pick up changes made on other devices.
//
// Every local edit is written to the IndexedDB journal before it is sent, and
// leaves the journal only after the server confirms it. Ops are idempotent,
// so replaying a journal entry that did reach the server is harmless.

export interface PageSettings {
  background: '#ffffff' | '#000000';
  pattern: PagePattern | 'none';
}

export interface NoteData {
  id: string;
  title: string;
  elements: CanvasElement[];
  canvasSettings: PageSettings;
  appState: AppState;
  revision: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  thumbAt: number | null;
}

export type LoadStatus = 'loading' | 'ready' | 'missing' | 'trashed' | 'error' | 'signed-out';
export type SaveStatus = 'saved' | 'pending' | 'saving' | 'offline' | 'error';

export interface SyncSnapshot {
  load: LoadStatus;
  save: SaveStatus;
  /** Plain-language detail for error and offline states. */
  message: string | null;
  note: NoteData | null;
  /** Showing the offline copy; the server has not answered yet. */
  fromCache: boolean;
  lastSavedAt: number | null;
}

export interface LocalChange {
  upserts?: CanvasElement[];
  deletes?: string[];
  title?: string;
  canvasSettings?: PageSettings;
}

interface Batch {
  upserts: Map<string, CanvasElement>;
  deletes: Set<string>;
  title?: string;
  canvasSettings?: PageSettings;
}

const emptyBatch = (): Batch => ({ upserts: new Map(), deletes: new Set() });
const batchIsEmpty = (b: Batch) => !b.upserts.size && !b.deletes.size && b.title === undefined && !b.canvasSettings;

function mergeInto(target: Batch, change: LocalChange | Batch) {
  const ups = change.upserts instanceof Map ? change.upserts.values() : (change.upserts ?? []);
  const dels = change.deletes instanceof Set ? change.deletes.values() : (change.deletes ?? []);
  for (const el of ups) {
    target.upserts.set(el.id, el);
    target.deletes.delete(el.id);
  }
  for (const id of dels) {
    target.upserts.delete(id);
    target.deletes.add(id);
  }
  if (change.title !== undefined) target.title = change.title;
  if (change.canvasSettings) target.canvasSettings = change.canvasSettings;
}

const SAVE_DEBOUNCE_MS = 600;
const SAVE_MAX_WAIT_MS = 3000;
const JOURNAL_DEBOUNCE_MS = 120;
const POLL_MS = 30_000;

export class NoteSync {
  private snap: SyncSnapshot = { load: 'loading', save: 'saved', message: null, note: null, fromCache: false, lastSavedAt: null };
  private listeners = new Set<() => void>();
  private remoteListeners = new Set<(elements: CanvasElement[]) => void>();
  private pending = emptyBatch();
  private inflight: Batch | null = null;
  private inflightDone: Promise<void> | null = null;
  /**
   * Edits the server confirmed, by the revision that first included them. A
   * server copy read before they landed can still arrive afterwards; these are
   * applied on top of it so the page never loses ink that is already saved.
   */
  private confirmed: Array<{ revision: number; batch: Batch }> = [];
  private meta: { thumb?: string; appState?: AppState } = {};
  private baseRevision = 0;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private firstUnsavedAt = 0;
  private journalTimer: ReturnType<typeof setTimeout> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private retryDelay = 1000;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private cachedAt = 0;
  private disposed = false;

  constructor(readonly noteId: string) {}

  // ------------------------------------------------------------ store API (useSyncExternalStore)

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  getSnapshot = () => this.snap;

  /** Called when the server copy replaces what the editor shows (initial load or another device). */
  onRemote(fn: (elements: CanvasElement[]) => void) {
    this.remoteListeners.add(fn);
    return () => {
      this.remoteListeners.delete(fn);
    };
  }

  private set(patch: Partial<SyncSnapshot>) {
    this.snap = { ...this.snap, ...patch };
    for (const l of this.listeners) l();
  }

  // ------------------------------------------------------------ load

  async load() {
    const [cached, entry] = await Promise.all([journal.readCachedDoc(this.noteId), journal.readJournal(this.noteId)]);
    if (this.disposed) return;
    if (cached && this.snap.load === 'loading') {
      const base: NoteData = {
        id: cached.id, title: cached.title, elements: cached.elements,
        canvasSettings: cached.canvasSettings as PageSettings, appState: cached.appState ?? { viewX: 0, viewY: 0, zoom: 1 },
        revision: cached.revision, createdAt: cached.updatedAt, updatedAt: cached.updatedAt, deletedAt: null, thumbAt: null,
      };
      this.baseRevision = cached.revision;
      this.adoptJournal(entry, base);
      this.set({ load: 'ready', fromCache: true, note: this.compose(base) });
    }
    await this.fetchServer(entry);
    this.startPolling();
  }

  private serverCopy: NoteData | null = null;

  private compose(server: NoteData): NoteData {
    const all = emptyBatch();
    for (const c of this.confirmed) if (c.revision > server.revision) mergeInto(all, c.batch);
    if (this.inflight) mergeInto(all, this.inflight);
    mergeInto(all, this.pending);
    return {
      ...server,
      title: all.title ?? server.title,
      canvasSettings: all.canvasSettings ?? server.canvasSettings,
      elements: applyOps(server.elements, { upsert: [...all.upserts.values()], delete: [...all.deletes] }),
    };
  }

  /** Seed the pending batch from a journal entry found at load. */
  private adoptJournal(entry: journal.JournalEntry | journal.LegacyPending | null, server: NoteData) {
    if (!entry || !batchIsEmpty(this.pending)) return;
    if (journal.isLegacy(entry)) {
      // The previous app saved a whole copy. Same base revision: that copy is the
      // newer state. Different base: keep everything from both (never drop ink).
      const localIds = new Set(entry.elements.map((e) => e.id));
      mergeInto(this.pending, {
        upserts: entry.elements,
        deletes: entry.baseRevision === server.revision ? server.elements.filter((e) => !localIds.has(e.id)).map((e) => e.id) : [],
        title: entry.title && entry.title !== server.title ? entry.title : undefined,
      });
    } else {
      mergeInto(this.pending, { upserts: entry.upserts, deletes: entry.deletes, title: entry.title, canvasSettings: entry.canvasSettings as PageSettings | undefined });
    }
  }

  private async fetchServer(entry: journal.JournalEntry | journal.LegacyPending | null = null) {
    try {
      const server = await api<NoteData>(routes.api.note(this.noteId));
      if (this.disposed) return;
      this.serverCopy = server;
      // Revisions only grow; a copy older than our last confirmed save must not move us back.
      this.confirmed = this.confirmed.filter((c) => c.revision > server.revision);
      this.baseRevision = Math.max(server.revision, this.confirmed.at(-1)?.revision ?? 0);
      if (server.deletedAt) {
        this.set({ load: 'trashed', note: server, fromCache: false, message: null });
        return;
      }
      this.adoptJournal(entry, server);
      const composed = this.compose(server);
      const wasShowing = this.snap.note;
      this.set({ load: 'ready', fromCache: false, note: composed, message: this.snap.save === 'offline' ? null : this.snap.message });
      if (wasShowing) for (const l of this.remoteListeners) l(composed.elements);
      void journal.writeCachedDoc({ ...server, cachedAt: Date.now() });
      if (!batchIsEmpty(this.pending)) this.scheduleSave(0);
      else if (this.snap.save === 'offline') this.set({ save: 'saved', message: null });
    } catch (e) {
      if (this.disposed) return;
      const err = e as ApiError;
      if (err.status === 404) {
        void journal.deleteCachedDoc(this.noteId);
        this.set({ load: 'missing', note: null, message: 'This note doesn’t exist or isn’t yours.' });
      } else if (err.status === 401) {
        this.set({ load: this.snap.note ? this.snap.load : 'signed-out', save: this.snap.note ? 'error' : this.snap.save, message: err.message });
      } else if (this.snap.note) {
        // Keep working from the offline copy; saves resume when the server is back.
        this.set({ save: batchIsEmpty(this.pending) ? this.snap.save : 'offline', message: err.message });
        this.scheduleRetry(() => this.fetchServer());
      } else {
        this.set({ load: 'error', message: err.message });
      }
    }
  }

  /** Re-read the server copy (focus, another device, retry button). */
  async refresh() {
    if (this.inflight || this.snap.load === 'loading') return;
    await this.fetchServer();
  }

  private startPolling() {
    if (this.pollTimer || typeof window === 'undefined') return;
    this.pollTimer = setInterval(() => {
      if (document.visibilityState === 'visible' && !this.inflight && batchIsEmpty(this.pending)) void this.checkRemote();
    }, POLL_MS);
  }

  private async checkRemote() {
    try {
      const { notes } = await api<{ notes: Array<{ id: string; revision: number }> }>(routes.api.notes());
      const mine = notes.find((n) => n.id === this.noteId);
      if (mine && mine.revision > this.baseRevision) await this.fetchServer();
    } catch {
      /* next tick */
    }
  }

  // ------------------------------------------------------------ local edits

  applyLocal(change: LocalChange) {
    if (this.snap.load !== 'ready' || !this.snap.note) return;
    mergeInto(this.pending, change);
    const note = this.snap.note;
    this.set({
      save: this.snap.save === 'error' || this.snap.save === 'offline' ? this.snap.save : 'pending',
      note: {
        ...note,
        title: change.title ?? note.title,
        canvasSettings: change.canvasSettings ?? note.canvasSettings,
        elements: change.upserts || change.deletes ? applyOps(note.elements, { upsert: change.upserts, delete: change.deletes }) : note.elements,
      },
    });
    this.scheduleJournal();
    this.scheduleSave();
  }

  /** Non-edit data (thumbnail, view position) to send with the next save. */
  queueMeta(meta: { thumb?: string; appState?: AppState }) {
    Object.assign(this.meta, meta);
    if (batchIsEmpty(this.pending) && !this.inflight) this.scheduleSave(1500);
  }

  private journalEntry(): journal.JournalEntry | null {
    const all = emptyBatch();
    if (this.inflight) mergeInto(all, this.inflight);
    mergeInto(all, this.pending);
    if (batchIsEmpty(all)) return null;
    return {
      noteId: this.noteId, v: 2, baseRevision: this.baseRevision,
      upserts: [...all.upserts.values()], deletes: [...all.deletes],
      title: all.title, canvasSettings: all.canvasSettings, updatedAt: Date.now(),
    };
  }

  private scheduleJournal() {
    if (this.journalTimer) return;
    this.journalTimer = setTimeout(() => {
      this.journalTimer = null;
      void this.writeJournalNow();
    }, JOURNAL_DEBOUNCE_MS);
  }

  private writeJournalNow() {
    const entry = this.journalEntry();
    return entry ? journal.writeJournal(entry) : journal.clearJournal(this.noteId);
  }

  private scheduleSave(delay = SAVE_DEBOUNCE_MS) {
    if (this.disposed) return;
    const now = Date.now();
    if (!this.firstUnsavedAt) this.firstUnsavedAt = now;
    const wait = Math.max(0, Math.min(delay, SAVE_MAX_WAIT_MS - (now - this.firstUnsavedAt)));
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => void this.save(), wait);
  }

  private scheduleRetry(fn: () => void) {
    if (this.retryTimer || this.disposed) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      fn();
    }, this.retryDelay);
    this.retryDelay = Math.min(this.retryDelay * 2, 30_000);
  }

  /** Send everything pending now (Ctrl+S, retry button). */
  async save() {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = null;
    if (this.inflight || this.disposed || this.snap.load !== 'ready') return;
    const hasMeta = Object.keys(this.meta).length > 0;
    if (batchIsEmpty(this.pending) && !hasMeta) return;

    const batch = this.pending;
    const meta = this.meta;
    this.pending = emptyBatch();
    this.meta = {};
    this.inflight = batch;
    this.firstUnsavedAt = 0;
    const isEdit = !batchIsEmpty(batch);
    if (isEdit) this.set({ save: 'saving' });
    let done!: () => void;
    this.inflightDone = new Promise<void>((r) => (done = r));

    try {
      const res = await api<{ ok: true; revision: number }>(routes.api.note(this.noteId), {
        method: 'PATCH',
        json: this.body(batch, meta),
        timeoutMs: 20_000,
      });
      const otherDeviceWrote = isEdit && res.revision !== this.baseRevision + 1;
      this.baseRevision = res.revision;
      if (isEdit) this.confirmed = [...this.confirmed.slice(-31), { revision: res.revision, batch }];
      this.inflight = null;
      this.retryDelay = 1000;
      await this.writeJournalNow();
      const idle = batchIsEmpty(this.pending);
      this.set({
        save: idle ? 'saved' : 'pending',
        message: null,
        lastSavedAt: isEdit ? Date.now() : this.snap.lastSavedAt,
        note: this.snap.note && { ...this.snap.note, revision: res.revision },
      });
      if (!idle) this.scheduleSave(0);
      else if (Object.keys(this.meta).length) this.scheduleSave(1500); // queued while this save was out
      if (idle && otherDeviceWrote) void this.fetchServer();
      // Keep the offline copy close to what the server has (at most every 5 s).
      if (isEdit && this.snap.note && Date.now() - this.cachedAt > 5000) {
        this.cachedAt = Date.now();
        void journal.writeCachedDoc({ ...this.snap.note, cachedAt: this.cachedAt });
      }
    } catch (e) {
      const err = e as ApiError;
      // Put the batch back underneath anything newer; nothing is dropped.
      const back = emptyBatch();
      mergeInto(back, batch);
      mergeInto(back, this.pending);
      this.pending = back;
      // View position and thumbnail are only worth retrying when the failure was
      // the connection's; one the server refused must never hold edits back.
      if (err.transient) this.meta = { ...meta, ...this.meta };
      this.inflight = null;
      if (err.status === 410) {
        this.set({ load: 'trashed', message: null });
      } else if (err.transient) {
        this.set({ save: 'offline', message: err.message });
        this.scheduleRetry(() => void this.save());
      } else {
        this.set({ save: 'error', message: err.message });
      }
      void this.writeJournalNow();
    } finally {
      this.inflightDone = null;
      done();
    }
  }

  /** Save now, after any save already on its way (duplicate, history: they read the server copy). */
  async flush() {
    if (this.inflightDone) await this.inflightDone;
    await this.save();
  }

  private body(batch: Batch, meta: { thumb?: string; appState?: AppState }) {
    return {
      ...(batch.upserts.size || batch.deletes.size ? { ops: { upsert: [...batch.upserts.values()], delete: [...batch.deletes] } } : {}),
      ...(batch.title !== undefined ? { title: batch.title } : {}),
      ...(batch.canvasSettings ? { canvasSettings: batch.canvasSettings } : {}),
      ...meta,
    };
  }

  retry() {
    this.retryDelay = 1000;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    if (this.snap.load === 'error') {
      this.set({ load: 'loading', message: null });
      void this.load();
    } else void this.save();
  }

  /**
   * Page is going away: persist the journal now and try a keepalive save.
   * If the request doesn't make it, the journal replays on the next open.
   */
  flushOnHide(appState?: AppState) {
    if (appState) this.meta.appState = appState;
    void this.writeJournalNow();
    const all = emptyBatch();
    if (this.inflight) mergeInto(all, this.inflight);
    mergeInto(all, this.pending);
    if (batchIsEmpty(all) && !this.meta.appState) return;
    const body = JSON.stringify(this.body(all, { appState: this.meta.appState }));
    if (body.length > 60_000) return; // keepalive bodies are capped; the journal covers it
    try {
      void fetch(routes.api.note(this.noteId), { method: 'PATCH', keepalive: true, headers: { 'Content-Type': 'application/json' }, body }).catch(() => {});
    } catch {
      /* journal covers it */
    }
  }

  dispose() {
    // Leaving by any route (browser back included): nothing in the debounce window is dropped.
    if (!this.disposed && this.snap.load === 'ready') this.flushOnHide();
    this.disposed = true;
    for (const t of [this.saveTimer, this.journalTimer, this.retryTimer]) if (t) clearTimeout(t);
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.listeners.clear();
    this.remoteListeners.clear();
  }

  /** Last confirmed server copy (for export/version comparisons). */
  get server() {
    return this.serverCopy;
  }
}
