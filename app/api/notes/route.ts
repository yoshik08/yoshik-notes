import { withOwner } from '@/lib/http';
import { createNote, listNotes } from '@/lib/notes/store';

// GET /api/notes — the owner's notes (summaries, newest edit first)
export const GET = withOwner(async (owner) => Response.json({ notes: await listNotes(owner) }));

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
