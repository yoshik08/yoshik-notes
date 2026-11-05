import { Binary, ObjectId, type Db, type Document } from 'mongodb';
import { getDb } from '@/lib/db/mongo';
import {
  newNote,
  type AppState,
  type CanvasElement,
  type CanvasSettings,
  type NoteDoc,
  type NoteVersionDoc,
  type PagePattern,
} from '@/lib/db/models';
import { HttpError } from '@/lib/http';
import { nanoid } from '@/lib/id';
import { checkElement, checkElements } from '@/lib/notes/validate';
import type { ElementOps } from '@/lib/notes/ops';

// The notes store: every read and write of a note goes through here, scoped
// to its owner. Writes never destroy data outright: deletes go to Recently
// deleted, and ink that a save would overwrite is snapshotted first.

const VERSION_EVERY_MS = 15 * 60_000;
const KEEP_VERSIONS = 10; // plus the note's first snapshot, which is kept for good
const TRASH_DAYS = 30;
const MAX_ELEMENTS_BYTES = 12_000_000; // under MongoDB's 16 MB document limit
const MAX_THUMB_BYTES = 96_000;
const PATTERNS = new Set<string>(['dots', 'grid', 'ruled']);

let indexes: Promise<unknown> | null = null;
function ensureIndexes(db: Db) {
  // Idempotent; never blocks a request and never fails one.
  indexes ??= Promise.all([
    db.collection('notes').createIndex({ ownerId: 1, updatedAt: -1 }),
    db.collection('notes').createIndex({ ownerId: 1, deletedAt: -1 }),
    db.collection('note_versions').createIndex({ noteId: 1, createdAt: -1 }),
    db.collection('note_versions').createIndex({ noteId: 1 }, { unique: true, partialFilterExpression: { reason: 'original' } }),
  ]).catch((e) => {
    indexes = null;
    console.error('[notes] index creation failed', e);
  });
}

async function collections() {
  const db = await getDb();
  ensureIndexes(db);
  return {
    notes: db.collection<NoteDoc>('notes'),
    versions: db.collection<NoteVersionDoc>('note_versions'),
  };
}

export function parseId(id: string): ObjectId {
  try {
    return new ObjectId(id);
  } catch {
    throw new HttpError(400, { error: 'Invalid id' });
  }
}

/** Old notes stored a pattern name as the background; read both shapes. */
export function normalizeSettings(raw: Partial<CanvasSettings> | undefined | null): Required<Pick<CanvasSettings, 'background'>> & { pattern: PagePattern | 'none' } {
  const bg = raw?.background;
  if (bg && PATTERNS.has(bg)) return { background: '#ffffff', pattern: bg as PagePattern };
  const pattern = raw?.pattern && PATTERNS.has(raw.pattern) ? (raw.pattern as PagePattern) : 'none';
  return { background: bg === '#000000' ? '#000000' : '#ffffff', pattern };
}

function serialize(note: NoteDoc) {
  return {
    id: note._id!.toString(),
    title: typeof note.title === 'string' ? note.title : 'Untitled',
    elements: Array.isArray(note.elements) ? note.elements : [],
    appState: note.appState ?? { viewX: 0, viewY: 0, zoom: 1 },
    canvasSettings: normalizeSettings(note.canvasSettings),
    revision: note.revision ?? 1,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
    deletedAt: note.deletedAt ?? null,
    thumbAt: note.thumbAt ? note.thumbAt.getTime() : null,
  };
}

const isArray = (path: string) => ({ $isArray: path });
const elementsOrEmpty = { $cond: [isArray('$elements'), '$elements', []] };

