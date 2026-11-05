// Client-side JSON fetch with the failure modes the UI needs to tell apart.

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public body: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'ApiError';
  }
  /** Network down, timeout, or server/database trouble: worth retrying later. */
  get transient() {
    return this.status === 0 || this.status === 408 || this.status === 429 || this.status >= 500;
  }
}

export interface ApiOptions extends Omit<RequestInit, 'body'> {
  json?: unknown;
  timeoutMs?: number;
}

/** fetch + JSON with a timeout; throws ApiError (status 0 = network/timeout). */
export async function api<T>(url: string, { json, timeoutMs = 15_000, headers, ...init }: ApiOptions = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      signal: init.signal ?? AbortSignal.timeout(timeoutMs),
      ...init,
      headers: { ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: json !== undefined ? JSON.stringify(json) : undefined,
    });
  } catch (e) {
    const timedOut = e instanceof DOMException && (e.name === 'TimeoutError' || e.name === 'AbortError');
    throw new ApiError(0, timedOut ? 'The server took too long to respond.' : 'You’re offline or the server can’t be reached.');
  }
  let body: Record<string, unknown> = {};
  try {
    body = (await res.json()) as Record<string, unknown>;
  } catch {
    /* empty or non-JSON body */
  }
  if (!res.ok) {
    const message = typeof body.error === 'string' && body.error ? body.error : `Request failed (${res.status})`;
    throw new ApiError(res.status, res.status === 401 ? 'Your session ended. Sign in again.' : message, body);
  }
  return body as T;
}
