import type { CanvasElement, CanvasSettings } from '@/lib/db/models';

// Write-ahead journal and offline cache in IndexedDB.
//
// Same database the previous app used ('yoshik-notes'). Version 1 had one
// store, 'pending' (keyPath noteId), holding whole-note copies of unsynced
// edits; those entries are still read (see LegacyPending). Version 2 adds
// 'docs', the last server copy of each opened note, for instant open.
//
// Nothing here may block the UI: every call has a timeout, and if IndexedDB
// is unavailable (private mode, blocked upgrade) it falls back to memory.

const DB_NAME = 'yoshik-notes';
const DB_VERSION = 2;
const PENDING = 'pending';
const DOCS = 'docs';
const TIMEOUT_MS = 3000;

export interface JournalEntry {
  noteId: string;
  v: 2;
  /** Server revision these edits were made on top of. */
  baseRevision: number;
  /** Latest local copy of every element changed since the last confirmed save. */
  upserts: CanvasElement[];
  deletes: string[];
  title?: string;
  canvasSettings?: CanvasSettings;
  updatedAt: number;
}

/** What the previous app stored: a whole copy of the note's elements. */
export interface LegacyPending {
  noteId: string;
  elements: CanvasElement[];
  title: string;
  baseRevision: number;
  updatedAt: number;
}

export interface CachedDoc {
  id: string;
  title: string;
  elements: CanvasElement[];
  canvasSettings: CanvasSettings;
  appState?: { viewX: number; viewY: number; zoom: number };
  revision: number;
  updatedAt: string;
  cachedAt: number;
}

const memory = { [PENDING]: new Map<string, unknown>(), [DOCS]: new Map<string, unknown>() };
let dbPromise: Promise<IDBDatabase | null> | null = null;

function withTimeout<T>(p: Promise<T>, fallback: T): Promise<T> {
  return Promise.race([p, new Promise<T>((r) => setTimeout(() => r(fallback), TIMEOUT_MS))]);
}

function open(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  dbPromise ??= withTimeout(
    new Promise<IDBDatabase | null>((resolve) => {
      let req: IDBOpenDBRequest;
      try {
        req = indexedDB.open(DB_NAME, DB_VERSION);
      } catch {
        return resolve(null);
      }
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(PENDING)) db.createObjectStore(PENDING, { keyPath: 'noteId' });
        if (!db.objectStoreNames.contains(DOCS)) db.createObjectStore(DOCS, { keyPath: 'id' });
      };
      req.onsuccess = () => {
        const db = req.result;
        // Let a newer tab upgrade instead of being blocked by this one.
        db.onversionchange = () => {
          db.close();
          dbPromise = null;
        };
        resolve(db);
      };
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    }),
    null,
  );
  return dbPromise;
}

async function run<T>(store: typeof PENDING | typeof DOCS, mode: IDBTransactionMode, op: (s: IDBObjectStore) => IDBRequest<T> | void, memOp: () => T): Promise<T> {
  const db = await open();
  if (!db) return memOp();
  try {
    return await withTimeout(
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(store, mode);
        const req = op(tx.objectStore(store));
        tx.oncomplete = () => resolve(req ? (req.result as T) : (undefined as T));
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      }),
      memOp(),
    );
  } catch {
    return memOp();
  }
}

export function readJournal(noteId: string): Promise<JournalEntry | LegacyPending | null> {
  return run(PENDING, 'readonly', (s) => s.get(noteId), () => (memory[PENDING].get(noteId) as JournalEntry) ?? null).then((v) => v ?? null);
}

export function writeJournal(entry: JournalEntry): Promise<void> {
  memory[PENDING].set(entry.noteId, entry);
  return run(PENDING, 'readwrite', (s) => void s.put(entry), () => undefined);
}

export function clearJournal(noteId: string): Promise<void> {
  memory[PENDING].delete(noteId);
  return run(PENDING, 'readwrite', (s) => void s.delete(noteId), () => undefined);
}

export function readCachedDoc(noteId: string): Promise<CachedDoc | null> {
  return run(DOCS, 'readonly', (s) => s.get(noteId), () => (memory[DOCS].get(noteId) as CachedDoc) ?? null).then((v) => v ?? null);
}

export function writeCachedDoc(doc: CachedDoc): Promise<void> {
  memory[DOCS].set(doc.id, doc);
  return run(DOCS, 'readwrite', (s) => void s.put(doc), () => undefined);
}

export function deleteCachedDoc(noteId: string): Promise<void> {
  memory[DOCS].delete(noteId);
  return run(DOCS, 'readwrite', (s) => void s.delete(noteId), () => undefined);
}

export function isLegacy(entry: JournalEntry | LegacyPending): entry is LegacyPending {
  return (entry as JournalEntry).v !== 2 && Array.isArray((entry as LegacyPending).elements);
}