/** Summaries for the library: no element payloads, counts and text computed in the database. */
export async function listNotes(owner: string, opts: { trash?: boolean } = {}) {
  const { notes } = await collections();
  if (opts.trash) await purgeExpired(owner);
  const docs = await notes
    .aggregate<Document>([
      { $match: opts.trash ? { ownerId: owner, deletedAt: { $ne: null } } : { ownerId: owner, deletedAt: null } },
      { $sort: opts.trash ? { deletedAt: -1 } : { updatedAt: -1 } },
      {
        $project: {
          title: 1, createdAt: 1, updatedAt: 1, revision: 1, deletedAt: 1, thumbAt: 1, canvasSettings: 1,
          elementCount: { $size: elementsOrEmpty },
          text: {
            $substrCP: [
              {
                $reduce: {
                  input: { $filter: { input: elementsOrEmpty, as: 'e', cond: { $eq: ['$$e.type', 'text'] } } },
                  initialValue: '',
                  in: { $concat: ['$$value', ' ', { $cond: [{ $eq: [{ $type: '$$this.text' }, 'string'] }, '$$this.text', ''] }] },
                },
              },
              0,
              400,
            ],
          },
        },
      },
    ])
    .toArray();
  return docs.map((n) => ({
    id: String(n._id),
    title: typeof n.title === 'string' ? n.title : 'Untitled',
    updatedAt: n.updatedAt,
    createdAt: n.createdAt,
    revision: n.revision ?? 1,
    elementCount: n.elementCount as number,
    text: (n.text as string).trim(),
    ...normalizeSettings(n.canvasSettings),
    thumbAt: n.thumbAt instanceof Date ? n.thumbAt.getTime() : null,
    deletedAt: n.deletedAt ?? null,
  }));
}

export async function createNote(owner: string, rawTitle: unknown) {
  let title = 'Untitled';
  if (typeof rawTitle === 'string' && rawTitle.trim()) title = rawTitle.trim().slice(0, 200);
  const { notes } = await collections();
  const result = await notes.insertOne(newNote(owner, title));
  return { id: result.insertedId.toString(), title };
}

async function findOwned(owner: string, oid: ObjectId) {
  const { notes } = await collections();
  const note = await notes.findOne({ _id: oid, ownerId: owner });
  if (!note) throw new HttpError(404, { error: 'Not found' });
  return note;
}

export async function getNote(owner: string, oid: ObjectId) {
  return serialize(await findOwned(owner, oid));
}

// ---------------------------------------------------------------- updates

export interface NotePatch {
  title?: unknown;
  elements?: unknown;
  ops?: unknown;
  appState?: unknown;
  canvasSettings?: unknown;
  baseRevision?: unknown;
  thumb?: unknown;
}

function parseOps(raw: unknown): ElementOps {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new HttpError(400, { error: 'Invalid ops' });
  const ops = raw as Record<string, unknown>;
  const upsert = ops.upsert ?? [];
  const del = ops.delete ?? [];
  if (!Array.isArray(upsert) || !Array.isArray(del) || !del.every((id) => typeof id === 'string')) {
    throw new HttpError(400, { error: 'Invalid ops' });
  }
  for (const el of upsert) {
    const problem = checkElement(el);
    if (problem) throw new HttpError(400, { error: 'Invalid element data', detail: problem });
  }
  return { upsert: upsert as CanvasElement[], delete: del as string[] };
}

function parseAppState(raw: unknown): AppState {
  const a = raw as Partial<AppState> | null;
  const ok = a && [a.viewX, a.viewY, a.zoom].every((v) => typeof v === 'number' && Number.isFinite(v)) && a.zoom! > 0;
  if (!ok) throw new HttpError(400, { error: 'Invalid appState' });
  return { viewX: a!.viewX!, viewY: a!.viewY!, zoom: a!.zoom! };
}

function parseSettings(raw: unknown): CanvasSettings {
  const s = raw as Partial<CanvasSettings> | null;
  const bgOk = s && (s.background === '#ffffff' || s.background === '#000000' || PATTERNS.has(String(s.background)));
  const patternOk = s && (s.pattern === undefined || s.pattern === 'none' || PATTERNS.has(String(s.pattern)));
  if (!bgOk || !patternOk) throw new HttpError(400, { error: 'Invalid canvasSettings' });
  return s.pattern === undefined ? { background: s.background! } : { background: s.background!, pattern: s.pattern };
}

function parseThumb(raw: unknown) {
  const m = typeof raw === 'string' && /^data:(image\/(?:webp|jpeg|png));base64,([A-Za-z0-9+/=]+)$/.exec(raw);
  if (!m) throw new HttpError(400, { error: 'Invalid thumb' });
  const bytes = Buffer.from(m[2], 'base64');
  if (bytes.length > MAX_THUMB_BYTES) throw new HttpError(413, { error: 'Thumbnail too large' });
  return { thumb: new Binary(bytes), thumbType: m[1], thumbAt: new Date() };
}

