'use client';

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { Engine } from '@/lib/canvas/engine';
import { renderThumbnail, thumbnailCamera, type Paper } from '@/lib/canvas/scene';
import type { Camera } from '@/lib/canvas/camera';
import { NoteSync, type NoteData } from '@/lib/sync/note-sync';

const paperOf = (note: Pick<NoteData, 'canvasSettings'>): Paper => ({
  background: note.canvasSettings.background === '#000000' ? '#000000' : '#ffffff',
  pattern: note.canvasSettings.pattern ?? 'none',
});

/** The view the person left the note at, held until the opening transition is done. */
class SavedView {
  private view: Camera | null = null;
  set(v: Camera | null) {
    this.view = v;
  }
  take() {
    const v = this.view;
    this.view = null;
    return v;
  }
}

/** Tracks whether the page changed since the last thumbnail was made. */
class ThumbState {
  private dirty = false;
  markDirty() {
    this.dirty = true;
  }
  /** True once per change: reading it marks the thumbnail as up to date. */
  take() {
    const was = this.dirty;
    this.dirty = false;
    return was;
  }
}

/**
 * A note open in the editor: its sync lifecycle and its canvas engine, wired
 * together. The Editor is keyed by note id, so these live for one note.
 */
export function useNoteEditor(
  noteId: string,
  hooks: { onPencil?: () => void; onPickImage?: (at: { x: number; y: number }) => void },
  options: { matchThumbnail?: boolean } = {},
) {
  const [sync] = useState(() => new NoteSync(noteId));
  const [thumbs] = useState(() => new ThumbState());
  const [savedView] = useState(() => new SavedView());
  const matchThumbnail = !!options.matchThumbnail;
  const [engine] = useState(
    () =>
      new Engine({
        onCommit: (change) => {
          sync.applyLocal(change);
          thumbs.markDirty();
        },
      }),
  );

  // UI callbacks change between renders; hand the latest ones to the engine.
  const { onPencil, onPickImage } = hooks;
  useEffect(() => {
    engine.setHooks({ onPencilDetected: () => onPencil?.(), onPickImage: (at) => onPickImage?.(at) });
  }, [engine, onPencil, onPickImage]);

  const snap = useSyncExternalStore(sync.subscribe, sync.getSnapshot, sync.getSnapshot);
  const tools = useSyncExternalStore(engine.subscribe, engine.getState, engine.getState);

  useEffect(() => {
    void sync.load();
    return () => sync.dispose();
  }, [sync]);

  // First copy of the note (offline cache or server) goes into the engine once.
  const ready = snap.load === 'ready' && !!snap.note;
  useEffect(() => {
    const note = sync.getSnapshot().note;
    if (!ready || !note || engine.getState().loaded) return;
    const a = note.appState;
    const saved = a && !(a.viewX === 0 && a.viewY === 0 && a.zoom === 1) ? { x: a.viewX, y: a.viewY, zoom: a.zoom } : null;
    // Opened from its frame: start exactly as the thumbnail framed it, then glide to where you left off.
    const framed = matchThumbnail ? thumbnailCamera(note.elements, engine.size.width, engine.size.height) : null;
    engine.load(note.elements, paperOf(note), framed ?? saved);
    // After the transition, settle where you left off, or at the normal writing view.
    if (framed) savedView.set(saved ?? engine.homeCamera());
    else if (!saved) requestAnimationFrame(() => engine.home());
  }, [engine, matchThumbnail, ready, savedView, sync]);

  // A newer copy from the server (or another device) replaces the page; ink in progress is untouched.
  useEffect(() => {
    const off = sync.onRemote((elements) => engine.load(elements, engine.paper));
    return off;
  }, [engine, sync]);

  const background = snap.note?.canvasSettings.background === '#000000' ? '#000000' : '#ffffff';
  const pattern = snap.note?.canvasSettings.pattern ?? 'none';
  const paper: Paper | null = snap.note ? { background, pattern } : null;
  useEffect(() => {
    if (tools.loaded && snap.note) engine.setPaper({ background, pattern });
  }, [engine, tools.loaded, background, pattern, snap.note]);

  const makeThumb = useCallback(async () => {
    if (!engine.getState().loaded || !thumbs.take()) return;
    const url = await renderThumbnail([...engine.elements], engine.paper);
    if (url) sync.queueMeta({ thumb: url });
  }, [engine, sync, thumbs]);

  useEffect(() => {
    const t = setInterval(() => void makeThumb(), 8000);
    return () => clearInterval(t);
  }, [makeThumb]);

  // Leaving the page: write the journal now, keepalive-save, remember the view.
  useEffect(() => {
    const flush = () => sync.flushOnHide({ viewX: engine.cam.x, viewY: engine.cam.y, zoom: engine.cam.zoom });
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        void makeThumb();
        flush();
      } else void sync.refresh();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', flush);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', flush);
    };
  }, [engine, makeThumb, sync]);

  /** Before navigating away inside the app: thumbnail, view, and a save attempt. */
  const prepareToLeave = useCallback(async () => {
    await makeThumb();
    sync.queueMeta({ appState: { viewX: engine.cam.x, viewY: engine.cam.y, zoom: engine.cam.zoom } });
    void sync.save();
  }, [engine, makeThumb, sync]);

  const setPaper = useCallback(
    (next: Paper) => {
      sync.applyLocal({ canvasSettings: next });
      thumbs.markDirty();
    },
    [sync, thumbs],
  );

  return { sync, engine, snap, tools, loaded: tools.loaded, paper, setPaper, prepareToLeave, takeSavedView: () => savedView.take() };
}
