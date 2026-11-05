'use client';

import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { ArrowCounterClockwiseIcon, CopyIcon, DotsThreeIcon, PencilSimpleLineIcon, TrashIcon, ArrowSquareOutIcon } from '@phosphor-icons/react';
import { ContextMenu, ContextMenuContent, ContextMenuGroup, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from '@/components/ui/context-menu';
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { routes } from '@/lib/routes';
import { cn } from '@/lib/utils';
import { GreaseMark } from './grease-mark';
import { daysLeft, shortWhen, type NoteSummary } from './model';
import { requestThumb } from './thumbs';

export interface FrameActions {
  open(note: NoteSummary, img: HTMLElement | null): void;
  rename(id: string, title: string): void;
  duplicate(id: string): void;
  trash(ids: string[]): void;
  restore(ids: string[]): void;
  purge(note: NoteSummary): void;
  toggle(id: string): void;
}

interface Props {
  note: NoteSummary;
  number: number;
  index: number;
  mode: 'library' | 'trash';
  selecting: boolean;
  selected: boolean;
  localThumb?: string;
  onLocalThumb(id: string, url: string): void;
  actions: FrameActions;
  /** Play the develop entrance (not when coming back from a note). */
  develop: boolean;
}

/** The rebate arrow printed beside frame numbers on film. */
function EdgeArrow() {
  return (
    <svg width="6" height="7" viewBox="0 0 6 7" aria-hidden="true" className="inline-block shrink-0 opacity-80">
      <path d="M0 0L6 3.5L0 7Z" fill="currentColor" />
    </svg>
  );
}

export function Frame({ note, number, index, mode, selecting, selected, localThumb, onLocalThumb, actions, develop }: Props) {
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(note.title);
  const [imgFailed, setImgFailed] = useState(false);
  const frameRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const title = note.title.trim() || 'Untitled';
  const dark = note.background === '#000000';
  const src = localThumb ?? (note.thumbAt && !imgFailed ? routes.api.thumb(note.id, note.thumbAt) : null);
  const needsThumb = mode === 'library' && !src && note.elementCount > 0;

  // Notes from the previous app have no preview yet: develop one when on screen.
  useEffect(() => {
    if (!needsThumb || !frameRef.current) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          io.disconnect();
          requestThumb(note.id, (url) => onLocalThumb(note.id, url));
        }
      },
      { rootMargin: '200px' },
    );
    io.observe(frameRef.current);
    return () => io.disconnect();
  }, [needsThumb, note.id, onLocalThumb]);

  useEffect(() => {
    if (renaming) inputRef.current?.select();
  }, [renaming]);

  const commitRename = () => {
    setRenaming(false);
    const next = draft.trim();
    if (next && next !== note.title) actions.rename(note.id, next);
    else setDraft(note.title);
  };

  const onFrameClick = (e: MouseEvent) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return; // let the browser open a new tab
    e.preventDefault();
    if (selecting) actions.toggle(note.id);
    else if (mode === 'library') actions.open(note, frameRef.current);
  };

  const menuItems = (Item: typeof DropdownMenuItem | typeof ContextMenuItem, Sep: typeof DropdownMenuSeparator | typeof ContextMenuSeparator) =>
    mode === 'trash' ? (
      <>
        <Item onSelect={() => actions.restore([note.id])}>
          <ArrowCounterClockwiseIcon />
          Restore
        </Item>
        <Sep />
        <Item variant="destructive" onSelect={() => actions.purge(note)}>
          <TrashIcon />
          Delete forever…
        </Item>
      </>
    ) : (
      <>
        <Item onSelect={() => actions.open(note, frameRef.current)}>
          <ArrowSquareOutIcon />
          Open
        </Item>
        <Item
          onSelect={() => {
            setDraft(note.title);
            setRenaming(true);
          }}
        >
          <PencilSimpleLineIcon />
          Rename
        </Item>
        <Item onSelect={() => actions.duplicate(note.id)}>
          <CopyIcon />
          Duplicate
        </Item>
        <Sep />
        <Item variant="destructive" onSelect={() => actions.trash([note.id])}>
          <TrashIcon />
          Move to Recently deleted
        </Item>
      </>
    );

  return (
    <li className={cn(develop && 'develop', 'group/frame relative flex min-w-0 flex-col')} style={{ ['--i' as string]: Math.min(index, 14) }} data-frame={note.id}>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <a
            href={routes.note(note.id)}
            onClick={onFrameClick}
            aria-label={selecting ? `${selected ? 'Unmark' : 'Mark'} ${title}` : `Open ${title}`}
            role={selecting ? 'button' : undefined}
            aria-pressed={selecting ? selected : undefined}
            className="pressable relative block rounded-[4px] outline-offset-4"
          >
            <div
              ref={frameRef}
              data-frame-image
              className={cn(
                'relative aspect-[3/2] w-full overflow-hidden rounded-[3px] transition-[filter,opacity] duration-200',
                dark && 'ring-1 ring-white/14',
                selecting && !selected && 'opacity-70',
                '[@media(hover:hover)]:group-hover/frame:brightness-[1.06]',
              )}
              style={{ background: dark ? '#000' : '#fff' }}
            >
              {src ? (
                // eslint-disable-next-line @next/next/no-img-element -- auth-scoped, immutable per version
                <img src={src} alt="" draggable={false} loading={index < 8 ? 'eager' : 'lazy'} decoding="async" onError={() => setImgFailed(true)} className="size-full object-cover" />
              ) : needsThumb ? (
                <span className={cn('type-edge absolute inset-0 grid place-items-center text-[11px]', dark ? 'text-white/45' : 'text-black/45')}>Developing…</span>
              ) : null}
            </div>
            <GreaseMark show={selected} seed={note.id} />
          </a>
        </ContextMenuTrigger>
        <ContextMenuContent className="w-60">
          <ContextMenuGroup>{menuItems(ContextMenuItem, ContextMenuSeparator)}</ContextMenuGroup>
        </ContextMenuContent>
      </ContextMenu>

      <div className="mt-2.5 flex min-w-0 items-start gap-2">
        <div className="min-w-0 flex-1">
          {renaming ? (
            <input
              ref={inputRef}
              value={draft}
              aria-label="Note title"
              maxLength={200}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitRename();
                if (e.key === 'Escape') {
                  setDraft(note.title);
                  setRenaming(false);
                }
              }}
              className="type-title -mx-1 w-full rounded-md bg-white/10 px-1 text-[15px] text-white outline-none"
            />
          ) : (
            <a href={routes.note(note.id)} onClick={onFrameClick} tabIndex={-1} className="type-title block truncate text-[15px] text-white hover:underline" title={title}>
              {title}
            </a>
          )}
          <p className="type-edge mt-1 flex items-center gap-1.5 text-[11.5px]">
            <span>{number}</span>
            <EdgeArrow />
            <span>{mode === 'trash' && note.deletedAt ? `${daysLeft(note.deletedAt)} days left` : shortWhen(note.updatedAt)}</span>
            {note.elementCount > 0 ? (
              <span className="ml-1.5">
                {note.elementCount} {note.elementCount === 1 ? 'mark' : 'marks'}
              </span>
            ) : null}
          </p>
        </div>
        {!selecting ? (
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label={`Actions for ${title}`}
              className="pressable -mr-1.5 grid size-9 shrink-0 place-items-center rounded-full text-white/70 transition-opacity hover:bg-white/10 hover:text-white data-[state=open]:bg-white/10 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/frame:opacity-100 [@media(hover:hover)]:group-focus-within/frame:opacity-100 [@media(hover:hover)]:data-[state=open]:opacity-100"
            >
              <DotsThreeIcon weight="bold" className="size-5" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-60">
              <DropdownMenuGroup>{menuItems(DropdownMenuItem, DropdownMenuSeparator)}</DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
    </li>
  );
}
