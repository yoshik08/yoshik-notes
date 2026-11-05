'use client';

import { useSession } from 'next-auth/react';
import { useEffect, useState, type ReactNode } from 'react';
import { Landing } from '@/components/landing/landing';
import { Wordmark } from '@/components/brand/wordmark';

function Splash() {
  // Black first; only a slow session check earns a visible "opening" state.
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setSlow(true), 700);
    return () => clearTimeout(t);
  }, []);
  return (
    <div className="fixed inset-0 grid place-items-center bg-black" role="status" aria-live="polite">
      {slow ? (
        <div className="develop flex flex-col items-center gap-3">
          <Wordmark className="text-[28px]" />
          <span className="type-edge text-[12px]">Opening your notes…</span>
        </div>
      ) : (
        <span className="sr-only">Opening your notes</span>
      )}
    </div>
  );
}

export default function AppLayout({ children }: { children: ReactNode }) {
  const { status } = useSession();
  const [timedOut, setTimedOut] = useState(false);

  // A stalled session check must never leave a blank screen.
  useEffect(() => {
    if (status !== 'loading') return;
    const t = setTimeout(() => setTimedOut(true), 12_000);
    return () => clearTimeout(t);
  }, [status]);

  if (status === 'loading' && !timedOut) return <Splash />;
  if (status !== 'authenticated') return <Landing sessionTimedOut={timedOut} />;
  return <>{children}</>;
}
