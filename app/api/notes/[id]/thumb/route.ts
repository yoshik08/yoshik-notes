import { withOwner } from '@/lib/http';
import { getThumb, parseId } from '@/lib/notes/store';

// GET /api/notes/:id/thumb?v=<thumbAt> — the note's preview image; the URL changes whenever it does
export const GET = withOwner<{ id: string }>(async (owner, _req, { id }) => {
  const { bytes, type } = await getThumb(owner, parseId(id));
  return new Response(bytes as BodyInit, {
    headers: { 'content-type': type, 'cache-control': 'private, max-age=31536000, immutable' },
  });
});
