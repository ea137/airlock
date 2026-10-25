import { expect, test } from './hub';
import { pair } from './phone';

// Claude is the harness's stand-in: it answers only when started with Ask
// Claude's safety settings, and says back the model and what it was about.

test('Claude is asked about the laptop from Home, and follow-ups carry on', async ({ page, hub }) => {
  void hub;
  await pair(page, hub);
  await page.getByRole('button', { name: 'Ask Claude about the laptop' }).click();
  const sheet = page.getByRole('dialog', { name: 'Ask Claude' });
  await sheet.getByRole('button', { name: 'Is anything wrong with the laptop?' }).click();

  // What it checked, then its answer, as it comes.
  await expect(sheet.getByRole('list', { name: 'What Claude checked' })).toContainText('systemctl status vboxdrv');
  await expect(sheet.getByText('Safe to ignore.', { exact: true })).toBeVisible();
  await expect(sheet).toContainText('(model claude-sonnet-5-5)');

  // A follow-up, by Enter.
  await sheet.getByLabel('Your question').fill('And what should I do?');
  await sheet.getByLabel('Your question').press('Enter');
  await expect(sheet.getByText('And what should I do?')).toBeVisible();
  await expect(sheet.getByText('Safe to ignore.', { exact: true })).toHaveCount(2);
});

test('Claude is asked about a port with what the sheet shows, with the model chosen in Settings', async ({ page, hub }) => {
  await pair(page, hub);
  // Opus, chosen in Settings, is the one asked.
  await page.getByRole('link', { name: 'Settings' }).click();
  await page.getByRole('radio', { name: /Opus 5\.5/ }).check();
  await page.getByRole('link', { name: 'Home', exact: true }).click();

  await page.getByRole('link', { name: 'System', exact: true }).click();
  const port = page.getByRole('button', { name: /^:\d+ / }).first();
  await expect(port).toBeVisible({ timeout: 15_000 });
  const number = /^:(\d+)/.exec((await port.textContent()) ?? '')?.[1];
  await port.click();
  await page.getByRole('button', { name: 'Ask Claude about it' }).click();

  const sheet = page.getByRole('dialog', { name: 'Ask Claude' });
  await expect(sheet).toContainText(`About port ${number}`);
  await sheet.getByRole('button', { name: 'Should I worry about it?' }).click();
  await expect(sheet).toContainText(`About: port ${number}`);
  await expect(sheet).toContainText('(model claude-opus-5-5)');
});
