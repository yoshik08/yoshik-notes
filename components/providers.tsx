'use client';

import { SessionProvider } from 'next-auth/react';
import { useEffect, type ReactNode } from 'react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Toaster } from '@/components/ui/sonner';
import { routes } from '@/lib/routes';
import { setTextFamily } from '@/lib/canvas/scene';

// The single SessionProvider for the app — do not nest another one below it.
export function Providers({ children }: { children: ReactNode }) {
  useEffect(() => {
    // The client app is running: cancel the boot watchdog in app/layout.tsx.
    document.documentElement.dataset.booted = '1';
    document.getElementById('boot-fail')?.remove();
    // Typed text on the canvas uses the interface face.
    const family = getComputedStyle(document.body).fontFamily;
    if (family) setTextFamily(family);
  }, []);

  return (
    <SessionProvider basePath={routes.authBase} refetchOnWindowFocus={false}>
      <TooltipProvider delayDuration={450} skipDelayDuration={250}>
        {children}
        <Toaster position="top-center" offset={16} gap={8} visibleToasts={3} />
      </TooltipProvider>
    </SessionProvider>
  );
}
