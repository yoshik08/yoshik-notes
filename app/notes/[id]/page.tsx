'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { InfiniteCanvas, type Tool } from '@/components/canvas/infinite-canvas';
import { useHistory, addElementsCmd, deleteElementsCmd } from '@/lib/canvas/history';
import { savePending, clearPending, getPending } from '@/lib/sync/local-store';
import type { CanvasElement, NoteDoc } from '@/lib/db/models';
import { cn } from '@/lib/cn';
import { ExportMenu } from '@/components/export-menu';

type SaveState = 'saved' | 'saving' | 'offline' | 'error';

const TOOLS: { id: Tool; label: string; shortcut: string; icon: string }[] = [
  { id: 'select', label: 'Select', shortcut: 'V', icon: '➤' },
  { id: 'pen', label: 'Pen', shortcut: 'P', icon: '✏️' },
  { id: 'highlighter', label: 'Highlighter', shortcut: 'H', icon: '🖍️' },
  { id: 'eraser', label: 'Eraser', shortcut: 'E', icon: '🧽' },
  { id: 'hand', label: 'Hand', shortcut: 'H', icon: '✋' },
  { id: 'line', label: 'Line', shortcut: 'L', icon: '╱' },
  { id: 'arrow', label: 'Arrow', shortcut: 'A', icon: '→' },
  { id: 'rectangle', label: 'Rectangle', shortcut: 'R', icon: '▭' },
  { id: 'ellipse', label: 'Ellipse', shortcut: 'O', icon: '○' },
  { id: 'text', label: 'Text', shortcut: 'T', icon: 'T' },
  { id: 'image', label: 'Image', shortcut: 'I', icon: '🖼️' },
];

const COLORS = ['#000000', '#ffffff', '#E9A13B', '#ef4444', '#3b82f6', '#22c55e', '#a855f7'];
const WIDTHS = [2, 4, 6, 10, 16];

