import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/db/mongo';
import { newNote, type CanvasElement, type NoteDoc } from '@/lib/db/models';
import { HttpError } from '@/lib/http';
import { nanoid } from '@/lib/id';

// The notes store: every read and write of a note goes through here, scoped
// to its owner. Routes stay thin; ownership, validation and revisions live here.

const notes = async () => (await getDb()).collection<NoteDoc>('notes');

export function parseId(id: string): ObjectId {
  try {
    return new ObjectId(id);
  } catch {
    throw new HttpError(400, { error: 'Invalid id' });
  }
}

function serialize(note: NoteDoc) {
  return {
    id: note._id!.toString(),
    title: note.title,
    elements: note.elements,
    appState: note.appState,
    canvasSettings: note.canvasSettings,
    revision: note.revision,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
  };
}

export async function listNotes(owner: string) {
  const docs = await (await notes())
    .find({ ownerId: owner })
    .project<NoteDoc>({ elements: 0, appState: 0 })
    .sort({ updatedAt: -1 })
    .toArray();
  return docs.map((n) => ({
    id: n._id!.toString(),
    title: n.title,
    updatedAt: n.updatedAt,
    createdAt: n.createdAt,
    revision: n.revision,
  }));
}

export async function createNote(owner: string, rawTitle: unknown) {
  let title = 'Untitled';
  if (typeof rawTitle === 'string' && rawTitle.trim()) title = rawTitle.trim().slice(0, 200);
  const result = await (await notes()).insertOne(newNote(owner, title));
  return { id: result.insertedId.toString(), title };
}

async function findOwned(owner: string, oid: ObjectId) {
  const note = await (await notes()).findOne({ _id: oid, ownerId: owner });
  if (!note) throw new HttpError(404, { error: 'Not found' });
  return note;
}

export async function getNote(owner: string, oid: ObjectId) {
  return serialize(await findOwned(owner, oid));
}

export interface NotePatch {
  title?: string;
  elements?: CanvasElement[];
  appState?: NoteDoc['appState'];
  canvasSettings?: NoteDoc['canvasSettings'];
  baseRevision?: number;
}

export async function updateNote(owner: string, oid: ObjectId, body: NotePatch) {
  if (JSON.stringify(body).length > 5_000_000) {
    throw new HttpError(413, { error: 'Payload too large (5MB max)' });
  }
  const existing = await findOwned(owner, oid);
  if (typeof body.baseRevision === 'number' && body.baseRevision !== existing.revision) {
    throw new HttpError(409, { error: 'Conflict', serverRevision: existing.revision });
  }

  const update: Partial<NoteDoc> = { updatedAt: new Date(), revision: existing.revision + 1 };
  if (typeof body.title === 'string') update.title = body.title.slice(0, 200);
  if (Array.isArray(body.elements)) {
    for (const el of body.elements) {
      if (!el || typeof el.id !== 'string' || typeof el.type !== 'string') {
        throw new HttpError(400, { error: 'Invalid element data' });
      }
    }
    update.elements = body.elements;
  }
  if (body.appState) update.appState = body.appState;
  if (body.canvasSettings) update.canvasSettings = body.canvasSettings;

  await (await notes()).updateOne({ _id: oid }, { $set: update });
  return { ok: true as const, revision: update.revision! };
}

export async function deleteNote(owner: string, oid: ObjectId) {
  const result = await (await notes()).deleteOne({ _id: oid, ownerId: owner });
  if (result.deletedCount === 0) throw new HttpError(404, { error: 'Not found' });
}

export async function duplicateNote(owner: string, oid: ObjectId) {
  const note = await findOwned(owner, oid);
  const now = new Date();
  const copy: Omit<NoteDoc, '_id'> = {
    ownerId: owner,
    title: `${note.title} (copy)`,
    elements: JSON.parse(JSON.stringify(note.elements)),
    appState: { ...note.appState },
    canvasSettings: { ...note.canvasSettings },
    revision: 1,
    createdAt: now,
    updatedAt: now,
  };
  // Fresh element ids so the copy is independent of the original.
  for (const el of copy.elements) el.id = nanoid();
  const result = await (await notes()).insertOne(copy);
  return { id: result.insertedId.toString(), title: copy.title };
}
