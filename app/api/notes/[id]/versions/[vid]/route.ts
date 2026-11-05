import { withOwner } from '@/lib/http';
import { getVersion, parseId } from '@/lib/notes/store';

// GET /api/notes/:id/versions/:vid — one earlier state, with its elements
export const GET = withOwner<{ id: string; vid: string }>(async (owner, _req, { id, vid }) =>
  Response.json(await getVersion(owner, parseId(id), parseId(vid))),
);
