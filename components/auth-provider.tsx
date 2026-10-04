'use client';

import { SessionProvider } from 'next-auth/react';
import type { ReactNode } from 'react';

export function AuthProvider({ children }: { children: ReactNode }) {
  // The app is served under /notes via proxy rewrite, so next-auth client
  // calls must target /notes/api/auth (server-side NEXTAUTH_URL covers the rest).
  return <SessionProvider basePath="/notes/api/auth">{children}</SessionProvider>;
}
