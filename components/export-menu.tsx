'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { CanvasElement } from '@/lib/db/models';
import {
  exportPNG,
  exportSVG,
  exportJSON,
  download,
  downloadText,
  safeFilename,
} from '@/lib/export/exporters';
import { validateImport } from '@/lib/export/importer';

interface ExportMenuProps {
  noteId: string;
  title: string;
  elements: CanvasElement[];
}

type Status = { msg: string; tone: 'ok' | 'err' } | null;

export function ExportMenu({ title, elements }: ExportMenuProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open ]);

  // Clear status after a few seconds
  useEffect(() => {
    if (!status) return;
    const t = setTimeout(() => setStatus(null), 4000);
    return () => clearTimeout(t);
  }, [status]);

  const ok = (msg: string) => setStatus({ msg, tone: 'ok' });
  const err = (msg: string) => setStatus({ msg, tone: 'err' });

  const withBusy = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      err(e instanceof Error ? e.message : 'Export failed');
    } finally {
      setBusy(false);
      setOpen(false);
    }
  };

  const doPNG = () =>
    withBusy(async () => {
      const blob = await exportPNG(elements);
      download(blob, `${safeFilename(title)}.png`);
      ok('PNG exported');
    });

  const doSVG = () =>
    withBusy(async () => {
      const svg = exportSVG(elements);
      downloadText(svg, `${safeFilename(title)}.svg`, 'image/svg+xml');
      ok('SVG exported');
    });

  const doJSON = () =>
    withBusy(async () => {
      const json = exportJSON({ title, elements });
      downloadText(json, `${safeFilename(title)}.json`, 'application/json');
      ok('JSON exported');
    });

  const onFileChosen = async (file: File) => {
    setBusy(true);
    setOpen(false);
    try {
      if (file.size > 10_000_000) throw new Error('File too large (10MB max)');
      const text = await file.text();
      let data: unknown;
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error('Not valid JSON');
      }
      const res = validateImport(data);
      if (!res.ok || !res.note) throw new Error(res.error ?? 'Invalid note file');

      // Create a new note, then fill it with the imported content
      const createRes = await fetch('/api/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: `${res.note.title} (imported)` }),
      });
      if (!createRes.ok) throw new Error('Failed to create note');
      const created = (await createRes.json()) as { id?: string };
      if (!created.id) throw new Error('Failed to create note');

      const patchRes = await fetch(`/api/notes/${created.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: `${res.note.title} (imported)`,
          elements: res.note.elements,
          ...(res.note.appState ? { appState: res.note.appState } : {}),
          ...(res.note.canvasSettings ? { canvasSettings: res.note.canvasSettings } : {}),
        }),
      });
      if (!patchRes.ok) throw new Error('Failed to save imported content');

      ok(`Imported ${res.note.elements.length} elements`);
      router.push(`/notes/${created.id}`);
    } catch (e) {
      err(e instanceof Error ? e.message : 'Import failed');
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const itemCls =
    'block w-full px-4 py-2 text-left text-sm text-white/80 hover:bg-white/10 hover:text-white disabled:opacity-40';

  return (
    <div ref={menuRef} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        disabled={busy}
        title="Export / import"
        className="rounded p-1.5 text-white/60 hover:bg-white/10 hover:text-white disabled:opacity-30"
      >
        {busy ? '…' : '⇪'}
      </button>

      {status && (
        <div
          className={`absolute right-0 top-full z-20 mt-2 whitespace-nowrap rounded-lg border px-3 py-1.5 text-xs ${
            status.tone === 'ok'
              ? 'border-white/10 bg-black text-white/70'
              : 'border-red-500/30 bg-black text-red-400'
          }`}
        >
          {status.msg}
        </div>
      )}

      {open && (
        <div className="absolute right-0 top-full z-20 mt-2 w-44 overflow-hidden rounded-xl border border-white/10 bg-black/95 shadow-xl backdrop-blur">
          <button className={itemCls} onClick={doPNG} disabled={busy}>
            Export PNG
          </button>
          <button className={itemCls} onClick={doSVG} disabled={busy}>
            Export SVG
          </button>
          <button className={itemCls} onClick={doJSON} disabled={busy}>
            Export JSON
          </button>
          <div className="border-t border-white/10" />
          <button
            className={itemCls}
            onClick={() => fileRef.current?.click()}
            disabled={busy}
          >
            Import JSON…
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onFileChosen(f);
            }}
          />
        </div>
      )}
    </div>
  );
}
