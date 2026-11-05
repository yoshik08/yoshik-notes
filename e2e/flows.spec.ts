import fs from 'node:fs';
import { test, expect } from '@playwright/test';
import { MongoClient, ObjectId } from 'mongodb';
import { RUNTIME_FILE } from './env.mjs';
import { signIn, createNote, drawStroke, serverElements, listNotes } from './helpers';
import { LEGACY_ELEMENTS } from './fixtures';

// The hard rule for this app: create, edit, delete, draw and reload must all
// persist, for new notes and for notes saved by the previous app.

const saved = (page: import('@playwright/test').Page) => expect(page.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible({ timeout: 8_000 });

test('create from the library, title it, draw, reload: everything is still there', async ({ page, context }) => {
  await signIn(context, { googleId: `flow-create-${Date.now()}` });
  await page.goto('/notes');
  await page.getByRole('button', { name: /new note/i }).first().click();
  await expect(page).toHaveURL(/\/notes\/[0-9a-f]{24}$/);
  const id = page.url().split('/').pop()!;
  await expect(page.locator('canvas')).toBeVisible();

  await page.getByLabel('Note title').fill('Thermo, week 3');
  await drawStroke(page, [300, 300], [600, 360]);
  await drawStroke(page, [320, 420], [520, 400]);
  await saved(page);

  await page.reload();
  await expect(page.getByLabel('Note title')).toHaveValue('Thermo, week 3');
  const els = await serverElements(context.request, id);
  expect(els.filter((e) => e.type === 'stroke')).toHaveLength(2);

  await page.goto('/notes');
  await expect(page.getByText('Thermo, week 3').first()).toBeVisible();
});

test('erase, undo, and typed text all persist across reloads', async ({ page, context }) => {
  await signIn(context, { googleId: `flow-edit-${Date.now()}` });
  const id = await createNote(context.request, { title: 'Edits' });
  await page.goto(`/notes/${id}`);
  await expect(page.locator('canvas')).toBeVisible();

  await drawStroke(page, [300, 300], [700, 300]);
  await saved(page);
  expect(await serverElements(context.request, id)).toHaveLength(1);

  // Eraser across the stroke removes it.
  await page.keyboard.press('e');
  await drawStroke(page, [500, 240], [500, 360]);
  await expect.poll(async () => (await serverElements(context.request, id)).length, { timeout: 8_000 }).toBe(0);

  // Undo brings it back, and that is saved too.
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await serverElements(context.request, id)).length, { timeout: 8_000 }).toBe(1);

  // Typed text.
  await page.keyboard.press('t');
  const box = (await page.locator('canvas').boundingBox())!;
  await page.mouse.click(box.x + 400, box.y + 500);
  await page.getByLabel('Type on the page').fill('pV = nRT');
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await serverElements(context.request, id)).find((e) => e.type === 'text')?.text, { timeout: 8_000 }).toBe('pV = nRT');

  await page.reload();
  await expect(page.locator('canvas')).toBeVisible();
  const els = await serverElements(context.request, id);
  expect(els.map((e) => e.type).sort()).toEqual(['stroke', 'text']);
});

