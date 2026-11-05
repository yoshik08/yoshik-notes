import { test, expect, type Page } from '@playwright/test';
import { signIn, createNote, getNote } from './helpers';

async function drawStroke(page: Page, from: [number, number], to: [number, number]) {
  const box = (await page.locator('canvas').first().boundingBox())!;
  await page.mouse.move(box.x + from[0], box.y + from[1]);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) {
    await page.mouse.move(box.x + from[0] + ((to[0] - from[0]) * i) / 12, box.y + from[1] + ((to[1] - from[1]) * i) / 12);
  }
  await page.mouse.up();
}

test('a drawn stroke autosaves and survives reload', async ({ page, context }) => {
  await signIn(context, { googleId: `persist-${Date.now()}` });
  const id = await createNote(context.request, { title: 'Autosave check' });

  await page.goto(`/notes/${id}`);
  await expect(page.locator('canvas').first()).toBeVisible();
  await drawStroke(page, [300, 300], [600, 380]);

  // Autosave runs after a short debounce; the server must have it without any tab switch or reload.
  await expect.poll(async () => (await getNote(context.request, id)).body?.elements?.length ?? 0, { timeout: 6_000 }).toBe(1);

  await page.reload();
  await expect(page.locator('canvas').first()).toBeVisible();
  expect((await getNote(context.request, id)).body.elements).toHaveLength(1);
});
