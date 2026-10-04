import { getDb } from '@/lib/db/mongo';
import { newNote, type NoteDoc } from '@/lib/db/models';
import { requireAuth, unauthorized } from '@/lib/auth/require-auth';
import { ObjectId } from 'mongodb';

// GET /api/notes — list user's notes (id, title, updatedAt, revision)
export async function GET() {
  let googleId: string;
  try {
    googleId = await requireAuth();
  } catch {
    return unauthorized();
  }
  const db = await getDb();
  const notes = await db
    .collection<NoteDoc>('notes')
    .find({ ownerId: googleId })
    .project({ elements: 0, appState: 0 })
    .sort({ updatedAt: -1 })
    .toArray();
  return Response.json({
    notes: notes.map((n) => ({
      id: n._id!.toString(),
      title: n.title,
      updatedAt: n.updatedAt,
      createdAt: n.createdAt,
      revision: n.revision,
    })),
  });
}

// POST /api/notes — create a new note
export async function POST(req: Request) {
  let googleId: string;
  try {
    googleId = await requireAuth();
  } catch {
    return unauthorized();
  }
  let title = 'Untitled';
  try {
    const body = await req.json();
    if (typeof body.title === 'string' && body.title.trim()) {
      title = body.title.trim().slice(0, 200);
    }
  } catch { /* no body = default title */ }
  const db = await getDb();
  const result = await db.collection<NoteDoc>('notes').insertOne(newNote(googleId, title));
  return Response.json({ id: result.insertedId.toString(), title }, { status: 201 });
}
