import fs from 'node:fs';
import { test, expect, request as pwRequest, type APIRequestContext } from '@playwright/test';
import { encode } from 'next-auth/jwt';
import { MongoClient, ObjectId } from 'mongodb';
import { E2E_SECRET, SESSION_COOKIE, RUNTIME_FILE } from './env.mjs';
import { ORIGIN } from './helpers';
import { LEGACY_ELEMENTS, PNG_1PX } from './fixtures';

// Data-safety behaviour of the notes store, including notes written by the
// previous version of the app (raw documents inserted straight into MongoDB).

const api = (p = '') => `/notes/api/notes${p}`;

async function asUser(googleId: string): Promise<APIRequestContext> {
  const token = await encode({ secret: E2E_SECRET, token: { sub: googleId, googleId, name: googleId } });
  return pwRequest.newContext({ baseURL: ORIGIN, extraHTTPHeaders: { cookie: `${SESSION_COOKIE}=${token}` } });
}


let mongo: MongoClient;
test.beforeAll(async () => {
  const { mongoUri } = JSON.parse(fs.readFileSync(RUNTIME_FILE, 'utf8'));
  mongo = await MongoClient.connect(mongoUri);
});
test.afterAll(async () => mongo?.close());

async function insertLegacy(owner: string, doc: Record<string, unknown>) {
  const now = new Date('2026-10-04T18:30:00Z');
  const res = await mongo.db('notes').collection('notes').insertOne({ ownerId: owner, createdAt: now, updatedAt: now, revision: 7, ...doc });
  return res.insertedId.toString();
}

test.describe('legacy notes from the previous app', () => {
  test('load unchanged, list with counts and text, and normalise old settings on read only', async () => {
    const owner = `legacy-${Date.now()}`;
    const me = await asUser(owner);
    const full = await insertLegacy(owner, { title: 'Lecture 4', elements: LEGACY_ELEMENTS, appState: { viewX: 5, viewY: 6, zoom: 1.5 }, canvasSettings: { background: '#ffffff' } });
    const grid = await insertLegacy(owner, { title: 'Grid page', elements: LEGACY_ELEMENTS.slice(0, 2), appState: { viewX: 0, viewY: 0, zoom: 1 }, canvasSettings: { background: 'grid' } });
    const bare = await insertLegacy(owner, { title: 'Very old', elements: LEGACY_ELEMENTS.slice(6) });

    const a = await (await me.get(api(`/${full}`))).json();
    expect(a.elements).toEqual(LEGACY_ELEMENTS);
    expect(a.appState).toEqual({ viewX: 5, viewY: 6, zoom: 1.5 });
    expect(a.revision).toBe(7);

    const b = await (await me.get(api(`/${grid}`))).json();
    expect(b.canvasSettings).toEqual({ background: '#ffffff', pattern: 'grid' });
    const stored = await mongo.db('notes').collection('notes').findOne({ _id: new ObjectId(grid) });
    expect(stored!.canvasSettings).toEqual({ background: 'grid' }); // reading never rewrites

    const c = await (await me.get(api(`/${bare}`))).json();
    expect(c.appState).toEqual({ viewX: 0, viewY: 0, zoom: 1 });
    expect(c.canvasSettings).toEqual({ background: '#ffffff', pattern: 'none' });

    const { notes } = await (await me.get(api())).json();
    const row = notes.find((n: { id: string }) => n.id === full);
    expect(row).toMatchObject({ title: 'Lecture 4', elementCount: 8, revision: 7 });
    expect(row.text).toContain('Fourier');
    expect(notes).toHaveLength(3);
  });

  test('first edit keeps the original as a version, other elements stay byte-identical, original restores', async () => {
    const owner = `legacy-edit-${Date.now()}`;
    const me = await asUser(owner);
    const id = await insertLegacy(owner, { title: 'Lecture 5', elements: LEGACY_ELEMENTS, appState: { viewX: 0, viewY: 0, zoom: 1 }, canvasSettings: { background: '#000000' } });

    const moved = { ...LEGACY_ELEMENTS[4], x: 999 };
    const res = await me.patch(api(`/${id}`), { data: { ops: { upsert: [moved], delete: ['l-line'] } } });
    expect(await res.json()).toEqual({ ok: true, revision: 8 });

    const after = await (await me.get(api(`/${id}`))).json();
    const expected = LEGACY_ELEMENTS.filter((e) => e.id !== 'l-line').map((e) => (e.id === 'l-rect' ? moved : e));
    expect(after.elements).toEqual(expected);

    const { versions } = await (await me.get(api(`/${id}/versions`))).json();
    expect(versions).toHaveLength(1);
    expect(versions[0]).toMatchObject({ reason: 'original', revision: 7, elementCount: 8 });
    const original = await (await me.get(api(`/${id}/versions/${versions[0].id}`))).json();
    expect(original.elements).toEqual(LEGACY_ELEMENTS);

    const restored = await me.post(api(`/${id}/versions/${versions[0].id}/restore`));
    expect(await restored.json()).toEqual({ ok: true, revision: 9 });
    expect((await (await me.get(api(`/${id}`))).json()).elements).toEqual(LEGACY_ELEMENTS);
  });
});

