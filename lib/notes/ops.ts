import type { CanvasElement } from '@/lib/db/models';

/** Element-level changes to a note: what autosave sends instead of the whole note. */
export interface ElementOps {
  upsert?: CanvasElement[];
  delete?: string[];
}

/**
 * Merge ops onto an element list: deletes win, upserts replace in place,
 * new elements append in order. The server applies the same rules atomically
 * in MongoDB (lib/notes/store.ts); the client uses this to replay unsynced edits.
 */
export function applyOps(current: CanvasElement[], ops: ElementOps): CanvasElement[] {
  const deleted = new Set(ops.delete ?? []);
  const upserts = new Map((ops.upsert ?? []).filter((e) => !deleted.has(e.id)).map((e) => [e.id, e]));
  const out: CanvasElement[] = [];
  for (const el of current) {
    if (deleted.has(el.id)) continue;
    const next = upserts.get(el.id);
    if (next) upserts.delete(el.id);
    out.push(next ?? el);
  }
  for (const el of upserts.values()) out.push(el);
  return out;
}
