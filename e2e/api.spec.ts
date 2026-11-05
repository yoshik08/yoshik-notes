import { test, expect, request as pwRequest, type APIRequestContext } from '@playwright/test';
import { encode } from 'next-auth/jwt';
import { E2E_SECRET, SESSION_COOKIE } from './env.mjs';
import { ORIGIN } from './helpers';

// Contract for the notes API: status codes, shapes, ownership and revisions.
// The server-side refactor must keep every assertion here passing.

async function asUser(googleId: string): Promise<APIRequestContext> {
  const token = await encode({ secret: E2E_SECRET, token: { sub: googleId, googleId, name: googleId } });
  return pwRequest.newContext({ baseURL: ORIGIN, extraHTTPHeaders: { cookie: `${SESSION_COOKIE}=${token}` } });
}

const api = (p = '') => `/notes/api/notes${p}`;
const stroke = (id: string) => ({ id, type: 'stroke', x: 0, y: 0, color: '#000000', width: 4, points: [{ x: 0, y: 0, pressure: 0.5 }, { x: 10, y: 5, pressure: 0.6 }] });

test.describe('notes API contract', () => {
  let alice: APIRequestContext;
  let bob: APIRequestContext;
  test.beforeAll(async () => {
    alice = await asUser(`alice-${Date.now()}`);
    bob = await asUser(`bob-${Date.now()}`);
  });

  test('unauthenticated requests get 401 JSON', async () => {
    const anon = await pwRequest.newContext({ baseURL: ORIGIN });
    for (const [method, path] of [['get', api()], ['post', api()], ['get', api('/000000000000000000000000')]] as const) {
      const res = await anon[method](path);
      expect(res.status()).toBe(401);
      expect(await res.json()).toEqual({ error: 'Unauthorized' });
    }
  });

  test('create, read, list, update with revisions, conflict, delete', async () => {
    const created = await alice.post(api(), { data: { title: '  Lecture 1  ' } });
    expect(created.status()).toBe(201);
    const { id, title } = await created.json();
    expect(title).toBe('Lecture 1');
    expect(id).toMatch(/^[0-9a-f]{24}$/);

    const untitled = await alice.post(api());
    expect(untitled.status()).toBe(201);
    expect((await untitled.json()).title).toBe('Untitled');

    const got = await alice.get(api(`/${id}`));
    expect(got.status()).toBe(200);
    const note = await got.json();
    expect(note).toMatchObject({ id, title: 'Lecture 1', elements: [], revision: 1, appState: { viewX: 0, viewY: 0, zoom: 1 }, canvasSettings: { background: '#ffffff' } });
    expect(typeof note.createdAt).toBe('string');

    const patched = await alice.patch(api(`/${id}`), { data: { elements: [stroke('s1')], baseRevision: 1, title: 'Lecture 1 (edited)' } });
    expect(patched.status()).toBe(200);
    expect(await patched.json()).toEqual({ ok: true, revision: 2 });

    const stale = await alice.patch(api(`/${id}`), { data: { elements: [], baseRevision: 1 } });
    expect(stale.status()).toBe(409);
    expect(await stale.json()).toEqual({ error: 'Conflict', serverRevision: 2 });

    const noBase = await alice.patch(api(`/${id}`), { data: { title: 'No base revision' } });
    expect(await noBase.json()).toEqual({ ok: true, revision: 3 });

    const bad = await alice.patch(api(`/${id}`), { data: { elements: [{ id: 5, type: 'stroke' }] } });
    expect(bad.status()).toBe(400);
    expect(await bad.json()).toMatchObject({ error: 'Invalid element data' });

    // A Buffer is sent byte-for-byte (a string would be JSON-encoded into valid JSON).
    const badJson = await alice.patch(api(`/${id}`), { headers: { 'content-type': 'application/json' }, data: Buffer.from('{nope') });
    expect(badJson.status()).toBe(400);

    const list = await (await alice.get(api())).json();
    expect(list.notes[0]).toMatchObject({ id, title: 'No base revision', revision: 3 });
    expect(Object.keys(list.notes[0]).sort()).toEqual(expect.arrayContaining(['createdAt', 'id', 'revision', 'title', 'updatedAt']));

    const after = await (await alice.get(api(`/${id}`))).json();
    expect(after.elements).toEqual([stroke('s1')]);

    const del = await alice.delete(api(`/${id}`));
    expect(del.status()).toBe(200);
    expect(await del.json()).toEqual({ ok: true });
    // Since the trash feature, a deleted note is kept (with deletedAt) until purged.
    expect((await (await alice.get(api(`/${id}`))).json()).deletedAt).toBeTruthy();
    expect((await alice.delete(api(`/${id}`))).status()).toBe(404);
  });

  test('notes are invisible and immutable to other users', async () => {
    const { id } = await (await alice.post(api(), { data: { title: 'Private' } })).json();
    expect((await bob.get(api(`/${id}`))).status()).toBe(404);
    expect((await bob.patch(api(`/${id}`), { data: { title: 'pwned' } })).status()).toBe(404);
    expect((await bob.delete(api(`/${id}`))).status()).toBe(404);
    expect((await bob.post(api(`/${id}/duplicate`))).status()).toBe(404);
    const bobs = await (await bob.get(api())).json();
    expect(bobs.notes.find((n: { id: string }) => n.id === id)).toBeUndefined();
    expect((await (await alice.get(api(`/${id}`))).json()).title).toBe('Private');
  });

  test('invalid ids are 400', async () => {
    expect((await alice.get(api('/not-an-id'))).status()).toBe(400);
    expect((await alice.patch(api('/not-an-id'), { data: {} })).status()).toBe(400);
    expect((await alice.delete(api('/not-an-id'))).status()).toBe(400);
  });

  test('duplicate makes an independent copy with fresh element ids', async () => {
    const { id } = await (await alice.post(api(), { data: { title: 'Original' } })).json();
    await alice.patch(api(`/${id}`), { data: { elements: [stroke('a'), stroke('b')] } });
    const dup = await alice.post(api(`/${id}/duplicate`));
    expect(dup.status()).toBe(201);
    const copy = await dup.json();
    expect(copy.title).toBe('Original (copy)');
    const copyNote = await (await alice.get(api(`/${copy.id}`))).json();
    expect(copyNote.revision).toBe(1);
    expect(copyNote.elements).toHaveLength(2);
    expect(copyNote.elements.map((e: { id: string }) => e.id)).not.toContain('a');
  });
});