test('delete with undo, Recently deleted, restore, and delete forever', async ({ page, context }) => {
  await signIn(context, { googleId: `flow-delete-${Date.now()}` });
  const keep = await createNote(context.request, { title: 'Keep this one' });
  const toss = await createNote(context.request, { title: 'Toss this one' });
  await page.goto('/notes');

  const frame = page.locator(`[data-frame="${toss}"]`);
  await frame.hover();
  await page.getByRole('button', { name: 'Actions for Toss this one' }).click();
  await page.getByRole('menuitem', { name: 'Move to Recently deleted' }).click();
  await expect(frame).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect.poll(async () => (await listNotes(context.request)).map((n) => n.id).sort(), { timeout: 8_000 }).toEqual([keep, toss].sort());

  await page.reload();
  await page.locator(`[data-frame="${toss}"]`).hover();
  await page.getByRole('button', { name: 'Actions for Toss this one' }).click();
  await page.getByRole('menuitem', { name: 'Move to Recently deleted' }).click();
  await expect.poll(async () => (await listNotes(context.request)).map((n) => n.id), { timeout: 8_000 }).toEqual([keep]);

  await page.goto('/notes/trash');
  await expect(page.getByText('Toss this one')).toBeVisible();
  await page.locator(`[data-frame="${toss}"]`).hover();
  await page.getByRole('button', { name: 'Actions for Toss this one' }).click();
  await page.getByRole('menuitem', { name: 'Restore' }).click();
  await expect.poll(async () => (await listNotes(context.request)).length, { timeout: 8_000 }).toBe(2);

  // Delete forever needs a confirmation.
  await page.goto('/notes');
  await page.locator(`[data-frame="${toss}"]`).hover();
  await page.getByRole('button', { name: 'Actions for Toss this one' }).click();
  await page.getByRole('menuitem', { name: 'Move to Recently deleted' }).click();
  await page.goto('/notes/trash');
  await page.locator(`[data-frame="${toss}"]`).hover();
  await page.getByRole('button', { name: 'Actions for Toss this one' }).click();
  await page.getByRole('menuitem', { name: /Delete forever/ }).click();
  await page.getByRole('button', { name: 'Delete forever' }).click();
  await expect.poll(async () => (await context.request.get(`/notes/api/notes/${toss}`)).status(), { timeout: 8_000 }).toBe(404);
  expect((await listNotes(context.request)).map((n) => n.id)).toEqual([keep]);
});

test('a note saved by the previous app opens, renders, and keeps every untouched element when edited', async ({ page, context }) => {
  const owner = `flow-legacy-${Date.now()}`;
  await signIn(context, { googleId: owner });
  const { mongoUri } = JSON.parse(fs.readFileSync(RUNTIME_FILE, 'utf8'));
  const mongo = await MongoClient.connect(mongoUri);
  const when = new Date('2026-10-04T18:30:00Z');
  const { insertedId } = await mongo.db('notes').collection('notes').insertOne({
    ownerId: owner, title: 'Lecture 3 (old app)', elements: LEGACY_ELEMENTS, revision: 5, createdAt: when, updatedAt: when,
    appState: { viewX: 0, viewY: 0, zoom: 1 }, canvasSettings: { background: 'grid' },
  });
  const id = insertedId.toString();

  // The library develops a preview for it.
  await page.goto('/notes');
  await expect(page.getByText('Lecture 3 (old app)').first()).toBeVisible();
  await expect(page.locator(`[data-frame="${id}"] img`)).toBeVisible({ timeout: 10_000 });

  await page.goto(`/notes/${id}`);
  await expect(page.locator('canvas')).toBeVisible();
  await expect(page.getByLabel('Note title')).toHaveValue('Lecture 3 (old app)');
  // Ink is on the page: the canvas is not just blank paper.
  const inked = await page.locator('canvas').evaluate((c: HTMLCanvasElement) => {
    const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
    let dark = 0;
    for (let i = 0; i < d.length; i += 16) if (d[i] < 120 && d[i + 1] < 120 && d[i + 2] < 120) dark++;
    return dark;
  });
  expect(inked).toBeGreaterThan(50);

  await drawStroke(page, [900, 600], [1100, 650]);
  await saved(page);
  const stored = await mongo.db('notes').collection('notes').findOne({ _id: new ObjectId(id) });
  expect(stored!.elements.slice(0, LEGACY_ELEMENTS.length)).toEqual(LEGACY_ELEMENTS);
  expect(stored!.elements).toHaveLength(LEGACY_ELEMENTS.length + 1);
  const original = await mongo.db('notes').collection('note_versions').findOne({ noteId: new ObjectId(id), reason: 'original' });
  expect(original!.elements).toEqual(LEGACY_ELEMENTS);
  await mongo.close();
});

