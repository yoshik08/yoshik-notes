'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { routes } from '@/lib/routes';

// /notes/new makes a note and opens it (also handy as a bookmark or PWA shortcut).
export default function NewNotePage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api<{ id: string }>(routes.api.notes(), { method: 'POST', json: { title: 'Untitled' } })
      .then(({ id }) => alive && router.replace(routes.note(id)))
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [router]);

  return (
    <div className="fixed inset-0 grid place-items-center bg-black px-6 text-center" role={error ? 'alert' : 'status'}>
      {error ? (
        <div className="flex max-w-sm flex-col items-center gap-4">
          <p className="type-title text-[20px] text-white">Couldn’t make a new note</p>
          <p className="text-[14px] text-text-2">{error}</p>
          <div className="flex gap-2">
            <Link href={routes.home()} className="pressable rounded-full px-5 py-2.5 text-[14px] text-white hover:bg-white/10">
              Back to notes
            </Link>
            <button type="button" onClick={() => window.location.reload()} className="pressable rounded-full bg-white px-5 py-2.5 text-[14px] font-semibold text-black">
              Try again
            </button>
          </div>
        </div>
      ) : (
        <span className="type-edge text-[12px]">Making a new note…</span>
      )}
    </div>
  );
}