/** Save a note's current state as a version (the first one ever is its kept 'original'). */
async function snapshot(note: NoteDoc, reason: NoteVersionDoc['reason']) {
  if (!Array.isArray(note.elements) || note.elements.length === 0) return;
  const { versions } = await collections();
  const last = await versions.find({ noteId: note._id! }).sort({ createdAt: -1 }).limit(1).project({ createdAt: 1 }).next();
  try {
    await versions.insertOne({
      noteId: note._id!,
      ownerId: note.ownerId,
      revision: note.revision,
      title: note.title,
      elements: note.elements,
      canvasSettings: note.canvasSettings,
      createdAt: new Date(),
      reason: last ? reason : 'original',
    });
  } catch (e) {
    // Two first-saves racing: the unique index keeps exactly one 'original'.
    if ((e as { code?: number }).code !== 11000) throw e;
  }
  const extra = await versions
    .find({ noteId: note._id!, reason: { $ne: 'original' } })
    .sort({ createdAt: -1 })
    .skip(KEEP_VERSIONS)
    .project({ _id: 1 })
    .toArray();
  if (extra.length) await versions.deleteMany({ _id: { $in: extra.map((v) => v._id) } });
}

/** Before ink is overwritten: snapshot at most every VERSION_EVERY_MS, reading the full note only when due. */
async function snapshotIfDue(owner: string, oid: ObjectId) {
  const { notes, versions } = await collections();
  const last = await versions.find({ noteId: oid }).sort({ createdAt: -1 }).limit(1).project({ createdAt: 1 }).next();
  if (last && Date.now() - (last.createdAt as Date).getTime() < VERSION_EVERY_MS) return;
  const note = await notes.findOne({ _id: oid, ownerId: owner, deletedAt: null }, { projection: { thumb: 0 } });
  if (note) await snapshot(note, 'autosave');
}

const storedElements = { $cond: [{ $isArray: '$elements' }, '$elements', []] };

/**
 * Element ops as one atomic pipeline update, so concurrent saves from several
 * devices merge instead of racing: deletes win, upserts replace in place, new
 * ones append. User data is wrapped in $literal so it is never read as an expression.
 */
function opsExpression(ops: ElementOps) {
  const deleted = ops.delete ?? [];
  const upserts = (ops.upsert ?? []).filter((e) => !deleted.includes(e.id));
  const upsertIds = upserts.map((e) => e.id);
  return {
    $concatArrays: [
      {
        $map: {
          input: { $filter: { input: storedElements, as: 'e', cond: { $not: [{ $in: ['$$e.id', { $literal: deleted }] }] } } },
          as: 'e',
          in: {
            $let: {
              vars: { i: { $indexOfArray: [{ $literal: upsertIds }, '$$e.id'] } },
              in: { $cond: [{ $gte: ['$$i', 0] }, { $arrayElemAt: [{ $literal: upserts }, '$$i'] }, '$$e'] },
            },
          },
        },
      },
      {
        $filter: {
          input: { $literal: upserts },
          as: 'u',
          cond: { $not: [{ $in: ['$$u.id', { $map: { input: storedElements, as: 's', in: '$$s.id' } }] }] },
        },
      },
    ],
  };
}