export default function NoteEditorPage() {
  const params = useParams();
  const router = useRouter();
  const noteId = params.id as string;

  const [note, setNote] = useState<(NoteDoc & { id: string }) | null>(null);
  const [elements, setElements] = useState<CanvasElement[]>([]);
  const [title, setTitle] = useState('');
  const [tool, setTool] = useState<Tool>('pen');
  const [penColor, setPenColor] = useState('#000000');
  const [penWidth, setPenWidth] = useState(4);
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const revisionRef = useRef(1);
  const saveTimer = useRef<NodeJS.Timeout | null>(null);
  const elementsRef = useRef(elements);
  elementsRef.current = elements;

  // Load note
  useEffect(() => {
    (async () => {
      try {
        // Check for pending offline changes first
        const pending = await getPending(noteId).catch(() => null);
        const res = await fetch(`/api/notes/${noteId}`);
        if (res.status === 401) { router.push('/notes'); return; }
        if (!res.ok) throw new Error('Failed to load note');
        const data = await res.json();
        setNote(data);
        setTitle(data.title);
        revisionRef.current = data.revision;
        if (pending && pending.updatedAt > new Date(data.updatedAt).getTime()) {
          // Local pending is newer — offer to keep it
          if (confirm('You have unsynced changes from offline. Keep them?')) {
            setElements(pending.elements as CanvasElement[]);
          } else {
            setElements(data.elements);
            await clearPending(noteId);
          }
        } else {
          setElements(data.elements);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Load failed');
      } finally {
        setLoading(false);
      }
    })();
  }, [noteId, router]);

  const handleElementsChange = useCallback((els: CanvasElement[], dirty = false) => {
    setElements(els);
    if (dirty) markDirty();
  }, []);

  const { execute, undo, redo, canUndo, canRedo } = useHistory(elements, handleElementsChange);

  const markDirty = useCallback(() => {
    setSaveState('saving');
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => save(), 800);
  }, []);

  const save = useCallback(async () => {
    if (!note) return;
    const els = elementsRef.current;
    try {
      const res = await fetch(`/api/notes/${noteId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          elements: els,
          title,
          baseRevision: revisionRef.current,
        }),
      });
      if (res.status === 409) {
        // Conflict — server has newer revision
        setSaveState('error');
        setError('Conflict: note changed elsewhere. Reload to merge.');
        // Save locally so work isn't lost
        await savePending({ noteId, elements: els, title, baseRevision: revisionRef.current, updatedAt: Date.now() });
        return;
      }
      if (!res.ok) throw new Error('Save failed');
      const data = await res.json();
      revisionRef.current = data.revision;
      setSaveState('saved');
      await clearPending(noteId).catch(() => {});
    } catch (e) {
      // Offline — save locally
      setSaveState('offline');
      await savePending({ noteId, elements: els, title, baseRevision: revisionRef.current, updatedAt: Date.now() }).catch(() => {});
    }
  }, [note, noteId, title]);

  // Save on page hide
  useEffect(() => {
    const onHide = () => { if (saveTimer.current) { clearTimeout(saveTimer.current); save(); } };
    document.addEventListener('visibilitychange', () => { if (document.hidden) onHide(); });
    window.addEventListener('beforeunload', onHide);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('beforeunload', onHide);
    };
  }, [save]);

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;
      const k = e.key.toLowerCase();
      if ((e.metaKey || e.ctrlKey) && k === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo(); else undo();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && k === 's') { e.preventDefault(); save(); return; }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const toolMap: Record<string, Tool> = {
        v: 'select', p: 'pen', e: 'eraser', h: 'hand', l: 'line',
        a: 'arrow', r: 'rectangle', o: 'ellipse', t: 'text',
      };
      if (toolMap[k]) setTool(toolMap[k]);
      if (k === 'delete' || k === 'backspace') {
        if (selectedIds.size > 0) {
          execute(deleteElementsCmd([...selectedIds]));
          setSelectedIds(new Set());
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo, save, selectedIds, execute]);

  // Title autosave
  const handleTitleChange = (v: string) => {
    setTitle(v);
    markDirty();
  };

  if (loading) {
    return <div className="flex h-screen items-center justify-center bg-black text-white/50">Loading…</div>;
  }
  if (error && !note) {
    return <div className="flex h-screen items-center justify-center bg-black text-red-400">{error}</div>;
  }

  return (
    <div className="flex h-screen flex-col bg-black text-white">
      {/* Top bar */}
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-white/10 px-4">
        <div className="flex min-w-0 items-center gap-3">
          <button onClick={() => router.push('/notes')} className="text-white/60 hover:text-white" title="Back to notes">
            ←
          </button>
          <input
            value={title}
            onChange={(e) => handleTitleChange(e.target.value)}
            className="min-w-0 flex-1 bg-transparent text-lg font-semibold outline-none placeholder:text-white/30"
            placeholder="Untitled"
          />
        </div>
        <div className="flex items-center gap-3">
          <span className={cn(
            'text-xs',
            saveState === 'saved' && 'text-white/40',
            saveState === 'saving' && 'text-amber-400',
            saveState === 'offline' && 'text-orange-400',
            saveState === 'error' && 'text-red-400',
          )}>
            {saveState === 'saved' && 'Saved'}
            {saveState === 'saving' && 'Saving…'}
            {saveState === 'offline' && 'Offline — saved locally'}
            {saveState === 'error' && 'Save failed'}
          </span>
          <button onClick={undo} disabled={!canUndo} className="rounded p-1.5 text-white/60 hover:bg-white/10 hover:text-white disabled:opacity-30" title="Undo (⌘Z)">↩</button>
          <button onClick={redo} disabled={!canRedo} className="rounded p-1.5 text-white/60 hover:bg-white/10 hover:text-white disabled:opacity-30" title="Redo (⇧⌘Z)">↪</button>
          <ExportMenu noteId={noteId} title={title} elements={elements} />
        </div>
      </header>

      {/* Canvas */}
      <div className="relative flex-1">
        <InfiniteCanvas
          elements={elements}
          onElementsChange={(els) => { setElements(els); }}
          onDirty={markDirty}
          tool={tool}
          penColor={penColor}
          penWidth={penWidth}
          background="#ffffff"
          selectedIds={selectedIds}
          onSelectionChange={setSelectedIds}
        />

        {/* Toolbar */}
        <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-2xl border border-white/10 bg-black/90 px-2 py-2 backdrop-blur">
          {TOOLS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTool(t.id)}
              title={`${t.label} (${t.shortcut})`}
              className={cn(
                'flex h-10 w-10 items-center justify-center rounded-xl text-lg transition',
                tool === t.id ? 'bg-amber-500/20 text-amber-400' : 'text-white/60 hover:bg-white/10 hover:text-white'
              )}
            >
              {t.icon}
            </button>
          ))}
        </div>

        {/* Color/width picker */}
        {(tool === 'pen' || tool === 'highlighter') && (
          <div className="absolute bottom-20 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-2xl border border-white/10 bg-black/90 px-3 py-2 backdrop-blur">
            {COLORS.map((c) => (
              <button
                key={c}
                onClick={() => setPenColor(c)}
                className={cn(
                  'h-7 w-7 rounded-full border-2 transition',
                  penColor === c ? 'border-amber-400 scale-110' : 'border-white/20'
                )}
                style={{ backgroundColor: c }}
                title={c}
              />
            ))}
            <div className="mx-1 h-6 w-px bg-white/10" />
            {WIDTHS.map((w) => (
              <button
                key={w}
                onClick={() => setPenWidth(w)}
                className={cn(
                  'flex h-7 w-7 items-center justify-center rounded-full transition',
                  penWidth === w ? 'bg-amber-500/20' : 'hover:bg-white/10'
                )}
                title={`${w}px`}
              >
                <span className="rounded-full bg-white" style={{ width: Math.min(w, 16), height: Math.min(w, 16) }} />
              </button>
            ))}
          </div>
        )}
      </div>

      {error && (
        <div className="shrink-0 border-t border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-400">
          {error}
        </div>
      )}
    </div>
  );
}
