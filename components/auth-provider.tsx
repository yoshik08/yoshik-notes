'use client';

import { SessionProvider } from 'next-auth/react';
import type { ReactNode } from 'react';

// Client auth calls must hit the proxied path in production (/notes/api/auth)
// and the plain path in local dev (/api/auth). This is the single
// SessionProvider for the app — do not nest another one below it.
function authBasePath(): string {
  if (typeof window !== 'undefined' && window.location.hostname.endsWith('yoshik.xyz')) {
    return '/notes/api/auth';
  }
  return '/api/auth';
}

export function AuthProvider({ children }: { children: ReactNode }) {
  return <SessionProvider basePath={authBasePath()}>{children}</SessionProvider>;
}
