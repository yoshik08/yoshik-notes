'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { signIn } from 'next-auth/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { gsap } from 'gsap';
import { useGSAP } from '@gsap/react';
import { toast } from 'sonner';
import { ArrowCounterClockwiseIcon } from '@phosphor-icons/react';
import type { CanvasElement } from '@/lib/db/models';
import type { Tool } from '@/lib/canvas/engine';
import type { Paper } from '@/lib/canvas/scene';
import { prepareImage } from '@/lib/canvas/images';
import { exportJSON, exportPNG, exportSVG, download, downloadText, safeFilename } from '@/lib/export/exporters';
import { validateImport } from '@/lib/export/importer';
import { api } from '@/lib/api';
import { inLayer, isTextField } from '@/lib/keys';
import { routes } from '@/lib/routes';
import { frameTransition, prefersReducedMotion, type OpeningFrame } from '@/lib/transition';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Dock, InkTray } from './dock';
import { TextOverlay } from './text-overlay';
import { TopBar, type NoteMenuActions } from './top-bar';
import { useNoteEditor } from './use-note-editor';
import { VersionsSheet } from './versions-sheet';
import { ZoomPill } from './zoom-pill';

gsap.registerPlugin(useGSAP);

const CLIP_MARK = 'yoshik-notes/elements@1';
const TOOL_KEYS: Record<string, Tool> = { v: 'select', p: 'pen', m: 'highlighter', e: 'eraser', h: 'hand', l: 'line', a: 'arrow', r: 'rectangle', o: 'ellipse', t: 'text', i: 'image' };

/** Keys and clipboard events that belong to a field, menu or dialog, not the page. */
const notForPage = (t: EventTarget | null) => isTextField(t) || inLayer(t);