export async function updateNote(owner: string, oid: ObjectId, body: unknown) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, { error: 'Invalid JSON body' });
  const patch = body as NotePatch;
  if (JSON.stringify(patch).length > 5_000_000) throw new HttpError(413, { error: 'Payload too large (5MB max)' });

  // Validate everything before touching the database.
  const replacing = Array.isArray(patch.elements);
  if (replacing) {
    const problem = checkElements(patch.elements as unknown[]);
    if (problem) throw new HttpError(400, { error: 'Invalid element data', detail: problem });
    if (JSON.stringify(patch.elements).length > MAX_ELEMENTS_BYTES) {
      throw new HttpError(413, { error: 'This note is too large to save. Move some of it into a new note.' });
    }
  }
  const ops = !replacing && patch.ops !== undefined ? parseOps(patch.ops) : null;
  const title = typeof patch.title === 'string' ? patch.title.slice(0, 200) : undefined;
  const settings = patch.canvasSettings !== undefined ? parseSettings(patch.canvasSettings) : undefined;
  const meta: Partial<NoteDoc> = {};
  if (patch.appState !== undefined) meta.appState = parseAppState(patch.appState);
  if (patch.thumb !== undefined) Object.assign(meta, parseThumb(patch.thumb));

  const { notes } = await collections();
  // View position and thumbnails are not edits: they never bump the revision or reorder the library.
  const isEdit = replacing || ops !== null || title !== undefined || settings !== undefined;
  if (!isEdit) {
    if (Object.keys(meta).length === 0) return { ok: true as const, revision: (await findLive(owner, oid)).revision };
    const res = await notes.findOneAndUpdate({ _id: oid, ownerId: owner, deletedAt: null }, { $set: meta }, { projection: { revision: 1 } });
    if (!res) await explainMiss(owner, oid);
    return { ok: true as const, revision: res!.revision };
  }

  if (replacing || ops) await snapshotIfDue(owner, oid);

  const set: Record<string, unknown> = { revision: { $add: ['$revision', 1] }, updatedAt: '$$NOW' };
  if (title !== undefined) set.title = { $literal: title };
  if (settings) set.canvasSettings = { $literal: settings };
  if (replacing) set.elements = { $literal: patch.elements };
  else if (ops) set.elements = opsExpression(ops);
  for (const [k, v] of Object.entries(meta)) set[k] = { $literal: v };

  const filter: Record<string, unknown> = { _id: oid, ownerId: owner, deletedAt: null };
  if (replacing && typeof patch.baseRevision === 'number') filter.revision = patch.baseRevision;
  let updated: NoteDoc | null;
  try {
    updated = await notes.findOneAndUpdate(filter, [{ $set: set }], { projection: { revision: 1 }, returnDocument: 'after' });
  } catch (e) {
    if (/too large|BSONObjectTooLarge|10334/.test(String((e as Error).message) + (e as { code?: number }).code)) {
      throw new HttpError(413, { error: 'This note is too large to save. Move some of it into a new note.' });
    }
    throw e;
  }
  if (!updated) {
    const live = await explainMiss(owner, oid);
    throw new HttpError(409, { error: 'Conflict', serverRevision: live.revision });
  }
  return { ok: true as const, revision: updated.revision };
}

/** The live (not deleted) note, or the precise reason it isn't writable. */
async function findLive(owner: string, oid: ObjectId) {
  const note = await findOwned(owner, oid);
  if (note.deletedAt) throw new HttpError(410, { error: 'This note is in Recently deleted', deletedAt: note.deletedAt });
  return note;
}

/** After a write matched nothing: 404, 410, or (the caller's) revision conflict. */
async function explainMiss(owner: string, oid: ObjectId) {
  return findLive(owner, oid);
}

// ---------------------------------------------------------------- trash

export async function trashNote(owner: string, oid: ObjectId) {
  const { notes } = await collections();
  const res = await notes.updateOne({ _id: oid, ownerId: owner, deletedAt: null }, { $set: { deletedAt: new Date() } });
  if (res.matchedCount === 0) throw new HttpError(404, { error: 'Not found' });
}

export async function restoreNote(owner: string, oid: ObjectId) {
  const { notes } = await collections();
  const res = await notes.updateOne({ _id: oid, ownerId: owner, deletedAt: { $ne: null } }, { $set: { deletedAt: null } });
  if (res.matchedCount === 0) throw new HttpError(404, { error: 'Not found' });
}

/** Permanent delete, only for notes already in Recently deleted. */
export async function purgeNote(owner: string, oid: ObjectId) {
  const { notes, versions } = await collections();
  const res = await notes.deleteOne({ _id: oid, ownerId: owner, deletedAt: { $ne: null } });
  if (res.deletedCount === 0) throw new HttpError(404, { error: 'Not found' });
  await versions.deleteMany({ noteId: oid, ownerId: owner });
}

