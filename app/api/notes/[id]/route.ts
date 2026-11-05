import { HttpError, withOwner } from '@/lib/http';
import { deleteNote, getNote, parseId, updateNote, type NotePatch } from '@/lib/notes/store';

type Params = { id: string };

// GET /api/notes/:id
export const GET = withOwner<Params>(async (owner, _req, { id }) => Response.json(await getNote(owner, parseId(id))));

// PATCH /api/notes/:id — update title/elements/appState/canvasSettings; baseRevision enables conflict detection
export const PATCH = withOwner<Params>(async (owner, req, { id }) => {
  const oid = parseId(id);
  let body: NotePatch;
  try {
    body = await req.json();
  } catch {
    throw new HttpError(400, { error: 'Invalid JSON' });
  }
  return Response.json(await updateNote(owner, oid, body));
});

// DELETE /api/notes/:id
export const DELETE = withOwner<Params>(async (owner, _req, { id }) => {
  await deleteNote(owner, parseId(id));
  return Response.json({ ok: true });
});
