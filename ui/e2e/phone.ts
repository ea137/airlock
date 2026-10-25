import type { Page } from '@playwright/test';

import { expect, type Hub } from './hub';

export async function pair(page: Page, hub: Hub, name = 'E2E phone', url = hub.url): Promise<void> {
  await page.goto(url);
  await page.getByLabel('Name for this device').fill(name);
  await page.getByRole('button', { name: 'Ask the laptop' }).click();
  const code = (await page.getByLabel(/^Code \d{6}$/).getAttribute('aria-label'))?.replace('Code ', '') ?? '';
  expect(code).toMatch(/^\d{6}$/);
  expect(hub.airlock('pairings')).toContain(name);
  hub.airlock('approve', code);
  await expect(page.getByRole('heading', { name: 'Home', exact: true })).toBeVisible();
}

export async function openTerminal(page: Page, name: string): Promise<void> {
  await page.getByRole('link', { name: 'Terminals', exact: true }).click();
  await page.getByRole('button', { name: 'New terminal', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'New terminal' });
  await expect(sheet.getByRole('radio').first()).toBeChecked();
  await sheet.getByLabel('Name').fill(name);
  await sheet.getByRole('button', { name: 'Open terminal' }).click();
  await expect(page.getByRole('heading', { name })).toBeVisible();
}
