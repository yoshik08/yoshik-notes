'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { signIn, useSession } from 'next-auth/react';
import type { NoteSummary, SortKey } from '@/components/dashboard/types';
import { ApiError, apiJson } from '@/components/dashboard/api';
import NoteCard from '@/components/dashboard/NoteCard';
import SearchBar from '@/components/dashboard/SearchBar';

const SORT_OPTIONS: Array<{ value: SortKey; label: string }> = [
  { value: 'updated', label: 'Last edited' },
  { value: 'created', label: 'Recently created' },
  { value: 'title', label: 'Title A–Z' },
];

function SignInPrompt() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-black px-4">
      <div className="w-full max-w-sm rounded-xl border border-[#1a1a1a] bg-black p-8 text-center">
        <h1 className="text-xl font-semibold text-white">notes</h1>
        <p className="mt-2 text-sm text-neutral-400">Sign in to access your notes.</p>
        <button
          type="button"
          onClick={() => signIn('google', { callbackUrl: '/notes' })}
          className="mt-6 w-full rounded-lg bg-[#E9A13B] px-4 py-2.5 text-sm font-semibold text-black transition-colors hover:bg-[#d18f2e]"
        >
          Sign in with Google
        </button>
      </div>
    </div>
  );
}

function SkeletonGrid() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-hidden="true">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="h-32 animate-pulse rounded-xl border border-[#1a1a1a] bg-black" />
      ))}
    </div>
  );
}

export default function NotesDashboard() {
  const router = useRouter();
  const { status } = useSession();
  const [notes, setNotes] = useState<NoteSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [authNeeded, setAuthNeeded] = useState(false);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortKey>('updated');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiJson<{ notes: NoteSummary[] }>('/api/notes');
      setNotes(data.notes);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        setAuthNeeded(true);
      } else {
        setError(e instanceof Error ? e.message : 'Failed to load notes');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Initial data fetch on auth — the canonical fetch-on-mount pattern.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (status === 'authenticated') void load();
  }, [status, load]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? notes.filter((n) => (n.title || '').toLowerCase().includes(q))
      : [...notes];
    filtered.sort((a, b) => {
      if (sort === 'title') return (a.title || '').localeCompare(b.title || '');
      if (sort === 'created')
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });
    return filtered;
  }, [notes, query, sort]);

  const handleRenamed = useCallback((id: string, title: string) => {
    setNotes((ns) =>
      ns.map((n) =>
        n.id === id ? { ...n, title, updatedAt: new Date().toISOString() } : n
      )
    );
  }, []);

  const handleDeleted = useCallback((id: string) => {
    setNotes((ns) => ns.filter((n) => n.id !== id));
  }, []);

  // The layout gates unauthenticated users; this covers expired sessions (API 401).
  if (authNeeded) return <SignInPrompt />;

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-semibold tracking-tight text-white">Notes</h1>
        <button
          type="button"
          onClick={() => router.push('/new')}
          className="rounded-lg bg-[#E9A13B] px-4 py-2 text-sm font-semibold text-black transition-colors hover:bg-[#d18f2e] sm:w-auto"
        >
          + New note
        </button>
      </header>

      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <SearchBar value={query} onChange={setQuery} />
        <label className="flex items-center gap-2 text-sm text-neutral-400">
          <span className="whitespace-nowrap">Sort by</span>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            aria-label="Sort notes"
            className="rounded-lg border border-[#1a1a1a] bg-black px-3 py-2 text-sm text-white focus:border-[#E9A13B] focus:outline-none"
          >
            {SORT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <main className="mt-6">
        {loading ? (
          <SkeletonGrid />
        ) : error ? (
          <div className="rounded-xl border border-[#1a1a1a] p-8 text-center">
            <p className="text-sm text-red-400">{error}</p>
            <button
              type="button"
              onClick={() => void load()}
              className="mt-4 rounded-lg border border-[#1a1a1a] px-4 py-2 text-sm font-medium text-white hover:border-[#2e2e2e]"
            >
              Retry
            </button>
          </div>
        ) : visible.length === 0 ? (
          <div className="rounded-xl border border-[#1a1a1a] p-12 text-center">
            {notes.length === 0 ? (
              <>
                <p className="text-base font-medium text-white">No notes yet</p>
                <p className="mt-1 text-sm text-neutral-500">
                  Create your first note to start drawing.
                </p>
                <button
                  type="button"
                  onClick={() => router.push('/new')}
                  className="mt-6 rounded-lg bg-[#E9A13B] px-4 py-2 text-sm font-semibold text-black transition-colors hover:bg-[#d18f2e]"
                >
                  + New note
                </button>
              </>
            ) : (
              <>
                <p className="text-base font-medium text-white">No notes match “{query.trim()}”</p>
                <p className="mt-1 text-sm text-neutral-500">Try a different search.</p>
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  className="mt-6 rounded-lg border border-[#1a1a1a] px-4 py-2 text-sm font-medium text-white hover:border-[#2e2e2e]"
                >
                  Clear search
                </button>
              </>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {visible.map((note) => (
              <NoteCard
                key={note.id}
                note={note}
                onRenamed={handleRenamed}
                onDuplicated={() => void load()}
                onDeleted={handleDeleted}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
