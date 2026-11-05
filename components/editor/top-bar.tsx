'use client';

import {
  ArrowUUpLeftIcon,
  ArrowUUpRightIcon,
  CaretLeftIcon,
  ClockCounterClockwiseIcon,
  CloudArrowUpIcon,
  CloudCheckIcon,
  CloudSlashIcon,
  CopyIcon,
  CornersOutIcon,
  DotsThreeOutlineIcon,
  DownloadSimpleIcon,
  TrashIcon,
  UploadSimpleIcon,
  WarningCircleIcon,
} from '@phosphor-icons/react';
import type { Paper } from '@/lib/canvas/scene';
import type { SyncSnapshot } from '@/lib/sync/note-sync';
import { Kbd } from '@/components/ui/kbd';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { shortcut } from '@/lib/keys';

export interface NoteMenuActions {
  setPaper(p: Paper): void;
  fit(): void;
  actualSize(): void;
  history(): void;
  exportAs(kind: 'png' | 'svg' | 'json'): void;
  importJson(): void;
  duplicate(): void;
  trash(): void;
}

function IconButton({ label, shortcut, onClick, disabled, children }: { label: string; shortcut?: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" aria-label={label} onClick={onClick} disabled={disabled} className="pressable grid size-10 place-items-center rounded-full text-white/80 hover:bg-white/10 hover:text-white disabled:text-white/30 disabled:hover:bg-transparent">
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={8}>
        {label}
        {shortcut ? <Kbd className="ml-1.5">{shortcut}</Kbd> : null}
      </TooltipContent>
    </Tooltip>
  );
}

export function SyncStatus({ snap, onRetry }: { snap: SyncSnapshot; onRetry: () => void }) {
  const { save, message, fromCache } = snap;
  if (save === 'error')
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <button type="button" onClick={onRetry} className="pressable flex h-8 items-center gap-1.5 rounded-full bg-alarm/15 px-3 text-[12.5px] font-medium text-alarm">
            <WarningCircleIcon weight="fill" className="size-4" />
            Not saved, retry
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom">{message ?? 'The last change didn’t reach the server. It’s kept on this device.'}</TooltipContent>
      </Tooltip>
    );
  if (save === 'offline' || fromCache)
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <button type="button" onClick={onRetry} className="pressable flex h-8 items-center gap-1.5 rounded-full bg-white/[0.08] px-3 text-[12.5px] text-white/80">
            <CloudSlashIcon className="size-4" />
            {save === 'offline' ? 'Offline, kept on this device' : 'Offline copy'}
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom">{message ?? 'Changes sync when you’re back online.'}</TooltipContent>
      </Tooltip>
    );
  const saving = save === 'saving' || save === 'pending';
  return (
    <span className={cn('flex h-8 items-center gap-1.5 px-2 text-[12.5px] transition-colors', saving ? 'text-white/70' : 'text-white/48')} role="status" aria-live="polite">
      {saving ? <CloudArrowUpIcon className="size-4" /> : <CloudCheckIcon className="size-4" />}
      {saving ? 'Saving' : 'Saved'}
    </span>
  );
}

export function TopBar({
  title,
  onTitle,
  onBack,
  snap,
  onRetry,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  paper,
  actions,
}: {
  title: string;
  onTitle: (t: string) => void;
  onBack: () => void;
  snap: SyncSnapshot;
  onRetry: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  paper: Paper;
  actions: NoteMenuActions;
}) {
  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between gap-3 p-3 sm:p-4" style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top))' }}>
      <div className="material-dock pointer-events-auto flex min-w-0 items-center gap-1 rounded-full py-1 pl-1 pr-2">
        <IconButton label="All notes" onClick={onBack}>
          <CaretLeftIcon weight="bold" className="size-5" />
        </IconButton>
        <input
          value={title}
          onChange={(e) => onTitle(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          placeholder="Untitled"
          aria-label="Note title"
          maxLength={200}
          spellCheck={false}
          className="type-title min-w-[6ch] max-w-[44vw] bg-transparent px-1 text-[16px] text-white outline-none [field-sizing:content] placeholder:text-white/48 sm:max-w-[38ch]"
        />
        <SyncStatus snap={snap} onRetry={onRetry} />
      </div>

      <div className="material-dock pointer-events-auto flex items-center gap-0.5 rounded-full p-1">
        <IconButton label="Undo" shortcut={shortcut('Z', { mod: true })} onClick={onUndo} disabled={!canUndo}>
          <ArrowUUpLeftIcon className="size-5" />
        </IconButton>
        <IconButton label="Redo" shortcut={shortcut('Z', { mod: true, shift: true })} onClick={onRedo} disabled={!canRedo}>
          <ArrowUUpRightIcon className="size-5" />
        </IconButton>
        <DropdownMenu>
          <DropdownMenuTrigger aria-label="Note options" className="pressable grid size-10 place-items-center rounded-full text-white/80 hover:bg-white/10 hover:text-white data-[state=open]:bg-white/10">
            <DotsThreeOutlineIcon weight="fill" className="size-5" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            <DropdownMenuLabel>Paper</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={paper.background} onValueChange={(v) => actions.setPaper({ ...paper, background: v as Paper['background'] })}>
              <DropdownMenuRadioItem value="#ffffff">White</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="#000000">Black</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Page</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={paper.pattern} onValueChange={(v) => actions.setPaper({ ...paper, pattern: v as Paper['pattern'] })}>
              <DropdownMenuRadioItem value="none">Blank</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="dots">Dots</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="grid">Grid</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="ruled">Lines</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem onSelect={actions.fit}>
                <CornersOutIcon />
                Fit to screen
                <DropdownMenuShortcut>{shortcut('0', { mod: true })}</DropdownMenuShortcut>
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={actions.history}>
                <ClockCounterClockwiseIcon />
                Version history
              </DropdownMenuItem>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <DownloadSimpleIcon />
                  Export
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  <DropdownMenuItem onSelect={() => actions.exportAs('png')}>Image (PNG)</DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => actions.exportAs('svg')}>Vector (SVG)</DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => actions.exportAs('json')}>Editable file (JSON)</DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuItem onSelect={actions.importJson}>
                <UploadSimpleIcon />
                Import a JSON note…
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={actions.duplicate}>
                <CopyIcon />
                Duplicate note
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={actions.trash}>
              <TrashIcon />
              Move to Recently deleted
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
