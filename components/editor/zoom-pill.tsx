'use client';

import { MinusIcon, PlusIcon } from '@phosphor-icons/react';
import type { Engine } from '@/lib/canvas/engine';
import { shortcut } from '@/lib/keys';
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuShortcut, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

export function ZoomPill({ engine, zoom }: { engine: Engine; zoom: number }) {
  return (
    <div className="material-dock flex items-center rounded-full p-1">
      <button type="button" aria-label="Zoom out" onClick={() => engine.zoomBy(1 / 1.25)} className="pressable grid size-9 place-items-center rounded-full text-white/80 hover:bg-white/10 hover:text-white">
        <MinusIcon className="size-4" weight="bold" />
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger className="pressable tabular h-9 min-w-14 rounded-full px-2 text-[13px] font-medium text-white/85 hover:bg-white/10" aria-label="Zoom options">
          {Math.round(zoom * 100)}%
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="end" className="w-48">
          <DropdownMenuGroup>
            <DropdownMenuItem onSelect={() => engine.fit()}>
              Fit to screen
              <DropdownMenuShortcut>{shortcut('0', { mod: true })}</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => engine.zoomTo(1)}>
              100%
              <DropdownMenuShortcut>{shortcut('1', { mod: true })}</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => engine.zoomTo(0.5)}>50%</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => engine.zoomTo(2)}>200%</DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <button type="button" aria-label="Zoom in" onClick={() => engine.zoomBy(1.25)} className="pressable grid size-9 place-items-center rounded-full text-white/80 hover:bg-white/10 hover:text-white">
        <PlusIcon className="size-4" weight="bold" />
      </button>
    </div>
  );
}
