'use client';

import { SessionProvider } from 'next-auth/react';
import { useEffect, type ReactNode } from 'react';
import { BASE_PATH } from '@/components/dashboard/api';

// The single SessionProvider for the app — do not nest another one below it.
export function AuthProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    // The client app is running: cancel the boot watchdog in app/layout.tsx.
    document.documentElement.dataset.booted = '1';
    document.getElementById('boot-fail')?.remove();
  }, []);

  return <SessionProvider basePath={`${BASE_PATH}/api/auth`}>{children}</SessionProvider>;
}
