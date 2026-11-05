// Library data shapes and small formatting helpers.

export interface NoteSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  revision: number;
  elementCount: number;
  /** Text typed into the note (first few hundred characters), for search. */
  text: string;
  background: '#ffffff' | '#000000';
  pattern: 'none' | 'dots' | 'grid' | 'ruled';
  thumbAt: number | null;
  deletedAt: string | null;
}

export type SortKey = 'updated' | 'created' | 'title';

const day = 86_400_000;

/** Compact, edge-print style dates: "now", "12 min", "3 h", "Yesterday", "Mon", "12 Oct", "Oct 2025". */
export function shortWhen(iso: string, now = Date.now()): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const diff = now - t;
  if (diff < 60_000) return 'now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} min`;
  const d = new Date(t);
  const today = new Date(now);
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  if (t >= startOfToday) return `${Math.floor(diff / 3_600_000)} h`;
  if (t >= startOfToday - day) return 'Yesterday';
  if (t >= startOfToday - 6 * day) return d.toLocaleDateString(undefined, { weekday: 'short' });
  if (d.getFullYear() === today.getFullYear()) return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  return d.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
}

/** Days left before a deleted note is purged (30-day window). */
export function daysLeft(deletedAt: string, now = Date.now()): number {
  return Math.max(0, 30 - Math.floor((now - new Date(deletedAt).getTime()) / day));
}

export function sortNotes(notes: NoteSummary[], sort: SortKey): NoteSummary[] {
  const out = notes.slice();
  if (sort === 'title') out.sort((a, b) => (a.title || 'Untitled').localeCompare(b.title || 'Untitled', undefined, { sensitivity: 'base' }));
  else if (sort === 'created') out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  else out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return out;
}

/** Frame numbers follow shooting order: the first note ever made is frame 1. */
export function frameNumbers(notes: NoteSummary[]): Map<string, number> {
  const byCreated = notes.slice().sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return new Map(byCreated.map((n, i) => [n.id, i + 1]));
}

export function matches(note: NoteSummary, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (note.title || 'Untitled').toLowerCase().includes(q) || note.text.toLowerCase().includes(q);
}
