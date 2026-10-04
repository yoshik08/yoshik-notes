'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { NoteSummary } from './types';
import { apiJson } from './api';
import { relativeTime } from './time';

// Module-level cache so element counts are fetched once per note id.
const elementCountCache = new Map<string, number>();

interface NoteCardProps {
  note: NoteSummary;
  onRenamed: (id: string, title: string) => void;
  onDuplicated: () => void;
  onDeleted: (id: string) => void;
}

export default function NoteCard({ note, onRenamed, onDuplicated, onDeleted }: NoteCardProps) {
  const router = useRouter();
  const [elementCount, setElementCount] = useState<number | null>(
    () => elementCountCache.get(note.id) ?? null
  );
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note.title);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Lazy element count from the detail endpoint (list projection omits elements).
  useEffect(() => {
    if (elementCountCache.has(note.id)) return;
    let alive = true;
    apiJson<{ elements: Array<{ id: string }> }>(`/api/notes/${note.id}`)
      .then((data) => {
        if (!alive) return;
        elementCountCache.set(note.id, data.elements.length);
        setElementCount(data.elements.length);
      })
      .catch(() => {
        /* leave as unknown — non-fatal */
      });
    return () => {
      alive = false;
    };
  }, [note.id]);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  const displayTitle = note.title.trim() || 'Untitled';

  const commitRename = async () => {
    const next = draft.trim();
    setEditing(false);
    if (!next || next === note.title) {
      setDraft(note.title);
      return;
    }
    setBusy(true);
    try {
      await apiJson(`/api/notes/${note.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ title: next }),
      });
      onRenamed(note.id, next);
    } catch {
      setDraft(note.title);
    } finally {
      setBusy(false);
    }
  };

  const handleDuplicate = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (busy) return;
    setBusy(true);
    try {
      await apiJson(`/api/notes/${note.id}/duplicate`, { method: 'POST' });
      onDuplicated();
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (busy) return;
    if (!window.confirm(`Delete "${displayTitle}"? This can't be undone.`)) return;
    setBusy(true);
    try {
      await apiJson(`/api/notes/${note.id}`, { method: 'DELETE' });
      elementCountCache.delete(note.id);
      onDeleted(note.id);
    } finally {
      setBusy(false);
    }
  };

  const openNote = (e: React.MouseEvent) => {
    // Let real links/buttons/inputs handle themselves; card body opens the note.
    if ((e.target as HTMLElement).closest('button, input, a')) return;
    router.push(`/${note.id}`);
  };

  return (
    <article
      onClick={openNote}
      className="group flex cursor-pointer flex-col rounded-xl border border-[#1a1a1a] bg-black p-4 transition-colors hover:border-[#2e2e2e]"
    >
      <div className="flex items-start justify-between gap-2">
        {editing ? (
          <input
            ref={inputRef}
            value={draft}
            disabled={busy}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void commitRename();
              if (e.key === 'Escape') {
                setDraft(note.title);
                setEditing(false);
              }
            }}
            onBlur={() => void commitRename()}
            aria-label="Rename note"
            className="w-full rounded-md border border-[#E9A13B] bg-black px-2 py-1 text-base font-medium text-white focus:outline-none"
          />
        ) : (
          <Link
            href={`/${note.id}`}
            onClick={(e) => e.stopPropagation()}
            className="min-w-0 flex-1 truncate text-base font-medium text-white hover:underline"
            title={displayTitle}
          >
            {displayTitle}
          </Link>
        )}
      </div>

      <p className="mt-2 text-xs text-neutral-500">
        {relativeTime(note.updatedAt)}
        <span className="mx-1.5 text-neutral-700">·</span>
        {elementCount === null ? '…' : `${elementCount} element${elementCount === 1 ? '' : 's'}`}
      </p>

      <div className="mt-3 flex items-center justify-end gap-1 border-t border-[#1a1a1a] pt-2 transition-opacity md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100">
        <button
          type="button"
          disabled={busy}
          onClick={(e) => {
            e.stopPropagation();
            setDraft(note.title);
            setEditing(true);
          }}
          className="rounded-md px-2 py-1 text-xs font-medium text-neutral-400 hover:bg-[#1a1a1a] hover:text-white disabled:opacity-50"
        >
          Rename
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={handleDuplicate}
          className="rounded-md px-2 py-1 text-xs font-medium text-neutral-400 hover:bg-[#1a1a1a] hover:text-white disabled:opacity-50"
        >
          Duplicate
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={handleDelete}
          className="rounded-md px-2 py-1 text-xs font-medium text-neutral-400 hover:bg-[#1a1a1a] hover:text-red-400 disabled:opacity-50"
        >
          Delete
        </button>
      </div>
    </article>
  );
}
