import { test, expect, type Page } from '@playwright/test';

// Regression test for the Nov 2026 blank page: the app must boot through the
// /notes proxy prefix on cold load and on reload, with every asset loading.

function watch(page: Page) {
  const failures: string[] = [];
  const consoleErrors: string[] = [];
  page.on('response', (r) => {
    const type = r.request().resourceType();
    if (r.status() >= 400 && ['document', 'stylesheet', 'script', 'font', 'image', 'manifest'].includes(type)) {
      failures.push(`${r.status()} ${type} ${r.url()}`);
    }
  });
  page.on('requestfailed', (r) => failures.push(`FAILED ${r.resourceType()} ${r.url()} ${r.failure()?.errorText}`));
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));
  return { failures, consoleErrors };
}

async function expectBooted(page: Page) {
  // Styled (stylesheet applied, never a white page) ...
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgb(0, 0, 0)');
  // ... and interactive: the signed-out entry point is rendered by the client app.
  await expect(page.getByRole('button', { name: /continue with google/i }).first()).toBeVisible({ timeout: 5_000 });
}

test('cold load and reload render the app through the /notes proxy', async ({ page }) => {
  const seen = watch(page);

  await page.goto('/notes', { waitUntil: 'load' });
  await expectBooted(page);

  await page.reload({ waitUntil: 'load' });
  await expectBooted(page);

  expect(seen.failures, 'every asset must load through /notes').toEqual([]);
  expect(seen.consoleErrors, 'console must be clean').toEqual([]);
});

test('if app scripts fail to load, a real error with reload is shown instead of a blank page', async ({ page }) => {
  await page.route('**/_next/static/**/*.js', (route) => route.fulfill({ status: 404, contentType: 'text/plain', body: 'gone' }));
  await page.goto('/notes', { waitUntil: 'load' });
  const alert = page.getByRole('alert');
  await expect(alert).toContainText('couldn’t load');
  await expect(alert.getByRole('link', { name: 'Reload' })).toBeVisible();
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgb(0, 0, 0)');
});

test('direct access without the proxy uses the same /notes URLs', async ({ page }) => {
  const seen = watch(page);
  await page.goto('http://localhost:3101/notes', { waitUntil: 'load' });
  await expectBooted(page);
  expect(seen.failures).toEqual([]);
  expect(seen.consoleErrors).toEqual([]);
});
