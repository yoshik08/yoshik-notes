import { encode } from 'next-auth/jwt';
import type { BrowserContext, APIRequestContext } from '@playwright/test';
import { E2E_SECRET, SESSION_COOKIE, PROXY_PORT } from './env.mjs';

export const ORIGIN = `http://localhost:${PROXY_PORT}`;

/** Sign a browser context in as a test user (same JWT the app issues after Google sign-in). */
export async function signIn(context: BrowserContext, user: { googleId: string; name?: string; email?: string }) {
  const value = await encode({
    secret: E2E_SECRET,
    token: {
      sub: user.googleId,
      googleId: user.googleId,
      name: user.name ?? 'Test User',
      email: user.email ?? `${user.googleId}@example.test`,
    },
  });
  await context.addCookies([
    { name: SESSION_COOKIE, value, domain: 'localhost', path: '/', httpOnly: true, secure: true, sameSite: 'Lax' },
  ]);
}

/** Create a note through the public API (as the signed-in context) and fill it. */
export async function createNote(
  request: APIRequestContext,
  note: { title: string; elements?: unknown[]; canvasSettings?: unknown; appState?: unknown },
): Promise<string> {
  const created = await request.post(`${ORIGIN}/notes/api/notes`, { data: { title: note.title } });
  if (!created.ok()) throw new Error(`create failed ${created.status()} ${await created.text()}`);
  const { id } = (await created.json()) as { id: string };
  if (note.elements || note.canvasSettings || note.appState) {
    const patched = await request.patch(`${ORIGIN}/notes/api/notes/${id}`, {
      data: { elements: note.elements, canvasSettings: note.canvasSettings, appState: note.appState },
    });
    if (!patched.ok()) throw new Error(`fill failed ${patched.status()} ${await patched.text()}`);
  }
  return id;
}

export async function getNote(request: APIRequestContext, id: string) {
  const res = await request.get(`${ORIGIN}/notes/api/notes/${id}`);
  return { status: res.status(), body: res.ok() ? await res.json() : null };
}

export async function listNotes(request: APIRequestContext) {
  const res = await request.get(`${ORIGIN}/notes/api/notes`);
  if (!res.ok()) throw new Error(`list failed ${res.status()}`);
  return ((await res.json()) as { notes: Array<{ id: string; title: string }> }).notes;
}
