import { withOwner } from '@/lib/http';
import { createNote, listNotes } from '@/lib/notes/store';

// GET /api/notes — the owner's notes (summaries, newest edit first); ?trash=1 lists Recently deleted
export const GET = withOwner(async (owner, req) => {
  const trash = new URL(req.url).searchParams.get('trash') === '1';
  return Response.json({ notes: await listNotes(owner, { trash }) });
});

// POST /api/notes — create a note; body { title? } is optional
export const POST = withOwner(async (owner, req) => {
  let title: unknown;
  try {
    title = ((await req.json()) as { title?: unknown }).title;
  } catch {
    /* no body = default title */
  }
  return Response.json(await createNote(owner, title), { status: 201 });
});
