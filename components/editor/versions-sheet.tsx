'use client';

import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { ArrowCounterClockwiseIcon } from '@phosphor-icons/react';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { routes } from '@/lib/routes';
import type { CanvasElement } from '@/lib/db/models';

interface VersionRow {
  id: string;
  revision: number;
  title: string;
  createdAt: string;
  reason: 'original' | 'autosave' | 'restore';
  elementCount: number;
}

const reasonLabel = { original: 'Earliest copy', autosave: 'Autosaved', restore: 'Before a restore' } as const;

function VersionPreview({ noteId, versionId }: { noteId: string; versionId: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let alive = true;
    const io = new IntersectionObserver(async (entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      io.disconnect();
      try {
        const v = await api<{ elements: CanvasElement[]; canvasSettings: { background: '#ffffff' | '#000000'; pattern: 'none' | 'dots' | 'grid' | 'ruled' } }>(routes.api.version(noteId, versionId));
        const { renderThumbnail } = await import('@/lib/canvas/scene');
        const url = await renderThumbnail(v.elements, v.canvasSettings);
        if (alive) setSrc(url);
      } catch {
        /* the row still works without a preview */
      }
    });
    if (ref.current) io.observe(ref.current);
    return () => {
      alive = false;
      io.disconnect();
    };
  }, [noteId, versionId]);
  return (
    <div ref={ref} className="aspect-[3/2] w-28 shrink-0 overflow-hidden rounded-[3px] bg-white/[0.06]">
      {/* eslint-disable-next-line @next/next/no-img-element -- generated data URL */}
      {src ? <img src={src} alt="" className="size-full object-cover" /> : null}
    </div>
  );
}

export function VersionsSheet(props: { noteId: string; open: boolean; onOpenChange: (o: boolean) => void; hasUnsynced: boolean; onRestored: () => void }) {
  return (
    <Sheet open={props.open} onOpenChange={props.onOpenChange}>
      {props.open ? <VersionsPanel {...props} /> : null}
    </Sheet>
  );
}

/** Mounted each time the sheet opens, so it always starts from a fresh list. */
function VersionsPanel({ noteId, onOpenChange, hasUnsynced, onRestored }: { noteId: string; onOpenChange: (o: boolean) => void; hasUnsynced: boolean; onRestored: () => void }) {
  const [rows, setRows] = useState<VersionRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api<{ versions: VersionRow[] }>(routes.api.versions(noteId))
      .then((r) => alive && setRows(r.versions))
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [noteId]);

  const restore = async (v: VersionRow) => {
    if (hasUnsynced) {
      toast.error('Wait for your latest changes to sync first');
      return;
    }
    setBusy(v.id);
    try {
      await api(routes.api.restoreVersion(noteId, v.id), { method: 'POST' });
      toast.success('Version restored', { description: 'What you had before is kept in this list.' });
      onOpenChange(false);
      onRestored();
    } catch (e) {
      toast.error('Couldn’t restore that version', { description: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <SheetContent side="right" className="w-[min(420px,100vw)] border-l-white/10 bg-[var(--surface-sheet)] p-0">
        <SheetHeader className="px-6 pt-6">
          <SheetTitle className="type-title text-[20px]">Version history</SheetTitle>
          <SheetDescription className="text-[13.5px] leading-relaxed text-text-2">
            Before your ink is overwritten, a copy is kept here (at most every 15 minutes). Restoring keeps what you have now as a version too.
          </SheetDescription>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto px-4 pb-8">
          {error ? (
            <p className="px-2 py-6 text-[14px] text-alarm" role="alert">
              {error}
            </p>
          ) : rows === null ? (
            <p className="type-edge px-2 py-6 text-[12px]" role="status">
              Loading versions…
            </p>
          ) : rows.length === 0 ? (
            <p className="px-2 py-6 text-[14px] leading-relaxed text-text-2">No earlier versions yet. They appear once this note has been edited for a while.</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {rows.map((v) => (
                <li key={v.id} className="flex items-center gap-3 rounded-xl p-2 hover:bg-white/[0.05]">
                  <VersionPreview noteId={noteId} versionId={v.id} />
                  <div className="min-w-0 flex-1">
                    <p className="text-[14px] font-medium text-white">
                      {new Date(v.createdAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
                    </p>
                    <p className="type-edge mt-0.5 whitespace-nowrap text-[11.5px]">
                      {reasonLabel[v.reason]}
                      <span className="ml-2">{v.elementCount} marks</span>
                    </p>
                  </div>
                  <Button variant="ghost" size="sm" className="rounded-full text-white" disabled={busy !== null} onClick={() => void restore(v)}>
                    <ArrowCounterClockwiseIcon data-icon="inline-start" />
                    Restore
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </SheetContent>
    </>
  );
}
