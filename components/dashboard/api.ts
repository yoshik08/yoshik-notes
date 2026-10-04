// Shared API helpers for the notes dashboard.
// The app is served at /notes in production (proxy rewrite) and at / in dev,
// so API paths get a /notes prefix only on the production host.

export function apiBase(): string {
  if (typeof window !== 'undefined' && window.location.hostname.endsWith('yoshik.xyz')) {
    return '/notes';
  }
  return '';
}

export function apiUrl(path: string): string {
  return `${apiBase()}${path}`;
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

/** fetch + JSON parse with typed result. Throws ApiError (401 on unauthenticated). */
export async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(apiUrl(path), {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (res.status === 401) throw new ApiError(401, 'Unauthorized');
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = (await res.json()) as { error?: unknown };
      if (typeof body.error === 'string' && body.error) message = body.error;
    } catch {
      /* ignore parse errors */
    }
    throw new ApiError(res.status, message);
  }
  return (await res.json()) as T;
}
