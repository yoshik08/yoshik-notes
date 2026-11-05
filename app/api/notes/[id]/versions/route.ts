import { withOwner } from '@/lib/http';
import { listVersions, parseId } from '@/lib/notes/store';

// GET /api/notes/:id/versions — earlier states of the note, newest first (no element payloads)
export const GET = withOwner<{ id: string }>(async (owner, _req, { id }) =>
  Response.json({ versions: await listVersions(owner, parseId(id)) }),
);
