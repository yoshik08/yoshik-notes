'use client';

import { api } from '@/lib/api';
import { routes } from '@/lib/routes';
import type { NoteData } from '@/lib/sync/note-sync';

// Notes saved by the previous app have no preview image yet. The first time
// one is on screen in the library, render it here with the canvas renderer and
// store it, once. Two at a time; a failure just leaves the blank frame.

type Done = (dataUrl: string) => void;
const queue: Array<{ id: string; done: Done }> = [];
const requested = new Set<string>();
let running = 0;

export function requestThumb(id: string, done: Done) {
  if (requested.has(id)) return;
  requested.add(id);
  queue.push({ id, done });
  pump();
}

function pump() {
  while (running < 2 && queue.length) {
    const job = queue.shift()!;
    running++;
    void work(job).finally(() => {
      running--;
      pump();
    });
  }
}

async function work({ id, done }: { id: string; done: Done }) {
  try {
    const note = await api<NoteData>(routes.api.note(id), { timeoutMs: 30_000 });
    if (!note.elements.length) return;
    const { renderThumbnail } = await import('@/lib/canvas/scene');
    const url = await renderThumbnail(note.elements, note.canvasSettings);
    if (!url) return;
    done(url);
    await api(routes.api.note(id), { method: 'PATCH', json: { thumb: url } });
  } catch {
    requested.delete(id); // try again on a later visit
  }
}
