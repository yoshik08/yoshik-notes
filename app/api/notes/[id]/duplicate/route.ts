import { withOwner } from '@/lib/http';
import { duplicateNote, parseId } from '@/lib/notes/store';

// POST /api/notes/:id/duplicate — an independent copy
export const POST = withOwner<{ id: string }>(async (owner, _req, { id }) =>
  Response.json(await duplicateNote(owner, parseId(id)), { status: 201 }),
);
