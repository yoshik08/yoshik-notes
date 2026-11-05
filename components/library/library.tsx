'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { gsap } from 'gsap';
import { Flip } from 'gsap/Flip';
import { useGSAP } from '@gsap/react';
import { toast } from 'sonner';
import { ArrowLeftIcon, CheckCircleIcon, CopyIcon, MagnifyingGlassIcon, PlusIcon, TrashIcon, XIcon, ArrowCounterClockwiseIcon } from '@phosphor-icons/react';
import { AccountMenu } from '@/components/account-menu';
import { Wordmark } from '@/components/brand/wordmark';
import { Button } from '@/components/ui/button';
import { Kbd } from '@/components/ui/kbd';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { api } from '@/lib/api';
import { inLayer, isTextField } from '@/lib/keys';
import { routes } from '@/lib/routes';
import { frameTransition, prefersReducedMotion } from '@/lib/transition';
import { cn } from '@/lib/utils';
import { Frame, type FrameActions } from './frame';
import { frameNumbers, matches, sortNotes, type NoteSummary, type SortKey } from './model';
import { useNotes } from './use-notes';
import { clearLandingInk, takeLandingInk } from '@/components/landing/live-ink';

gsap.registerPlugin(Flip, useGSAP);

const SORTS: Array<{ value: SortKey; label: string }> = [
  { value: 'updated', label: 'Recent' },
  { value: 'created', label: 'Created' },
  { value: 'title', label: 'A–Z' },
];

function readSort(): SortKey {
  try {
    const v = localStorage.getItem('notes:sort');
    return v === 'created' || v === 'title' ? v : 'updated';
  } catch {
    return 'updated';
  }
}