test('drawing offline is kept on the device and synced when the note is opened again online', async ({ browser }) => {
  const context = await browser.newContext({ baseURL: 'http://localhost:3100', viewport: { width: 1280, height: 800 } });
  await signIn(context, { googleId: `flow-offline-${Date.now()}` });
  const id = await createNote(context.request, { title: 'Offline lecture' });
  const page = await context.newPage();
  await page.goto(`/notes/${id}`);
  await expect(page.locator('canvas')).toBeVisible();
  await page.waitForTimeout(500);

  await context.setOffline(true);
  await drawStroke(page, [300, 300], [600, 380]);
  await drawStroke(page, [300, 420], [600, 460]);
  await expect(page.getByText('Offline, kept on this device')).toBeVisible({ timeout: 10_000 });
  await page.close();
  await context.setOffline(false);
  expect(await serverElements(context.request, id)).toHaveLength(0);

  const again = await context.newPage();
  await again.goto(`/notes/${id}`);
  await expect.poll(async () => (await serverElements(context.request, id)).length, { timeout: 10_000 }).toBe(2);
  await context.close();
});

test('ink written on the landing page can be kept as the first note after signing in', async ({ page, context }) => {
  await page.goto('/notes');
  const frame = page.getByLabel('Try writing here');
  await expect(frame).toBeVisible();
  const b = (await frame.boundingBox())!;
  await page.mouse.move(b.x + 60, b.y + 80);
  await page.mouse.down();
  for (let i = 0; i < 20; i++) await page.mouse.move(b.x + 60 + i * 12, b.y + 80 + Math.sin(i / 3) * 20);
  await page.mouse.up();
  await expect(page.getByText('Yours. Sign in to keep it.')).toBeVisible();

  await signIn(context, { googleId: `flow-landing-${Date.now()}` });
  await page.reload();
  await page.getByRole('button', { name: 'Keep it' }).click();
  await expect(page).toHaveURL(/\/notes\/[0-9a-f]{24}$/);
  const id = page.url().split('/').pop()!;
  await expect.poll(async () => (await serverElements(context.request, id)).length).toBe(1);
  await expect(page.getByLabel('Note title')).toHaveValue('First page');
});

test('a slow server copy never takes back ink that was saved while it loaded', async ({ page, context }) => {
  await signIn(context, { googleId: `flow-race-${Date.now()}` });
  const id = await createNote(context.request, { title: 'Race', elements: [LEGACY_ELEMENTS[0]] });
  const canvas = page.locator('canvas[data-marks]');

  // First visit stores the offline copy, so the next open shows the page at once.
  await page.goto(`/notes/${id}`);
  await expect(canvas).toHaveAttribute('data-marks', '1');
  await page.waitForTimeout(600);

  // Next open: the server reads the note now, but its answer arrives late.
  let release!: () => void;
  const released = new Promise<void>((r) => (release = r));
  let held = false;
  await page.route(`**/notes/api/notes/${id}`, async (route) => {
    if (route.request().method() !== 'GET' || held) return route.continue();
    held = true;
    const response = await route.fetch();
    await released;
    await route.fulfill({ response });
  });
  await page.reload();
  await expect(canvas).toHaveAttribute('data-marks', '1');

  // Write while it loads; the save lands before the old copy does.
  const savedStroke = page.waitForResponse((r) => r.request().method() === 'PATCH' && r.url().endsWith(id) && (r.request().postData() ?? '').includes('"ops"'));
  await drawStroke(page, [300, 300], [600, 360]);
  await expect(canvas).toHaveAttribute('data-marks', '2');
  expect((await savedStroke).ok()).toBe(true);
  release();

  // The late copy predates the stroke; the stroke stays on the page.
  await page.waitForTimeout(800);
  await expect(canvas).toHaveAttribute('data-marks', '2');
  expect(await serverElements(context.request, id)).toHaveLength(2);
});

test('keys pressed inside an open menu never edit the page behind it', async ({ page, context }) => {
  await signIn(context, { googleId: `flow-keys-${Date.now()}` });
  const id = await createNote(context.request, { title: 'Keys', elements: [LEGACY_ELEMENTS[0]] });
  await page.goto(`/notes/${id}`);
  const canvas = page.locator('canvas[data-marks]');
  await expect(canvas).toHaveAttribute('data-marks', '1');

  await page.keyboard.press('Control+a');
  await page.getByRole('button', { name: 'Note options' }).click();
  await expect(page.getByRole('menu')).toBeVisible();
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toBeHidden();
  await expect(canvas).toHaveAttribute('data-marks', '1');

  // The selection was there all along: with the menu closed, the same key deletes it.
  await page.keyboard.press('Backspace');
  await expect(canvas).toHaveAttribute('data-marks', '0');
});
