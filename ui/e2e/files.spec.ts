import { readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { Page } from '@playwright/test';

import { expect, type Hub, test } from './hub';
import { Laptop } from './laptop';
import { pair } from './phone';

/** Opens `~/demo/<name>` on the phone, from the Files section. */
async function openFile(page: Page, name: string): Promise<void> {
  await page.getByRole('link', { name: 'Files', exact: true }).click();
  await page.getByRole('link', { name: /^demo/ }).click();
  await expect(page.getByRole('navigation', { name: 'Folder path' })).toContainText('demo');
  await page.getByRole('link', { name: new RegExp(`^${name}`) }).click();
  await expect(page.getByRole('heading', { name })).toBeVisible();
}

/** Edits the open file on the phone and sends it to the laptop. */
async function sendEdit(page: Page, text: string): Promise<void> {
  await page.getByRole('link', { name: 'Edit' }).click();
  await page.getByLabel(/^Contents of/).fill(text);
  await page.getByRole('button', { name: 'Send to the laptop' }).click();
  await expect(page.getByRole('heading', { name: 'Your edits' })).toBeVisible();
  await expect(page.getByText('Waiting for the laptop')).toBeVisible();
}

const demo = (hub: Hub, name: string) => join(hub.projects, 'demo', name);

test('a file is read on the phone, edited, and written once the laptop approves', async ({ page, hub, browser }) => {
  writeFileSync(
    demo(hub, 'notes.md'),
    '# Notes\n\nSee [the plan](plan.txt).\n\n<script>alert(1)</script>\n\n- one\n- two\n',
  );
  writeFileSync(demo(hub, 'plan.txt'), 'step one\nstep two\n');
  await pair(page, hub);
  await openFile(page, 'notes.md');

  // Markdown shows rendered, its HTML as plain text.
  const article = page.locator('article');
  await expect(article.getByRole('heading', { name: 'Notes' })).toBeVisible();
  await expect(article).toContainText('<script>alert(1)</script>');
  await expect(page.locator('article script')).toHaveCount(0);
  await page.getByRole('button', { name: 'Source' }).click();
  await expect(page.getByRole('region', { name: 'Source' })).toContainText('# Notes');

  // The edit waits for the laptop; nothing is written yet.
  await sendEdit(page, '# Notes\n\nSee the plan.\n');
  expect(readFileSync(demo(hub, 'notes.md'), 'utf8')).toContain('<script>');

  const laptop = await Laptop.open(browser, hub);
  const edits = laptop.page.getByRole('region', { name: 'Edits from the phone' });
  await expect(edits).toContainText('notes.md');
  await edits.getByRole('button', { name: 'Review' }).click();
  const review = laptop.page.getByRole('dialog', { name: /^Edit to/ });
  await expect(review).toContainText('What the phone changed');
  await review.getByRole('button', { name: 'Write it' }).click();
  await expect(review).toBeHidden();
  expect(readFileSync(demo(hub, 'notes.md'), 'utf8')).toBe('# Notes\n\nSee the plan.\n');
  await expect(laptop.page.getByRole('region', { name: 'Activity' })).toContainText('edit written');

  // The phone hears back.
  await expect(page.getByText('Written', { exact: true })).toBeVisible({ timeout: 15_000 });
  await laptop.close();
});

test('an edit to a file changed on the laptop since is merged, not overwritten', async ({ page, hub, browser }) => {
  writeFileSync(demo(hub, 'plan.txt'), 'one\ntwo\nthree\nfour\nfive\n');
  await pair(page, hub);
  await openFile(page, 'plan.txt');
  await sendEdit(page, 'one\ntwo\nthree\nfour\nFIVE\n');
  // Meanwhile, on the laptop:
  writeFileSync(demo(hub, 'plan.txt'), 'ONE\ntwo\nthree\nfour\nfive\n');

  const laptop = await Laptop.open(browser, hub);
  const edits = laptop.page.getByRole('region', { name: 'Edits from the phone' });
  await expect(edits).toContainText('changed on the laptop since');
  await edits.getByRole('button', { name: 'Review' }).click();
  const review = laptop.page.getByRole('dialog', { name: /^Edit to/ });
  await expect(review.getByRole('alert')).toContainText('This file changed on the laptop since the phone read it.');
  await expect(review).toContainText('What the laptop changed');
  await review.getByRole('button', { name: 'Merge both' }).click();
  await expect(review).toBeHidden();
  expect(readFileSync(demo(hub, 'plan.txt'), 'utf8')).toBe('ONE\ntwo\nthree\nfour\nFIVE\n');
  await laptop.close();
});

test('a folder shows as a list or a grid with thumbnails, in the order picked, and stays so', async ({ page, hub }) => {
  // A 1×1 PNG, a big file changed long ago, and a small one changed just now.
  const pixel = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  writeFileSync(demo(hub, 'logo.png'), Buffer.from(pixel, 'base64'));
  writeFileSync(demo(hub, 'big.log'), 'x'.repeat(50_000));
  utimesSync(demo(hub, 'big.log'), new Date(2024, 0, 1), new Date(2024, 0, 1));
  writeFileSync(demo(hub, 'zeta.txt'), 'new\n');
  await pair(page, hub);
  await page.getByRole('link', { name: 'Files', exact: true }).click();
  await page.getByRole('link', { name: /^demo/ }).click();
  const files = page.getByRole('list', { name: 'Files' });
  const first = files.getByRole('link').first();

  // A list by name to begin with.
  await expect(page.getByRole('button', { name: 'List view' })).toHaveAttribute('aria-pressed', 'true');
  await expect(first).toContainText('big.log');

  // A grid, with the image's own thumbnail.
  await page.getByRole('button', { name: 'Grid view' }).click();
  await expect(page.getByRole('button', { name: 'Grid view' })).toHaveAttribute('aria-pressed', 'true');
  const thumbnail = files.getByRole('link', { name: /^logo\.png/ }).locator('img');
  await expect(thumbnail).toBeVisible();
  await expect.poll(() => thumbnail.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(1);

  // Biggest first, then newest first.
  const sort = page.getByLabel('Sort by');
  await sort.selectOption({ label: 'Size' });
  await expect(first).toContainText('big.log');
  await sort.selectOption({ label: 'Last modified' });
  await expect(files.getByRole('link').last()).toContainText('big.log');

  // This phone remembers both.
  await page.reload();
  await expect(page.getByRole('button', { name: 'Grid view' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByLabel('Sort by')).toHaveValue('newest');
  await expect(files.getByRole('link').last()).toContainText('big.log');
});

test('secrets are readable on the phone only while the laptop allows it', async ({ page, hub, browser }) => {
  writeFileSync(demo(hub, '.env'), 'TOKEN=abc\n');
  await pair(page, hub);
  await page.goto(`${hub.url}/#/files/view/~/demo/.env`);
  await expect(page.getByRole('region', { name: 'Source' })).toContainText('TOKEN=abc');

  const laptop = await Laptop.open(browser, hub);
  const setting = laptop.page.getByRole('switch', { name: 'The phone may read sensitive files' });
  await expect(setting).toHaveAttribute('aria-checked', 'true');
  await setting.click();
  await expect(setting).toHaveAttribute('aria-checked', 'false');

  await page.reload();
  await expect(page.getByRole('alert')).toContainText('turned off on the laptop');
  await expect(page.getByText('TOKEN=abc')).toHaveCount(0);
  await laptop.close();
});
