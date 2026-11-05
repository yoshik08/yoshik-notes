'use client';

import Link from 'next/link';
import { signOut, useSession } from 'next-auth/react';
import { SignOutIcon, TrashSimpleIcon } from '@phosphor-icons/react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { routes } from '@/lib/routes';

export function AccountMenu() {
  const { data } = useSession();
  const user = data?.user;
  if (!user) return null;
  const initial = (user.name ?? user.email ?? '?').trim().charAt(0).toUpperCase();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger aria-label="Account" className="pressable rounded-full outline-offset-2">
        <Avatar className="size-9 ring-1 ring-white/15">
          {user.image ? <AvatarImage src={user.image} alt="" referrerPolicy="no-referrer" /> : null}
          <AvatarFallback className="bg-white/10 text-[13px] font-semibold text-white">{initial}</AvatarFallback>
        </Avatar>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="flex flex-col gap-0.5 py-2">
          <span className="truncate text-[14px] font-medium text-white">{user.name ?? 'Signed in'}</span>
          {user.email ? <span className="truncate text-[12.5px] font-normal text-text-2">{user.email}</span> : null}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem asChild>
            <Link href={routes.trash()}>
              <TrashSimpleIcon />
              Recently deleted
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void signOut({ callbackUrl: routes.home() })}>
            <SignOutIcon />
            Sign out
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
