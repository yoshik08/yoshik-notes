'use client';

import { useEffect, useRef, useState } from 'react';
import { useSession, signOut } from 'next-auth/react';

export function UserMenu() {
  const { data: session } = useSession();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, []);

  const user = session?.user;
  if (!user) return null;

  const initial = (user.name ?? user.email ?? '?').charAt(0).toUpperCase();

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account menu"
        className="flex items-center gap-2 rounded-full border border-neutral-800 bg-neutral-950 py-1 pl-1 pr-3 transition hover:border-neutral-600"
      >
        {user.image ? (
          // Plain img: Google avatar host isn't in next/image remotePatterns.
          <img
            src={user.image}
            alt=""
            width={28}
            height={28}
            className="h-7 w-7 rounded-full object-cover"
            referrerPolicy="no-referrer"
          />
        ) : (
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-amber-500 text-xs font-bold text-black">
            {initial}
          </span>
        )}
        <span className="max-w-32 truncate text-sm font-medium text-white">
          {user.name ?? user.email}
        </span>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-50 mt-2 w-52 overflow-hidden rounded-xl border border-neutral-800 bg-neutral-950 shadow-xl"
        >
          <div className="border-b border-neutral-800 px-4 py-3">
            <p className="truncate text-sm font-semibold text-white">{user.name}</p>
            {user.email && (
              <p className="truncate text-xs text-neutral-400">{user.email}</p>
            )}
          </div>
          <button
            role="menuitem"
            onClick={() => signOut({ callbackUrl: '/notes' })}
            className="w-full px-4 py-3 text-left text-sm font-medium text-neutral-300 transition hover:bg-neutral-900 hover:text-white"
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
