import { withOwner } from '@/lib/http';
import { parseId, restoreNote } from '@/lib/notes/store';

// POST /api/notes/:id/restore — bring a note back from Recently deleted
export const POST = withOwner<{ id: string }>(async (owner, _req, { id }) => {
  await restoreNote(owner, parseId(id));
  return Response.json({ ok: true });
});
