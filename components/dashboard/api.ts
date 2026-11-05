// Shared API helpers. The app is always addressed under /notes: via
// yoshik-proxy in production, and via the /notes rewrite in next.config.ts
// everywhere else, so there is one URL scheme and no host sniffing.

export const BASE_PATH = '/notes';

export function apiUrl(path: string): string {
  return `${BASE_PATH}${path}`;
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
  let res: Response;
  try {
    res = await fetch(apiUrl(path), {
      // A stalled network must end in an error state, never an endless spinner.
      signal: AbortSignal.timeout(15_000),
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    });
  } catch (e) {
    const timedOut = e instanceof DOMException && e.name === 'TimeoutError';
    throw new ApiError(0, timedOut ? 'The server took too long to respond' : 'Network error — check your connection');
  }
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
