'use client';

import { useSession, signIn } from 'next-auth/react';
import { useEffect, useState, type ReactNode } from 'react';

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.47c-.29 1.48-1.14 2.73-2.4 3.58v3h3.86c2.26-2.09 3.56-5.17 3.56-8.82z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.86-3c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96H1.29v3.09C3.26 21.3 7.31 24 12 24z"
      />
      <path
        fill="#FBBC05"
        d="M5.27 14.29c-.25-.72-.38-1.49-.38-2.29s.14-1.57.38-2.29V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.98-3.09z"
      />
      <path
        fill="#EA4335"
        d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.98 3.09C6.22 6.86 8.87 4.75 12 4.75z"
      />
    </svg>
  );
}

function AuthGate({ children }: { children: ReactNode }) {
  const { status } = useSession();
  const [timedOut, setTimedOut] = useState(false);

  // The spinner must never hang forever: if the session check stalls,
  // fall through to the sign-in card with a retry option.
  useEffect(() => {
    if (status !== 'loading') return;
    const t = setTimeout(() => setTimedOut(true), 12000);
    return () => clearTimeout(t);
  }, [status]);

  if (status === 'loading' && !timedOut) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-black">
        <div
          className="h-8 w-8 animate-spin rounded-full border-2 border-neutral-800 border-t-amber-500"
          role="status"
          aria-label="Loading"
        />
      </div>
    );
  }

  if (status === 'unauthenticated' || timedOut) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-black px-4">
        <div className="w-full max-w-sm rounded-2xl border border-neutral-800 bg-neutral-950 p-8 text-center">
          <h1 className="text-2xl font-bold tracking-tight text-white">notes</h1>
          <p className="mt-2 text-sm text-neutral-400">
            {timedOut
              ? 'The session check timed out. Check your connection and try again.'
              : 'Sign in with Google to access your notes.'}
          </p>
          <p className="mt-1 text-xs text-neutral-500">
            ✏️ Made for Apple Pencil
          </p>
          <button
            onClick={() => signIn('google', { callbackUrl: '/notes' })}
            className="mt-6 flex w-full items-center justify-center gap-3 rounded-xl bg-white px-4 py-3 text-sm font-semibold text-black transition hover:bg-neutral-200"
          >
            <GoogleIcon />
            Continue with Google
          </button>
          {timedOut && (
            <button
              onClick={() => window.location.reload()}
              className="mt-3 w-full rounded-xl border border-neutral-800 px-4 py-2.5 text-sm font-medium text-neutral-300 transition hover:border-neutral-600"
            >
              Retry
            </button>
          )}
        </div>
      </div>
    );
  }

  return <>{children}</>;
}

export default function NotesLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-black text-white antialiased">
      <AuthGate>{children}</AuthGate>
    </div>
  );
}
