import { test, expect } from '@playwright/test';
import { signIn, createNote } from './helpers';

// Every in-app link must stay under /notes so yoshik-proxy routes it here.
test('signed in: dashboard -> open note -> back -> new note, all under /notes', async ({ page, context }) => {
  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('response', (r) => { if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`); });

  await signIn(context, { googleId: `nav-${Date.now()}` });
  const id = await createNote(context.request, { title: 'Navigation check' });

  await page.goto('/notes');
  await page.getByText('Navigation check').first().click();
  await expect(page).toHaveURL(new RegExp(`/notes/${id}$`));
  await expect(page.locator('canvas')).toBeVisible();

  await page.goBack();
  await expect(page).toHaveURL(/\/notes$/);
  await expect(page.getByText('Navigation check').first()).toBeVisible();

  await page.getByRole('button', { name: /new note/i }).first().click();
  await expect(page).toHaveURL(/\/notes\/[0-9a-f]{24}$/);
  await expect(page.locator('canvas')).toBeVisible();

  expect(errors).toEqual([]);
});