export function Editor({ id }: { id: string }) {
  const router = useRouter();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const pickAt = useRef<{ x: number; y: number } | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [opening] = useState<OpeningFrame | null>(() => frameTransition.takeOpening(id));
  const [entered, setEntered] = useState(!opening);

  const { sync, engine, snap, tools, loaded, paper, setPaper, prepareToLeave, takeSavedView } = useNoteEditor(id, {
    onPencil: () => {
      try {
        if (localStorage.getItem('notes:pencil-hint')) return;
        localStorage.setItem('notes:pencil-hint', '1');
      } catch {
        /* show it anyway */
      }
      toast('Apple Pencil writes. Fingers move the page.', { duration: 3500 });
    },
    onPickImage: (at) => {
      pickAt.current = at;
      fileRef.current?.click();
    },
  }, { matchThumbnail: !!opening?.image });
  // The title shown is always the synced note's (server copy plus unsynced edits).
  const title = snap.note && snap.note.title !== 'Untitled' ? snap.note.title : '';

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    engine.attach(c);
    return () => engine.detach();
  }, [engine]);

  useEffect(() => {
    document.title = `${snap.note?.title && snap.note.title !== 'Untitled' ? snap.note.title : 'Untitled'} · notes`;
  }, [snap.note?.title]);

  // ------------------------------------------------------------ the enlarger
  const overlayRef = useRef<HTMLDivElement>(null);
  useGSAP(() => {
    const el = overlayRef.current;
    if (!opening || !el) return;
    if (prefersReducedMotion()) {
      gsap.to(el, { opacity: 0, duration: 0.2, onComplete: () => setEntered(true) });
      return;
    }
    const { rect } = opening;
    gsap.fromTo(
      el,
      { x: rect.x, y: rect.y, scaleX: rect.width / window.innerWidth, scaleY: rect.height / window.innerHeight },
      { x: 0, y: 0, scaleX: 1, scaleY: 1, duration: 0.46, ease: 'power3.inOut', onComplete: () => setEntered(true) },
    );
  });
  // Once the page is drawn underneath, dissolve the enlarged frame into it.
  const dissolved = useRef(false);
  useEffect(() => {
    const el = overlayRef.current;
    if (!entered || !el || dissolved.current) return;
    if (!loaded && snap.load === 'loading') return;
    dissolved.current = true;
    gsap.to(el, {
      opacity: 0,
      filter: 'blur(6px)',
      duration: 0.24,
      ease: 'power1.out',
      onComplete: () => {
        const saved = takeSavedView();
        if (saved) engine.glideTo(saved);
      },
    });
  }, [engine, entered, loaded, snap.load, takeSavedView]);

  // ------------------------------------------------------------ actions
  const goBack = useCallback(async () => {
    frameTransition.back(id);
    await prepareToLeave();
    router.push(routes.home());
  }, [id, prepareToLeave, router]);

  const onTitle = (t: string) => sync.applyLocal({ title: t.slice(0, 200) });

  const insertFiles = useCallback(
    async (files: File[], at?: { x: number; y: number }) => {
      for (const f of files.filter((x) => x.type.startsWith('image/'))) {
        try {
          const img = await prepareImage(f);
          engine.insertImage(img.src, img, at);
        } catch (e) {
          toast.error('Couldn’t add that image', { description: (e as Error).message });
        }
      }
    },
    [engine],
  );

  const exportAs = useCallback(
    async (kind: 'png' | 'svg' | 'json') => {
      const name = safeFilename(title || 'untitled');
      const els = [...engine.elements];
      try {
        if (kind === 'png') download(await exportPNG(els, engine.paper), `${name}.png`);
        else if (kind === 'svg') downloadText(exportSVG(els, engine.paper), `${name}.svg`, 'image/svg+xml');
        else downloadText(exportJSON({ title: title || 'Untitled', elements: els, canvasSettings: engine.paper }), `${name}.json`, 'application/json');
      } catch (e) {
        toast.error('Export failed', { description: (e as Error).message });
      }
    },
    [engine, title],
  );

  const importJson = useCallback(
    async (file: File) => {
      try {
        if (file.size > 10_000_000) throw new Error('That file is larger than 10 MB.');
        const res = validateImport(JSON.parse(await file.text()));
        if (!res.ok || !res.note) throw new Error(res.error ?? 'Not a notes file.');
        const { id: newId } = await api<{ id: string }>(routes.api.notes(), { method: 'POST', json: { title: `${res.note.title} (imported)` } });
        await api(routes.api.note(newId), { method: 'PATCH', json: { elements: res.note.elements, ...(res.note.canvasSettings ? { canvasSettings: res.note.canvasSettings } : {}) } });
        toast.success(`Imported ${res.note.elements.length} marks`);
        router.push(routes.note(newId));
      } catch (e) {
        toast.error('Import failed', { description: e instanceof SyntaxError ? 'That file isn’t valid JSON.' : (e as Error).message });
      }
    },
    [router],
  );

  const menu: NoteMenuActions = {
    setPaper: (p: Paper) => setPaper(p),
    fit: () => engine.fit(),
    actualSize: () => engine.zoomTo(1),
    history: () => {
      void sync.flush();
      setHistoryOpen(true);
    },
    exportAs: (k) => void exportAs(k),
    importJson: () => importRef.current?.click(),
    duplicate: async () => {
      try {
        await sync.flush();
        const copy = await api<{ id: string }>(routes.api.duplicate(id), { method: 'POST' });
        toast.success('Duplicated', { action: { label: 'Open copy', onClick: () => router.push(routes.note(copy.id)) } });
      } catch (e) {
        toast.error('Couldn’t duplicate', { description: (e as Error).message });
      }
    },
    trash: async () => {
      try {
        await sync.flush();
        await api(routes.api.note(id), { method: 'DELETE' });
        const undo = () =>
          api(routes.api.restore(id), { method: 'POST' })
            .then(() => router.push(routes.note(id)))
            .catch((e: Error) => toast.error('Couldn’t restore', { description: e.message }));
        toast('Moved to Recently deleted', {
          action: { label: 'Undo', onClick: () => void undo() },
          duration: 6000,
        });
        router.push(routes.home());
      } catch (e) {
        toast.error('Couldn’t delete', { description: (e as Error).message });
      }
    },
  };

  // ------------------------------------------------------------ keyboard, clipboard, drop
  useEffect(() => {
    const mod = (e: KeyboardEvent) => e.metaKey || e.ctrlKey;
    let kbdTimer: ReturnType<typeof setTimeout> | undefined;
    const onKey = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      // Save works from anywhere, the title field included (never the browser's "Save page").
      if (mod(e) && k === 's') {
        e.preventDefault();
        void sync.save();
        return;
      }
      if (notForPage(e.target)) return;
      // Changes caused by this key press happen without animation.
      document.documentElement.dataset.keyboard = '1';
      clearTimeout(kbdTimer);
      kbdTimer = setTimeout(() => delete document.documentElement.dataset.keyboard, 250);
      if (k === ' ' && !e.repeat) {
        e.preventDefault();
        engine.setSpaceHeld(true);
        return;
      }
      if (mod(e)) {
        if (k === 'z') {
          e.preventDefault();
          if (e.shiftKey) engine.redo();
          else engine.undo();
        } else if (k === 'y') {
          e.preventDefault();
          engine.redo();
        } else if (k === 'a') {
          e.preventDefault();
          engine.selectAll();
        } else if (k === 'd') {
          e.preventDefault();
          engine.duplicateSelection();
        } else if (k === '0') {
          e.preventDefault();
          engine.fit();
        } else if (k === '1') {
          e.preventDefault();
          engine.zoomTo(1);
        } else if (k === '=' || k === '+') {
          e.preventDefault();
          engine.zoomBy(1.25, undefined, 0.2);
        } else if (k === '-') {
          e.preventDefault();
          engine.zoomBy(1 / 1.25, undefined, 0.2);
        }
        return;
      }
      if (e.altKey) return;
      if (k === 'backspace' || k === 'delete') {
        e.preventDefault();
        engine.deleteSelection();
      } else if (k === 'escape') {
        engine.select([]);
      } else if (k === '[' || k === ']') {
        const kind = engine.getState().tool === 'highlighter' ? 'highlighter' : 'pen';
        const w = engine.getState()[kind].width;
        engine.setInk(kind, { width: Math.max(0.5, Math.min(40, k === ']' ? w * 1.25 : w / 1.25)) });
      } else if (TOOL_KEYS[k]) {
        engine.setTool(TOOL_KEYS[k]);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === ' ') engine.setSpaceHeld(false);
    };
    const onBlur = () => engine.setSpaceHeld(false);
    const onCopy = (e: ClipboardEvent) => {
      if (notForPage(e.target)) return;
      const els = engine.copySelection();
      if (!els.length || !e.clipboardData) return;
      e.preventDefault();
      e.clipboardData.setData('text/plain', JSON.stringify({ [CLIP_MARK]: els }));
      if (e.type === 'cut') engine.deleteSelection();
    };
    const onPaste = (e: ClipboardEvent) => {
      if (notForPage(e.target) || !e.clipboardData) return;
      const files = [...e.clipboardData.files];
      if (files.some((f) => f.type.startsWith('image/'))) {
        e.preventDefault();
        void insertFiles(files);
        return;
      }
      const text = e.clipboardData.getData('text/plain');
      if (!text) return;
      e.preventDefault();
      try {
        const parsed = JSON.parse(text) as Record<string, CanvasElement[]>;
        if (Array.isArray(parsed[CLIP_MARK])) return engine.paste(parsed[CLIP_MARK]);
      } catch {
        /* plain text */
      }
      const c = engine.viewCenter();
      const fontSize = Math.round(Math.min(160, Math.max(8, 22 / engine.cam.zoom)));
      engine.paste([{ id: 'paste', type: 'text', x: c.x, y: c.y, text: text.slice(0, 50_000), fontSize, color: engine.getState().pen.color }]);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    window.addEventListener('copy', onCopy);
    window.addEventListener('cut', onCopy);
    window.addEventListener('paste', onPaste);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('copy', onCopy);
      window.removeEventListener('cut', onCopy);
      window.removeEventListener('paste', onPaste);
      clearTimeout(kbdTimer);
      delete document.documentElement.dataset.keyboard;
    };
  }, [engine, insertFiles, sync]);

  const ready = snap.load === 'ready' && loaded;
  const pageDark = (paper?.background ?? '#ffffff') === '#000000';
  const cursor = tools.panning ? 'grabbing' : tools.tool === 'hand' ? 'grab' : tools.tool === 'select' ? 'default' : tools.tool === 'text' ? 'text' : tools.tool === 'pen' || tools.tool === 'highlighter' || tools.tool === 'eraser' ? 'none' : 'crosshair';

  return (
    <div
      className="fixed inset-0 overflow-hidden bg-black select-none [-webkit-touch-callout:none]"
      onDragOver={(e) => {
        if ([...e.dataTransfer.items].some((i) => i.kind === 'file')) e.preventDefault();
      }}
      onDrop={(e) => {
        const files = [...e.dataTransfer.files];
        if (!files.length) return;
        e.preventDefault();
        void insertFiles(files, engine.worldAt(e.clientX, e.clientY));
      }}
    >
      <canvas
        ref={canvasRef}
        aria-label="Note page"
        role="img"
        data-marks={tools.elementCount}
        className={cn('absolute inset-0 size-full transition-[opacity,filter] duration-300 ease-[var(--ease-out)]', ready && entered ? 'opacity-100' : 'opacity-0 brightness-50', opening && 'duration-0')}
        style={{ touchAction: 'none', cursor }}
      />

      {tools.textEdit ? <TextOverlay key={tools.textEdit.id} engine={engine} edit={tools.textEdit} /> : null}

      {snap.load === 'ready' && snap.note ? (
        <>
          <div className={cn('transition-[opacity,transform] duration-300 ease-[var(--ease-out)]', entered ? 'opacity-100' : '-translate-y-2 opacity-0')}>
            <TopBar
              title={title}
              onTitle={onTitle}
              onBack={() => void goBack()}
              snap={snap}
              onRetry={() => sync.retry()}
              canUndo={tools.canUndo}
              canRedo={tools.canRedo}
              onUndo={() => engine.undo()}
              onRedo={() => engine.redo()}
              paper={paper ?? { background: '#ffffff', pattern: 'none' }}
              actions={menu}
            />
          </div>
          <div
            className={cn('pointer-events-none absolute inset-x-0 bottom-0 z-20 flex flex-col items-center gap-2 px-3 transition-[opacity,transform] duration-300 ease-[var(--ease-out)]', entered ? 'opacity-100' : 'translate-y-3 opacity-0')}
            style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
          >
            <div className="pointer-events-auto">
              <InkTray engine={engine} state={tools} paper={paper?.background ?? '#ffffff'} />
            </div>
            <div className="pointer-events-auto">
              <Dock engine={engine} state={tools} paper={paper?.background ?? '#ffffff'} />
            </div>
          </div>
          <div className={cn('absolute bottom-0 right-0 z-20 hidden p-4 transition-opacity duration-300 lg:block', entered ? 'opacity-100' : 'opacity-0')} style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}>
            <ZoomPill engine={engine} zoom={tools.zoom} />
          </div>
          {tools.pencilMode ? (
            <span className={cn('type-edge pointer-events-none absolute bottom-5 left-5 z-10 hidden text-[11.5px] lg:block', pageDark ? 'text-white/45' : 'text-black/45')}>Pencil mode</span>
          ) : null}
        </>
      ) : null}

      {/* States other than a page you can write on. */}
      {snap.load === 'loading' && !opening ? <Opening /> : null}
      {snap.load === 'missing' ? (
        <Notice title="This note isn’t here" body={snap.message ?? 'It may have been deleted, or it belongs to another account.'}>
          <Button asChild className="h-10 rounded-full bg-white px-5 text-black hover:bg-white/90">
            <Link href={routes.home()}>Back to notes</Link>
          </Button>
        </Notice>
      ) : null}
      {snap.load === 'error' ? (
        <Notice title="This note didn’t open" body={snap.message ?? 'Something went wrong.'}>
          <Button variant="ghost" asChild className="h-10 rounded-full px-5 text-white">
            <Link href={routes.home()}>Back to notes</Link>
          </Button>
          <Button onClick={() => sync.retry()} className="h-10 rounded-full bg-white px-5 text-black hover:bg-white/90">
            Try again
          </Button>
        </Notice>
      ) : null}
      {snap.load === 'signed-out' ? (
        <Notice title="Your session ended" body="Sign in again to open this note. Anything unsynced is kept on this device.">
          <Button onClick={() => void signIn('google', { callbackUrl: routes.note(id) })} className="h-10 rounded-full bg-white px-5 text-black hover:bg-white/90">
            Sign in with Google
          </Button>
        </Notice>
      ) : null}
      {snap.load === 'trashed' ? (
        <Notice title="This note is in Recently deleted" body="Restore it to keep writing.">
          <Button variant="ghost" asChild className="h-10 rounded-full px-5 text-white">
            <Link href={routes.trash()}>Recently deleted</Link>
          </Button>
          <Button
            onClick={async () => {
              try {
                await api(routes.api.restore(id), { method: 'POST' });
                window.location.reload();
              } catch (e) {
                toast.error('Couldn’t restore', { description: (e as Error).message });
              }
            }}
            className="h-10 rounded-full bg-white px-5 text-black hover:bg-white/90"
          >
            <ArrowCounterClockwiseIcon data-icon="inline-start" />
            Restore
          </Button>
        </Notice>
      ) : null}

      {opening ? (
        <div
          ref={overlayRef}
          aria-hidden="true"
          className="pointer-events-none fixed left-0 top-0 z-50 h-dvh w-screen origin-top-left overflow-hidden"
          style={{ background: opening.paper === '#000000' ? '#000' : '#fff' }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- same image the frame showed */}
          {opening.image ? <img src={opening.image} alt="" className="size-full object-contain" /> : null}
        </div>
      ) : null}

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = '';
          void insertFiles(files, pickAt.current ?? undefined);
        }}
      />
      <input
        ref={importRef}
        type="file"
        accept=".json,application/json"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) void importJson(f);
        }}
      />
      <VersionsSheet noteId={id} open={historyOpen} onOpenChange={setHistoryOpen} hasUnsynced={snap.save !== 'saved'} onRestored={() => void sync.refresh()} />
    </div>
  );
}

function Opening() {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setSlow(true), 450);
    return () => clearTimeout(t);
  }, []);
  return (
    <div className="absolute inset-0 grid place-items-center" role="status">
      <span className={cn('type-edge text-[12px] transition-opacity duration-300', slow ? 'opacity-100' : 'opacity-0')}>Opening…</span>
    </div>
  );
}

function Notice({ title, body, children }: { title: string; body: string; children: React.ReactNode }) {
  return (
    <div className="absolute inset-0 z-30 grid place-items-center bg-black/80 px-6 backdrop-blur-sm">
      <div className="develop flex max-w-sm flex-col items-center gap-3 text-center" role="alert">
        <p className="type-title text-[21px] text-white">{title}</p>
        <p className="text-[14px] leading-relaxed text-text-2">{body}</p>
        <div className="mt-3 flex flex-wrap justify-center gap-2">{children}</div>
      </div>
    </div>
  );
}