export function Library({ mode = 'library' }: { mode?: 'library' | 'trash' }) {
  const router = useRouter();
  const { data: session } = useSession();
  const user = session?.user?.email ?? null;
  const notes = useNotes(mode, user);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortKey>(readSort);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [localThumbs, setLocalThumbs] = useState<Record<string, string>>({});
  const [creating, setCreating] = useState(false);
  const [purging, setPurging] = useState<NoteSummary | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const gridRef = useRef<HTMLUListElement>(null);
  const flipState = useRef<Flip.FlipState | null>(null);
  const [returningId] = useState(() => frameTransition.takeReturning());
  const returnPlayed = useRef(false);

  const numbers = useMemo(() => frameNumbers(notes.notes), [notes.notes]);
  const visible = useMemo(() => sortNotes(notes.notes.filter((n) => matches(n, query)), sort), [notes.notes, query, sort]);
  const visibleKey = visible.map((n) => n.id).join(',');

  // Layout changes the person asked for (sort, delete) glide into place.
  const captureFlip = () => {
    if (gridRef.current && !prefersReducedMotion()) flipState.current = Flip.getState(gridRef.current.querySelectorAll('[data-frame]'));
  };
  useGSAP(
    () => {
      if (!flipState.current) return;
      Flip.from(flipState.current, { duration: 0.42, ease: 'power3.inOut', absolute: false, nested: true, onEnter: (els) => gsap.fromTo(els, { opacity: 0, scale: 0.96 }, { opacity: 1, scale: 1, duration: 0.3 }) });
      flipState.current = null;
    },
    { dependencies: [visibleKey], scope: gridRef },
  );

  // Coming back from a note: its frame shrinks home from full screen (once).
  // The fresh list may re-sort the note (it was just edited), so aim at its final
  // place: wait up to 0.7 s for the server's order, else use the cached one.
  const listFresh = !notes.fromCache;
  useGSAP(
    (_ctx, contextSafe) => {
      if (!returningId || returnPlayed.current || prefersReducedMotion()) return;
      const play = contextSafe!(() => {
        const tile = gridRef.current?.querySelector<HTMLElement>(`[data-frame="${returningId}"]`);
        const el = tile?.querySelector<HTMLElement>('[data-frame-image]');
        if (!tile || !el || returnPlayed.current) return;
        returnPlayed.current = true;
        const r = el.getBoundingClientRect();
        const sx = window.innerWidth / r.width, sy = window.innerHeight / r.height;
        gsap.set(tile, { zIndex: 40 });
        gsap.fromTo(
          el,
          { x: -r.left + (window.innerWidth - r.width) / 2, y: -r.top + (window.innerHeight - r.height) / 2, scaleX: sx, scaleY: sy, transformOrigin: '50% 50%' },
          { x: 0, y: 0, scaleX: 1, scaleY: 1, duration: 0.42, ease: 'power3.inOut', clearProps: 'transform', onComplete: () => void gsap.set(tile, { clearProps: 'zIndex' }) },
        );
      });
      if (listFresh) {
        play();
        return;
      }
      const t = setTimeout(play, 700);
      return () => clearTimeout(t);
    },
    { dependencies: [visibleKey, listFresh], scope: gridRef },
  );

  const newNote = useCallback(async () => {
    if (creating) return;
    setCreating(true);
    try {
      const { id } = await api<{ id: string }>(routes.api.notes(), { method: 'POST', json: { title: 'Untitled' } });
      router.push(routes.note(id));
    } catch (e) {
      setCreating(false);
      toast.error('Couldn’t create a note', { description: (e as Error).message });
    }
  }, [creating, router]);

  // Ink written on the landing page before signing in: offer to keep it.
  useEffect(() => {
    if (mode !== 'library') return;
    const ink = takeLandingInk();
    if (!ink.length) return;
    toast('You wrote something before signing in', {
      id: 'landing-ink',
      description: 'Keep that page as a note?',
      duration: 20_000,
      action: {
        label: 'Keep it',
        onClick: async () => {
          try {
            const { id } = await api<{ id: string }>(routes.api.notes(), { method: 'POST', json: { title: 'First page' } });
            await api(routes.api.note(id), { method: 'PATCH', json: { elements: ink } });
            clearLandingInk();
            router.push(routes.note(id));
          } catch (e) {
            toast.error('Couldn’t keep that page', { description: (e as Error).message });
          }
        },
      },
      cancel: { label: 'Discard', onClick: () => clearLandingInk() },
    });
  }, [mode, router]);

  // Keyboard: "/" or ⌘K searches, N makes a note, Escape leaves select mode.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (inLayer(t)) return; // an open menu or dialog has the keys
      const typing = isTextField(t);
      if ((e.key === 'k' && (e.metaKey || e.ctrlKey)) || (e.key === '/' && !typing)) {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      } else if (e.key === 'Escape') {
        if (selecting) {
          setSelecting(false);
          setSelected(new Set());
        } else if (typing && t === searchRef.current) {
          setQuery('');
          searchRef.current?.blur();
        }
      } else if (!typing && mode === 'library' && (e.key === 'n' || e.key === 'N') && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        void newNote();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mode, newNote, selecting]);

  const actions: FrameActions = useMemo(
    () => ({
      open: (note, frame) => {
        const r = frame?.getBoundingClientRect();
        const img = frame?.querySelector('img')?.getAttribute('src') ?? null;
        if (r) frameTransition.open({ id: note.id, rect: { x: r.left, y: r.top, width: r.width, height: r.height }, image: img, paper: note.background });
        router.push(routes.note(note.id));
      },
      rename: (id, title) => void notes.rename(id, title),
      duplicate: (id) => void notes.duplicate([id]),
      trash: (ids) => {
        captureFlip();
        void notes.trash(ids);
      },
      restore: (ids) => {
        captureFlip();
        void notes.restore(ids);
      },
      purge: (note) => setPurging(note),
      toggle: (id) =>
        setSelected((s) => {
          const next = new Set(s);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return next;
        }),
    }),
    [notes, router],
  );

  const onLocalThumb = useCallback((id: string, url: string) => setLocalThumbs((m) => ({ ...m, [id]: url })), []);

  const changeSort = (value: string) => {
    if (!value || value === sort) return;
    captureFlip();
    setSort(value as SortKey);
    try {
      localStorage.setItem('notes:sort', value);
    } catch {
      /* preference only */
    }
  };

  const exitSelect = () => {
    setSelecting(false);
    setSelected(new Set());
  };

  const trashMode = mode === 'trash';
  const count = notes.notes.length;

  return (
    <div className="min-h-dvh bg-black pb-32">
      {/* Header: floats over the sheet; a soft edge instead of a hard divider. */}
      <header className="sticky top-0 z-30 bg-black/85 backdrop-blur-xl [mask-image:linear-gradient(to_bottom,black_82%,transparent)]" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
        <div className="mx-auto flex max-w-[1500px] flex-wrap items-center gap-x-4 gap-y-3 px-[max(1rem,env(safe-area-inset-left))] pt-4 pb-6 sm:px-8">
          <div className="flex min-w-0 flex-1 items-baseline gap-3">
            {trashMode ? (
              <Link href={routes.home()} className="pressable -ml-2 grid size-9 place-items-center rounded-full text-white/80 hover:bg-white/10 hover:text-white" aria-label="Back to notes">
                <ArrowLeftIcon className="size-5" />
              </Link>
            ) : null}
            {trashMode ? <h1 className="type-title truncate text-[22px] text-white">Recently deleted</h1> : <h1 className="leading-none"><Wordmark className="text-[26px]" /><span className="sr-only">Your notes</span></h1>}
            {notes.status === 'ready' && count > 0 ? <span className="type-edge hidden text-[12px] sm:inline">{count} {count === 1 ? 'frame' : 'frames'}</span> : null}
          </div>

          <div className="order-last flex w-full items-center gap-2 sm:order-none sm:w-auto">
            <label className="relative flex h-10 min-w-0 flex-1 items-center sm:w-72 sm:flex-none">
              <MagnifyingGlassIcon className="pointer-events-none absolute left-3 size-4 text-white/50" />
              <input
                ref={searchRef}
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={trashMode ? 'Search deleted notes' : 'Search notes and typed text'}
                aria-label="Search notes"
                className="h-10 w-full rounded-full bg-white/[0.07] pl-9 pr-12 text-[14px] text-white placeholder:text-white/48 outline-none transition-colors focus:bg-white/[0.11] [&::-webkit-search-cancel-button]:hidden"
              />
              {query ? (
                <button type="button" onClick={() => setQuery('')} aria-label="Clear search" className="pressable absolute right-2 grid size-7 place-items-center rounded-full text-white/60 hover:bg-white/10 hover:text-white">
                  <XIcon className="size-3.5" />
                </button>
              ) : (
                <Kbd className="pointer-events-none absolute right-3 hidden sm:inline-flex">/</Kbd>
              )}
            </label>
            {!trashMode ? (
              <ToggleGroup type="single" value={sort} onValueChange={changeSort} aria-label="Sort" className="hidden rounded-full bg-white/[0.07] p-1 md:flex">
                {SORTS.map((s) => (
                  <ToggleGroupItem key={s.value} value={s.value} className="h-8 rounded-full px-3 text-[13px] text-white/70 data-[state=on]:bg-white/[0.17] data-[state=on]:text-white">
                    {s.label}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            ) : null}
          </div>

          <div className="flex items-center gap-2">
            {count > 0 && !trashMode ? (
              <Button variant="ghost" className="h-10 rounded-full px-4 text-[14px] text-white/85" onClick={() => (selecting ? exitSelect() : setSelecting(true))}>
                {selecting ? 'Done' : 'Select'}
              </Button>
            ) : null}
            {!trashMode ? (
              <Button onClick={() => void newNote()} disabled={creating} className="pressable h-10 rounded-full bg-white px-4 text-[14px] font-semibold text-black hover:bg-white/90">
                <PlusIcon weight="bold" data-icon="inline-start" />
                New note
              </Button>
            ) : null}
            <AccountMenu />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1500px] px-[max(1rem,env(safe-area-inset-left))] sm:px-8">
        {notes.fromCache && notes.error ? (
          <p className="type-edge mb-4 text-[12px]" role="status">
            Showing the copy on this device. {notes.error}{' '}
            <button type="button" className="text-white underline" onClick={() => void notes.reload()}>
              Try again
            </button>
          </p>
        ) : null}

        {notes.status === 'loading' ? (
          <ul className="grid grid-cols-2 gap-x-[var(--frame-gap)] gap-y-9 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5" aria-label="Loading notes">
            {Array.from({ length: 8 }).map((_, i) => (
              <li key={i} className="develop" style={{ ['--i' as string]: i }}>
                <div className="aspect-[3/2] rounded-[3px] bg-white/[0.06]" />
                <div className="mt-3 h-3.5 w-2/3 rounded bg-white/[0.06]" />
                <div className="mt-2 h-2.5 w-1/3 rounded bg-white/[0.05]" />
              </li>
            ))}
          </ul>
        ) : notes.status === 'error' ? (
          <div className="mx-auto mt-24 flex max-w-sm flex-col items-center gap-4 text-center" role="alert">
            <p className="type-title text-[20px] text-white">Your notes didn’t load</p>
            <p className="text-[14px] text-text-2">{notes.error}</p>
            <Button onClick={() => void notes.reload()} className="h-10 rounded-full bg-white px-5 text-black hover:bg-white/90">
              Try again
            </Button>
          </div>
        ) : count === 0 ? (
          trashMode ? (
            <div className="mx-auto mt-24 max-w-sm text-center">
              <p className="type-title text-[20px] text-white">Nothing here</p>
              <p className="mt-2 text-[14px] text-text-2">Deleted notes stay here for 30 days, then they’re gone for good.</p>
            </div>
          ) : (
            <div className="mx-auto mt-10 grid max-w-3xl items-center gap-8 sm:grid-cols-[1.2fr_1fr]">
              <button type="button" onClick={() => void newNote()} className="pressable develop group relative block aspect-[3/2] w-full rounded-[3px] bg-white text-left" aria-label="Start your first note">
                <span className="type-edge absolute bottom-3 left-4 text-[12px] text-black/50">1</span>
              </button>
              <div>
                <p className="type-display text-[clamp(28px,4vw,40px)] text-white">A blank frame.</p>
                <p className="mt-3 max-w-[38ch] text-[15px] leading-relaxed text-text-2">Your first note starts here. Write with Apple Pencil, a finger, or a mouse; the page never runs out.</p>
                <Button onClick={() => void newNote()} disabled={creating} className="mt-6 h-11 rounded-full bg-white px-5 text-[15px] font-semibold text-black hover:bg-white/90">
                  <PlusIcon weight="bold" data-icon="inline-start" />
                  New note
                </Button>
              </div>
            </div>
          )
        ) : visible.length === 0 ? (
          <div className="mx-auto mt-24 max-w-sm text-center">
            <p className="type-title text-[20px] text-white">No notes match “{query.trim()}”</p>
            <p className="mt-2 text-[14px] text-text-2">Search looks at titles and typed text, not handwriting.</p>
            <Button variant="ghost" className="mt-5 rounded-full text-white" onClick={() => setQuery('')}>
              Clear search
            </Button>
          </div>
        ) : (
          <ul ref={gridRef} className="grid grid-cols-2 gap-x-[var(--frame-gap)] gap-y-9 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5" aria-label={trashMode ? 'Recently deleted notes' : 'Notes'}>
            {visible.map((note, i) => (
              <Frame
                key={note.id}
                note={note}
                number={numbers.get(note.id) ?? i + 1}
                index={i}
                develop={!returningId}
                mode={mode}
                selecting={selecting}
                selected={selected.has(note.id)}
                localThumb={localThumbs[note.id]}
                onLocalThumb={onLocalThumb}
                actions={actions}
              />
            ))}
          </ul>
        )}

        {!trashMode && notes.status === 'ready' ? (
          <p className="mt-16 text-center">
            <Link href={routes.trash()} className="type-edge text-[12px] hover:text-white">
              Recently deleted
            </Link>
          </p>
        ) : null}
      </main>

      {/* Select mode: the circled frames, and what to do with them. */}
      <div
        className={cn(
          'material-dock fixed left-1/2 z-40 flex -translate-x-1/2 items-center gap-1 rounded-full p-1.5 transition-[opacity,filter] duration-200 ease-[var(--ease-out)]',
          selecting ? 'opacity-100' : 'pointer-events-none opacity-0 blur-[3px]',
        )}
        style={{ bottom: 'calc(1.25rem + env(safe-area-inset-bottom))' }}
        aria-hidden={!selecting}
        inert={!selecting}
      >
        <span className="type-edge px-3 text-[12.5px] text-white/80" aria-live="polite">
          {selected.size} marked
        </span>
        <Button variant="ghost" className="h-10 rounded-full px-4 text-white" disabled={!selected.size} onClick={() => void notes.duplicate([...selected])}>
          <CopyIcon data-icon="inline-start" />
          Duplicate
        </Button>
        <Button
          variant="ghost"
          className="h-10 rounded-full px-4 text-alarm hover:text-alarm"
          disabled={!selected.size}
          onClick={() => {
            captureFlip();
            void notes.trash([...selected]);
            exitSelect();
          }}
        >
          <TrashIcon data-icon="inline-start" />
          Delete
        </Button>
        <Button variant="ghost" size="icon" className="size-10 rounded-full text-white/80" aria-label="Done selecting" onClick={exitSelect}>
          <CheckCircleIcon className="size-5" />
        </Button>
      </div>

      <AlertDialog open={!!purging} onOpenChange={(o) => !o && setPurging(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{purging?.title.trim() || 'Untitled'}” forever?</AlertDialogTitle>
            <AlertDialogDescription>This erases the note and its history. It can’t be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              className="bg-alarm text-black hover:bg-alarm/90"
              onClick={() => {
                if (purging) {
                  captureFlip();
                  void notes.purge(purging.id);
                }
                setPurging(null);
              }}
            >
              Delete forever
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {trashMode && count > 0 ? (
        <p className="type-edge mx-auto mt-10 max-w-md px-6 text-center text-[12px]">
          <ArrowCounterClockwiseIcon className="mr-1 inline size-3.5 align-[-2px]" />
          Deleted notes can be restored for 30 days.
        </p>
      ) : null}
    </div>
  );
}
