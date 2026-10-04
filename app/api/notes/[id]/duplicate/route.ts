import { getDb } from '@/lib/db/mongo';
import type { NoteDoc } from '@/lib/db/models';
import { requireAuth, unauthorized } from '@/lib/auth/require-auth';
import { ObjectId } from 'mongodb';

// POST /api/notes/:id/duplicate — create an independent copy
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  let googleId: string;
  try {
    googleId = await requireAuth();
  } catch {
    return unauthorized();
  }
  let oid: ObjectId;
  try {
    oid = new ObjectId((await params).id);
  } catch {
    return Response.json({ error: 'Invalid id' }, { status: 400 });
  }
  const db = await getDb();
  const note = await db.collection<NoteDoc>('notes').findOne({ _id: oid, ownerId: googleId });
  if (!note) return Response.json({ error: 'Not found' }, { status: 404 });

  const now = new Date();
  const copy: Omit<NoteDoc, '_id'> = {
    ownerId: googleId,
    title: `${note.title} (copy)`,
    elements: JSON.parse(JSON.stringify(note.elements)),
    appState: { ...note.appState },
    canvasSettings: { ...note.canvasSettings },
    revision: 1,
    createdAt: now,
    updatedAt: now,
  };
  // Give copied elements fresh IDs so they're independent
  const { nanoid } = await import('@/lib/id');
  for (const el of copy.elements) el.id = nanoid();

  const result = await db.collection<NoteDoc>('notes').insertOne(copy);
  return Response.json({ id: result.insertedId.toString(), title: copy.title }, { status: 201 });
}
