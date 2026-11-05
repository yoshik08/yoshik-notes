import { test, expect, devices, type Page } from '@playwright/test';
import { signIn, createNote, drawStroke } from './helpers';

// The enlarger: tapping a frame grows it into the page straight away, even
// when the note's route is slow, keeps the thumbnail's shape, and dissolves
// into the page once it is drawn.

const slowRoute = (page: Page, ms: number) =>
  page.route(/_rsc=/, async (r) => {
    if (!r.request().headers()['next-router-prefetch']) await new Promise((f) => setTimeout(f, ms));
    await r.continue().catch(() => {});
  });

async function noteWithThumb(page: Page, title: string) {
  const id = await createNote(page.context().request, { title });
  await page.goto(`/notes/${id}`);
  await page.locator('canvas').waitFor();
  await page.waitForTimeout(800);
  await drawStroke(page, [80, 200], [300, 300]);
  await page.getByRole('button', { name: 'All notes' }).click();
  await page.waitForURL(/\/notes$/);
  await expect(page.locator(`[data-frame="${id}"] img`)).toBeVisible({ timeout: 10_000 });
  await page.reload();
  await expect(page.locator(`[data-frame="${id}"] img`)).toBeVisible();
  return id;
}

/** Records the cover's box every frame while it exists. */
const recordCover = (page: Page) =>
  page.evaluate(() => {
    const w = window as unknown as { __cover: number[][] };
    w.__cover = [];
    const t0 = performance.now();
    const tick = () => {
      const el = document.querySelector<HTMLElement>('[data-enlarger]');
      if (el) {
        const r = el.getBoundingClientRect();
        w.__cover.push([r.x, r.y, r.width, r.height, getComputedStyle(el).transform === 'none' ? 0 : 1]);
      }
      if (performance.now() - t0 < 3000) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

for (const [name, opts] of [
  ['desktop', { viewport: { width: 1280, height: 800 } }],
  ['phone', { ...devices['iPhone 13'], defaultBrowserType: undefined }],
] as const) {
  test(`${name}: the frame grows into the page while a slow route loads`, async ({ browser }) => {
    const context = await browser.newContext(opts as never);
    const page = await context.newPage();
    await signIn(context, { googleId: `enlarger-${name}-${Date.now()}` });
    const id = await noteWithThumb(page, 'Enlarger');
    const frame = (await page.locator(`[data-frame="${id}"] [data-frame-image]`).boundingBox())!;

    await slowRoute(page, 2500); // longer than the old 2 s hand-off window
    await recordCover(page);
    await page.locator(`[data-frame="${id}"] [data-frame-image]`).click();

    // Starts on the frame, before the route has answered.
    const cover = page.locator(`[data-enlarger="${id}"]`);
    await expect(cover).toBeAttached({ timeout: 300 });
    await expect(cover.locator('img')).toHaveCount(1);

    // Reaches full size, still waiting on the route, then dissolves once the page is drawn.
    await expect.poll(() => cover.evaluate((el) => el.getBoundingClientRect().width), { timeout: 1500 }).toBe(page.viewportSize()!.width);
    await expect(page).toHaveURL(new RegExp(`/notes/${id}$`), { timeout: 6000 });
    await expect(cover).toHaveCount(0, { timeout: 6000 });
    await expect(page.locator('canvas')).toHaveCSS('opacity', '1');
    await expect(page.getByRole('button', { name: 'All notes' })).toBeVisible();

    const boxes = await page.evaluate(() => (window as unknown as { __cover: number[][] }).__cover);
    const [x, y, w, h] = boxes[0];
    // First sample is already a frame into the grow: on the frame, frame-shaped.
    expect(Math.abs(x - frame.x)).toBeLessThan(6);
    expect(Math.abs(y - frame.y)).toBeLessThan(6);
    expect(w).toBeLessThan(frame.width * 1.1);
    expect(Math.abs(w / h - frame.width / frame.height)).toBeLessThan(0.05);
    // Sized, never scaled: the thumbnail inside keeps its shape.
    expect(boxes.every((b) => b[4] === 0)).toBe(true);
    await context.close();
  });
}

test('back while a note is opening drops the cover and leaves the library usable', async ({ page, context }) => {
  await signIn(context, { googleId: `enlarger-back-${Date.now()}` });
  const id = await noteWithThumb(page, 'Back out');
  await slowRoute(page, 4000);
  await page.locator(`[data-frame="${id}"] [data-frame-image]`).click();
  await expect(page.locator('[data-enlarger]')).toBeAttached();
  await page.goBack();
  await expect(page.locator('[data-enlarger]')).toHaveCount(0);
  await page.unroute(/_rsc=/);
  await expect(page.getByText('Back out').first()).toBeVisible();
});

test('a note that is gone still clears the cover', async ({ page, context }) => {
  await signIn(context, { googleId: `enlarger-gone-${Date.now()}` });
  const id = await noteWithThumb(page, 'Soon gone');
  await context.request.delete(`/notes/api/notes/${id}`);
  await page.locator(`[data-frame="${id}"] [data-frame-image]`).click();
  await expect(page.getByRole('alert')).toBeVisible({ timeout: 8000 });
  await expect(page.locator('[data-enlarger]')).toHaveCount(0);
});

test('reduced motion: a cut instead of a glide', async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  await signIn(context, { googleId: `enlarger-rm-${Date.now()}` });
  const id = await noteWithThumb(page, 'Still');
  await slowRoute(page, 800);
  await page.locator(`[data-frame="${id}"] [data-frame-image]`).click();
  const width = await page.locator('[data-enlarger]').evaluate((el) => el.getBoundingClientRect().width);
  expect(width).toBe(1280);
  await expect(page.locator('[data-enlarger]')).toHaveCount(0, { timeout: 6000 });
  await expect(page.locator('canvas')).toHaveCSS('opacity', '1');
  await context.close();
});
