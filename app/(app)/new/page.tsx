'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { signIn } from 'next-auth/react';
import { ApiError, apiJson } from '@/components/dashboard/api';

// POSTs a new note and redirects to its editor. The notes layout already
// gates unauthenticated users; the 401 branch covers expired sessions.
export default function NewNotePage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    apiJson<{ id: string }>('/api/notes', {
      method: 'POST',
      body: JSON.stringify({ title: 'Untitled' }),
    })
      .then((data) => {
        if (alive) router.replace(`/notes/${data.id}`);
      })
      .catch((e: unknown) => {
        if (!alive) return;
        if (e instanceof ApiError && e.status === 401) {
          signIn('google', { callbackUrl: '/new' });
          return;
        }
        setError(e instanceof Error ? e.message : 'Failed to create note');
      });
    return () => {
      alive = false;
    };
  }, [router]);

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-black px-4">
        <div className="w-full max-w-sm rounded-xl border border-[#1a1a1a] bg-black p-8 text-center">
          <p className="text-sm text-red-400">{error}</p>
          <div className="mt-6 flex gap-3">
            <Link
              href="/"
              className="flex-1 rounded-lg border border-[#1a1a1a] px-4 py-2.5 text-sm font-medium text-white hover:border-[#2e2e2e]"
            >
              Back to notes
            </Link>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="flex-1 rounded-lg bg-[#E9A13B] px-4 py-2.5 text-sm font-semibold text-black hover:bg-[#d18f2e]"
            >
              Retry
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-black">
      <div
        className="h-8 w-8 animate-spin rounded-full border-2 border-neutral-800 border-t-[#E9A13B]"
        role="status"
        aria-label="Creating note"
      />
    </div>
  );
}
