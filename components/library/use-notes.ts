'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { api, ApiError } from '@/lib/api';
import { routes } from '@/lib/routes';
import type { NoteSummary } from './model';

type Mode = 'library' | 'trash';

interface State {
  status: 'loading' | 'ready' | 'error';
  notes: NoteSummary[];
  error: string | null;
  /** Showing the copy saved on this device while the server answers. */
  fromCache: boolean;
}

const cacheKey = (user: string, mode: Mode) => `notes:list:v1:${user}:${mode}`;

function readCache(user: string | null, mode: Mode): NoteSummary[] | null {
  if (!user) return null;
  try {
    const raw = localStorage.getItem(cacheKey(user, mode));
    return raw ? (JSON.parse(raw) as NoteSummary[]) : null;
  } catch {
    return null;
  }
}

function writeCache(user: string | null, mode: Mode, notes: NoteSummary[]) {
  if (!user) return;
  try {
    localStorage.setItem(cacheKey(user, mode), JSON.stringify(notes));
  } catch {
    /* storage full or blocked: the cache is only a speed-up */
  }
}

/** Notes for the library (or Recently deleted), cached per account for instant paint. */
export function useNotes(mode: Mode, user: string | null) {
  const [state, setState] = useState<State>(() => {
    const cached = typeof window === 'undefined' ? null : readCache(user, mode);
    return cached ? { status: 'ready', notes: cached, error: null, fromCache: true } : { status: 'loading', notes: [], error: null, fromCache: false };
  });
  const lastFetch = useRef(0);

  const load = useCallback(async () => {
    lastFetch.current = Date.now();
    try {
      const { notes } = await api<{ notes: NoteSummary[] }>(routes.api.notes(mode === 'trash' ? '?trash=1' : ''));
      setState({ status: 'ready', notes, error: null, fromCache: false });
      writeCache(user, mode, notes);
    } catch (e) {
      const message = e instanceof ApiError ? e.message : 'Couldn’t load your notes.';
      setState((s) => (s.notes.length ? { ...s, fromCache: true, error: message } : { status: 'error', notes: [], error: message, fromCache: false }));
    }
  }, [mode, user]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on mount; state is set when the request resolves
    void load();
    const onVisible = () => {
      if (document.visibilityState === 'visible' && Date.now() - lastFetch.current > 30_000) void load();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [load]);

  const patchLocal = useCallback(
    (fn: (notes: NoteSummary[]) => NoteSummary[]) =>
      setState((s) => {
        const notes = fn(s.notes);
        writeCache(user, mode, notes);
        return { ...s, notes };
      }),
    [mode, user],
  );

  const rename = useCallback(
    async (id: string, title: string) => {
      const before = state.notes.find((n) => n.id === id);
      patchLocal((ns) => ns.map((n) => (n.id === id ? { ...n, title, updatedAt: new Date().toISOString() } : n)));
      try {
        await api(routes.api.note(id), { method: 'PATCH', json: { title } });
      } catch (e) {
        if (before) patchLocal((ns) => ns.map((n) => (n.id === id ? before : n)));
        toast.error('Couldn’t rename the note', { description: (e as Error).message });
      }
    },
    [patchLocal, state.notes],
  );

  const duplicate = useCallback(
    async (ids: string[]) => {
      const results = await Promise.allSettled(ids.map((id) => api(routes.api.duplicate(id), { method: 'POST' })));
      const failed = results.filter((r) => r.status === 'rejected').length;
      await load();
      if (failed) toast.error(`Couldn’t duplicate ${failed === 1 ? 'a note' : `${failed} notes`}`, { description: 'Check your connection and try again.' });
      else toast.success(ids.length === 1 ? 'Duplicated' : `Duplicated ${ids.length} notes`);
    },
    [load],
  );

  const restore = useCallback(
    async (ids: string[], quiet = false) => {
      const results = await Promise.allSettled(ids.map((id) => api(routes.api.restore(id), { method: 'POST' })));
      const failed = results.filter((r) => r.status === 'rejected').length;
      if (mode === 'trash') patchLocal((ns) => ns.filter((n) => !ids.includes(n.id) || failed > 0));
      else await load();
      if (failed) toast.error(`Couldn’t restore ${failed === 1 ? 'a note' : `${failed} notes`}`);
      else if (!quiet) toast.success(ids.length === 1 ? 'Restored' : `Restored ${ids.length} notes`);
    },
    [load, mode, patchLocal],
  );

  /** Move to Recently deleted, with Undo. Nothing is erased here. */
  const trash = useCallback(
    async (ids: string[]) => {
      const removed = state.notes.filter((n) => ids.includes(n.id));
      patchLocal((ns) => ns.filter((n) => !ids.includes(n.id)));
      const results = await Promise.allSettled(ids.map((id) => api(routes.api.note(id), { method: 'DELETE' })));
      const failedIds = ids.filter((_, i) => results[i].status === 'rejected');
      if (failedIds.length) {
        patchLocal((ns) => [...removed.filter((n) => failedIds.includes(n.id)), ...ns]);
        toast.error('Couldn’t delete', { description: 'Check your connection and try again.' });
        return;
      }
      toast(ids.length === 1 ? 'Moved to Recently deleted' : `Moved ${ids.length} notes to Recently deleted`, {
        action: { label: 'Undo', onClick: () => void restore(ids, true) },
        duration: 6000,
      });
    },
    [patchLocal, restore, state.notes],
  );

  const purge = useCallback(
    async (id: string) => {
      try {
        await api(routes.api.note(id, '?permanent=1'), { method: 'DELETE' });
        patchLocal((ns) => ns.filter((n) => n.id !== id));
        toast('Deleted forever');
      } catch (e) {
        toast.error('Couldn’t delete the note', { description: (e as Error).message });
      }
    },
    [patchLocal],
  );

  const setThumbLocal = useCallback((id: string, thumbAt: number) => patchLocal((ns) => ns.map((n) => (n.id === id ? { ...n, thumbAt } : n))), [patchLocal]);

  return { ...state, reload: load, rename, duplicate, trash, restore, purge, setThumbLocal };
}