async function purgeExpired(owner: string) {
  const { notes, versions } = await collections();
  const cutoff = new Date(Date.now() - TRASH_DAYS * 86_400_000);
  const expired = await notes.find({ ownerId: owner, deletedAt: { $lt: cutoff } }).project({ _id: 1 }).toArray();
  if (!expired.length) return;
  const ids = expired.map((n) => n._id);
  await notes.deleteMany({ _id: { $in: ids }, ownerId: owner });
  await versions.deleteMany({ noteId: { $in: ids }, ownerId: owner });
}

// ---------------------------------------------------------------- copies, thumbs, versions

export async function duplicateNote(owner: string, oid: ObjectId) {
  const note = await findOwned(owner, oid);
  const now = new Date();
  const copy: Omit<NoteDoc, '_id'> = {
    ownerId: owner,
    title: `${note.title} (copy)`,
    elements: JSON.parse(JSON.stringify(Array.isArray(note.elements) ? note.elements : [])),
    appState: { ...(note.appState ?? { viewX: 0, viewY: 0, zoom: 1 }) },
    canvasSettings: { ...(note.canvasSettings ?? { background: '#ffffff' }) },
    revision: 1,
    createdAt: now,
    updatedAt: now,
    ...(note.thumb ? { thumb: note.thumb, thumbType: note.thumbType, thumbAt: now } : {}),
  };
  // Fresh element ids so the copy is independent of the original.
  for (const el of copy.elements) el.id = nanoid();
  const { notes } = await collections();
  const result = await notes.insertOne(copy);
  return { id: result.insertedId.toString(), title: copy.title };
}

export async function getThumb(owner: string, oid: ObjectId) {
  const { notes } = await collections();
  const n = await notes.findOne({ _id: oid, ownerId: owner }, { projection: { thumb: 1, thumbType: 1 } });
  if (!n?.thumb) throw new HttpError(404, { error: 'No thumbnail' });
  const bytes = n.thumb instanceof Binary ? n.thumb.buffer : n.thumb;
  return { bytes: new Uint8Array(bytes), type: n.thumbType ?? 'image/webp' };
}

export async function listVersions(owner: string, oid: ObjectId) {
  await findOwned(owner, oid);
  const { versions } = await collections();
  const docs = await versions
    .aggregate<Document>([
      { $match: { noteId: oid, ownerId: owner } },
      { $sort: { createdAt: -1 } },
      { $project: { revision: 1, title: 1, createdAt: 1, reason: 1, elementCount: { $size: elementsOrEmpty } } },
    ])
    .toArray();
  return docs.map((v) => ({
    id: String(v._id),
    revision: v.revision,
    title: v.title,
    createdAt: v.createdAt,
    reason: v.reason,
    elementCount: v.elementCount,
  }));
}

export async function getVersion(owner: string, oid: ObjectId, vid: ObjectId) {
  const { versions } = await collections();
  const v = await versions.findOne({ _id: vid, noteId: oid, ownerId: owner });
  if (!v) throw new HttpError(404, { error: 'Version not found' });
  return {
    id: v._id!.toString(),
    revision: v.revision,
    title: v.title,
    createdAt: v.createdAt,
    reason: v.reason,
    elements: v.elements,
    canvasSettings: normalizeSettings(v.canvasSettings),
  };
}

export async function restoreVersion(owner: string, oid: ObjectId, vid: ObjectId) {
  const { notes, versions } = await collections();
  const v = await versions.findOne({ _id: vid, noteId: oid, ownerId: owner });
  if (!v) throw new HttpError(404, { error: 'Version not found' });
  const existing = await findOwned(owner, oid);
  if (existing.deletedAt) throw new HttpError(410, { error: 'This note is in Recently deleted' });
  await snapshot(existing, 'restore');
  const revision = existing.revision + 1;
  const res = await notes.updateOne(
    { _id: oid, ownerId: owner, revision: existing.revision },
    {
      $set: { elements: v.elements, title: v.title, canvasSettings: v.canvasSettings, revision, updatedAt: new Date() },
      $unset: { thumb: '', thumbType: '', thumbAt: '' },
    },
  );
  if (res.matchedCount === 0) throw new HttpError(409, { error: 'Conflict', serverRevision: existing.revision });
  return { ok: true as const, revision };
}
