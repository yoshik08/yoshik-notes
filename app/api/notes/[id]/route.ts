import { HttpError, withOwner } from '@/lib/http';
import { getNote, parseId, purgeNote, trashNote, updateNote } from '@/lib/notes/store';

type Params = { id: string };

// GET /api/notes/:id (trashed notes are returned with deletedAt set)
export const GET = withOwner<Params>(async (owner, _req, { id }) => Response.json(await getNote(owner, parseId(id))));

// PATCH /api/notes/:id — { title?, elements? (full replace, honours baseRevision), ops? { upsert, delete }, canvasSettings?, appState?, thumb? }
export const PATCH = withOwner<Params>(async (owner, req, { id }) => {
  const oid = parseId(id);
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new HttpError(400, { error: 'Invalid JSON' });
  }
  return Response.json(await updateNote(owner, oid, body));
});

// DELETE /api/notes/:id — move to Recently deleted; ?permanent=1 erases a note already there
export const DELETE = withOwner<Params>(async (owner, req, { id }) => {
  const oid = parseId(id);
  if (new URL(req.url).searchParams.get('permanent') === '1') await purgeNote(owner, oid);
  else await trashNote(owner, oid);
  return Response.json({ ok: true });
});
