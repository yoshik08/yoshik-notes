import { test, expect, type CDPSession, type Page } from '@playwright/test';
import { signIn, createNote, serverElements } from './helpers';

// iPad model: the pencil writes with pressure; once a pencil has been seen,
// one finger moves the page and two fingers pinch-zoom; neither ever draws.
// Pen and touch input are synthesised through the Chrome DevTools Protocol.

test.use({ hasTouch: true, viewport: { width: 1180, height: 820 } });

async function pen(cdp: CDPSession, points: Array<[number, number, number]>) {
  const [x0, y0, f0] = points[0];
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: x0, y: y0, button: 'left', buttons: 1, clickCount: 1, pointerType: 'pen', force: f0 });
  for (const [x, y, f] of points.slice(1)) await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'left', buttons: 1, pointerType: 'pen', force: f });
  const [x1, y1] = points[points.length - 1];
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x1, y: y1, button: 'left', buttons: 0, clickCount: 1, pointerType: 'pen', force: 0 });
}

async function touch(cdp: CDPSession, frames: Array<Array<[number, number]>>) {
  const pts = (f: Array<[number, number]>) => f.map(([x, y], id) => ({ x, y, id }));
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pts(frames[0]) });
  for (const f of frames.slice(1)) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pts(f) });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

const zoomLabel = (page: Page) => page.getByRole('button', { name: 'Zoom options' });

test('pencil writes with pressure; then fingers move and zoom the page without drawing', async ({ page, context }) => {
  await signIn(context, { googleId: `pencil-${Date.now()}` });
  const id = await createNote(context.request, { title: 'Pencil test' });
  await page.goto(`/notes/${id}`);
  await expect(page.locator('canvas')).toBeVisible();
  await expect(zoomLabel(page)).toHaveText('100%');
  const cdp = await context.newCDPSession(page);

  // A pencil stroke whose pressure rises and falls.
  const stroke: Array<[number, number, number]> = Array.from({ length: 24 }, (_, i) => [300 + i * 14, 320 + Math.sin(i / 4) * 30, 0.2 + 0.7 * Math.sin((Math.PI * i) / 23)]);
  await pen(cdp, stroke);
  await expect(page.getByText('Pencil mode')).toBeVisible();
  await expect.poll(async () => (await serverElements(context.request, id)).length, { timeout: 8_000 }).toBe(1);
  const pressures = ((await serverElements(context.request, id))[0].points as Array<{ pressure: number }>).map((p) => p.pressure);
  expect(Math.max(...pressures) - Math.min(...pressures)).toBeGreaterThan(0.4);

  // One finger now moves the page instead of drawing.
  await touch(cdp, Array.from({ length: 10 }, (_, i) => [[500 + i * 20, 500 + i * 6]]));
  // Two fingers pinch apart: zoom goes up.
  await touch(cdp, Array.from({ length: 12 }, (_, i) => [[540 - i * 12, 420], [640 + i * 12, 420]]));
  await expect.poll(async () => parseInt((await zoomLabel(page).textContent()) ?? '0', 10)).toBeGreaterThan(150);

  await page.waitForTimeout(1500);
  expect(await serverElements(context.request, id)).toHaveLength(1);
});

test('without a pencil, a finger draws (phones and finger-only iPads)', async ({ page, context }) => {
  await signIn(context, { googleId: `finger-${Date.now()}` });
  const id = await createNote(context.request, { title: 'Finger test' });
  await page.goto(`/notes/${id}`);
  await expect(zoomLabel(page)).toHaveText('100%');
  const cdp = await context.newCDPSession(page);
  await touch(cdp, Array.from({ length: 12 }, (_, i) => [[300 + i * 15, 300 + i * 4]]));
  await expect.poll(async () => (await serverElements(context.request, id)).length, { timeout: 8_000 }).toBe(1);
});
