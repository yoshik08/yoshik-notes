import { getDb } from '@/lib/db/mongo';
import type { NoteDoc, CanvasElement } from '@/lib/db/models';
import { requireAuth, unauthorized } from '@/lib/auth/require-auth';
import { ObjectId } from 'mongodb';

function toId(id: string): ObjectId | null {
  try {
    return new ObjectId(id);
  } catch {
    return null;
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

// GET /api/notes/:id — get a single note (ownership enforced)
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  let googleId: string;
  try {
    googleId = await requireAuth();
  } catch {
    return unauthorized();
  }
  const { id } = await params;
  const oid = toId(id);
  if (!oid) return Response.json({ error: 'Invalid id' }, { status: 400 });
  const db = await getDb();
  const note = await db.collection<NoteDoc>('notes').findOne({ _id: oid, ownerId: googleId });
  if (!note) return Response.json({ error: 'Not found' }, { status: 404 });
  return Response.json(serialize(note));
}

// PATCH /api/notes/:id — update note (title, elements, appState, canvasSettings)
// Requires If-Match revision for conflict detection (optional).
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  let googleId: string;
  try {
    googleId = await requireAuth();
  } catch {
    return unauthorized();
  }
  const { id } = await params;
  const oid = toId(id);
  if (!oid) return Response.json({ error: 'Invalid id' }, { status: 400 });

  let body: {
    title?: string;
    elements?: CanvasElement[];
    appState?: NoteDoc['appState'];
    canvasSettings?: NoteDoc['canvasSettings'];
    baseRevision?: number;
  };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  // Basic payload limits
  const bodySize = JSON.stringify(body).length;
  if (bodySize > 5_000_000) {
    return Response.json({ error: 'Payload too large (5MB max)' }, { status: 413 });
  }

  const db = await getDb();
  const existing = await db.collection<NoteDoc>('notes').findOne({ _id: oid, ownerId: googleId });
  if (!existing) return Response.json({ error: 'Not found' }, { status: 404 });

  // Conflict detection
  if (typeof body.baseRevision === 'number' && body.baseRevision !== existing.revision) {
    return Response.json(
      { error: 'Conflict', serverRevision: existing.revision },
      { status: 409 }
    );
  }

  const update: Partial<NoteDoc> = { updatedAt: new Date(), revision: existing.revision + 1 };
  if (typeof body.title === 'string') update.title = body.title.slice(0, 200);
  if (Array.isArray(body.elements)) {
    // Validate elements are objects with id and type
    for (const el of body.elements) {
      if (!el || typeof el.id !== 'string' || typeof el.type !== 'string') {
        return Response.json({ error: 'Invalid element data' }, { status: 400 });
      }
    }
    update.elements = body.elements;
  }
  if (body.appState) update.appState = body.appState;
  if (body.canvasSettings) update.canvasSettings = body.canvasSettings;

  await db.collection<NoteDoc>('notes').updateOne({ _id: oid }, { $set: update });
  return Response.json({ ok: true, revision: update.revision });
}

// DELETE /api/notes/:id — delete note
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  let googleId: string;
  try {
    googleId = await requireAuth();
  } catch {
    return unauthorized();
  }
  const { id } = await params;
  const oid = toId(id);
  if (!oid) return Response.json({ error: 'Invalid id' }, { status: 400 });
  const db = await getDb();
  const result = await db.collection<NoteDoc>('notes').deleteOne({ _id: oid, ownerId: googleId });
  if (result.deletedCount === 0) return Response.json({ error: 'Not found' }, { status: 404 });
  return Response.json({ ok: true });
}