test.describe('store safety', () => {
  test('delete moves to Recently deleted; restore brings it back; permanent delete only from there', async () => {
    const me = await asUser(`trash-${Date.now()}`);
    const { id } = await (await me.post(api(), { data: { title: 'Keep me' } })).json();

    expect((await me.delete(api(`/${id}?permanent=1`))).status()).toBe(404); // not in trash yet
    expect((await me.delete(api(`/${id}`))).status()).toBe(200);
    expect((await me.delete(api(`/${id}`))).status()).toBe(404);

    const trashed = await (await me.get(api(`/${id}`))).json();
    expect(trashed.deletedAt).toBeTruthy();
    expect((await (await me.get(api())).json()).notes).toHaveLength(0);
    expect((await (await me.get(api('?trash=1'))).json()).notes.map((n: { id: string }) => n.id)).toEqual([id]);
    const blocked = await me.patch(api(`/${id}`), { data: { title: 'edit while deleted' } });
    expect(blocked.status()).toBe(410);

    expect((await me.post(api(`/${id}/restore`))).status()).toBe(200);
    expect((await (await me.get(api())).json()).notes.map((n: { id: string }) => n.id)).toEqual([id]);

    await me.delete(api(`/${id}`));
    expect((await me.delete(api(`/${id}?permanent=1`))).status()).toBe(200);
    expect((await me.get(api(`/${id}`))).status()).toBe(404);
  });

  test('notes deleted more than 30 days ago are purged with their versions', async () => {
    const owner = `purge-${Date.now()}`;
    const me = await asUser(owner);
    const id = await insertLegacy(owner, { title: 'Old', elements: LEGACY_ELEMENTS.slice(0, 1), deletedAt: new Date(Date.now() - 31 * 86_400_000) });
    await mongo.db('notes').collection('note_versions').insertOne({ noteId: new ObjectId(id), ownerId: owner, revision: 1, title: 'Old', elements: [], canvasSettings: { background: '#ffffff' }, createdAt: new Date(), reason: 'original' });
    expect((await (await me.get(api('?trash=1'))).json()).notes).toHaveLength(0);
    expect(await mongo.db('notes').collection('notes').countDocuments({ _id: new ObjectId(id) })).toBe(0);
    expect(await mongo.db('notes').collection('note_versions').countDocuments({ noteId: new ObjectId(id) })).toBe(0);
  });

  test('element ops from two devices at once all land (no lost updates)', async () => {
    const owner = `ops-${Date.now()}`;
    const phone = await asUser(owner);
    const ipad = await asUser(owner);
    const { id } = await (await phone.post(api(), { data: { title: 'Busy' } })).json();
    const stroke = (sid: string) => ({ id: sid, type: 'stroke', x: 0, y: 0, color: '#000000', width: 3, points: [{ x: 0, y: 0 }, { x: 5, y: 5 }] });
    const writes = Array.from({ length: 8 }, (_, i) => [
      phone.patch(api(`/${id}`), { data: { ops: { upsert: [stroke(`p${i}`)] } } }),
      ipad.patch(api(`/${id}`), { data: { ops: { upsert: [stroke(`i${i}`)] } } }),
    ]).flat();
    const results = await Promise.all(writes);
    expect(results.map((r) => r.status())).toEqual(Array(16).fill(200));
    const note = await (await phone.get(api(`/${id}`))).json();
    expect(note.elements).toHaveLength(16);
    expect(note.revision).toBe(17);
  });

  test('thumbnails and view position never count as edits', async () => {
    const me = await asUser(`thumb-${Date.now()}`);
    const { id } = await (await me.post(api(), { data: { title: 'Thumb' } })).json();
    const r1 = await me.patch(api(`/${id}`), { data: { thumb: PNG_1PX, appState: { viewX: 10, viewY: 20, zoom: 2 } } });
    expect(await r1.json()).toEqual({ ok: true, revision: 1 });
    const { notes } = await (await me.get(api())).json();
    expect(typeof notes[0].thumbAt).toBe('number');
    const img = await me.get(api(`/${id}/thumb?v=${notes[0].thumbAt}`));
    expect(img.status()).toBe(200);
    expect(img.headers()['content-type']).toBe('image/png');
    expect(img.headers()['cache-control']).toContain('immutable');
    expect((await img.body()).length).toBeGreaterThan(20);
    expect((await (await me.get(api(`/${id}`))).json()).appState).toEqual({ viewX: 10, viewY: 20, zoom: 2 });
  });

  test('malformed writes are rejected without touching the note', async () => {
    const me = await asUser(`bad-${Date.now()}`);
    const { id } = await (await me.post(api(), { data: { title: 'Safe' } })).json();
    for (const body of ['"a string"', '[1]', 'null']) {
      const res = await me.patch(api(`/${id}`), { headers: { 'content-type': 'application/json' }, data: Buffer.from(body) });
      expect(res.status(), body).toBe(400);
    }
    const bad = [
      { ops: { upsert: [{ id: 'x', type: 'stroke', x: 0, y: 0, points: [{ x: 'NaN', y: 0 }], color: '#000', width: 2 }] } },
      { ops: { upsert: [{ id: 'x', type: 'image', x: 0, y: 0, width: 5, height: 5, src: 'javascript:alert(1)' }] } },
      { ops: { delete: [42] } },
      { canvasSettings: { background: 'red' } },
      { appState: { viewX: 0, viewY: 0, zoom: -1 } },
      { thumb: 'data:text/html;base64,PGgxPg==' },
    ];
    for (const data of bad) expect((await me.patch(api(`/${id}`), { data })).status(), JSON.stringify(data)).toBe(400);
    const note = await (await me.get(api(`/${id}`))).json();
    expect(note).toMatchObject({ revision: 1, elements: [], title: 'Safe' });
  });
});
