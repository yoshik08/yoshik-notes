// Note shape returned by GET /api/notes (list projection).
export interface NoteSummary {
  id: string;
  title: string;
  updatedAt: string; // ISO date string
  createdAt: string; // ISO date string
  revision: number;
}

export type SortKey = 'updated' | 'created' | 'title';
