import { withOwner } from '@/lib/http';
import { parseId, restoreVersion } from '@/lib/notes/store';

// POST /api/notes/:id/versions/:vid/restore — make an earlier state current (the current one is kept as a version)
export const POST = withOwner<{ id: string; vid: string }>(async (owner, _req, { id, vid }) =>
  Response.json(await restoreVersion(owner, parseId(id), parseId(vid))),
);
