import type { Page } from '@playwright/test';

import { expect, test } from './hub';
import { openTerminal, pair } from './phone';

const html = (page: Page) => page.locator('html');

/** The terminal's background as xterm paints it: inline, on the element it scrolls. */
async function terminalBackground(page: Page): Promise<string> {
  const terminal = page.locator('.xterm');
  await expect(terminal).toBeVisible();
  return terminal.evaluate(
    (element) =>
      [...element.querySelectorAll<HTMLElement>('*')].find((child) => child.style.backgroundColor)?.style
        .backgroundColor ?? '',
  );
}

test('a theme is picked on the phone, kept, and the terminal follows it unless told not to', async ({ page, hub }) => {
  await pair(page, hub);
  await page.getByRole('link', { name: 'Settings' }).click();
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  const themes = page.getByRole('list', { name: 'Themes' });
  await expect(themes.getByRole('button')).toHaveCount(9);
  await expect(themes.getByRole('button', { name: 'Current' })).toHaveAttribute('aria-pressed', 'true');

  await themes.getByRole('button', { name: 'Hacker' }).click();
  await expect(themes.getByRole('button', { name: 'Hacker' })).toHaveAttribute('aria-pressed', 'true');
  await expect(themes.getByRole('button', { name: 'Current' })).toHaveAttribute('aria-pressed', 'false');
  await expect(html(page)).toHaveAttribute('data-theme', 'hacker');
  await expect(html(page)).toHaveAttribute('data-terminal', 'theme');

  // Kept on this phone across a reload.
  await page.reload();
  await expect(html(page)).toHaveAttribute('data-theme', 'hacker');
  await expect(page.getByRole('list', { name: 'Themes' }).getByRole('button', { name: 'Hacker' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  // The terminal takes the theme's near-black, then its own black once the
  // switch is off.
  await page.getByRole('link', { name: 'Home' }).click();
  await openTerminal(page, 'Styled');
  expect(await terminalBackground(page)).toBe('rgb(5, 5, 5)');

  await page.getByRole('link', { name: 'Terminals' }).click();
  await page.getByRole('link', { name: 'Settings' }).click();
  const follow = page.getByRole('switch', { name: 'Terminal colours follow the theme' });
  await expect(follow).toHaveAttribute('aria-checked', 'true');
  await follow.click();
  await expect(follow).toHaveAttribute('aria-checked', 'false');
  await expect(html(page)).toHaveAttribute('data-terminal', 'plain');
  await page.getByRole('link', { name: 'Home' }).click();
  await page.getByRole('link', { name: 'Terminals', exact: true }).click();
  await page.getByRole('link', { name: /Styled/ }).click();
  expect(await terminalBackground(page)).toBe('rgb(0, 0, 0)');

  // Motion off is kept too.
  await page.getByRole('link', { name: 'Terminals' }).click();
  await page.getByRole('link', { name: 'Settings' }).click();
  await page.getByRole('switch', { name: 'Motion' }).click();
  await expect(html(page)).toHaveAttribute('data-motion', 'off');
  await page.reload();
  await expect(page.getByRole('switch', { name: 'Motion' })).toHaveAttribute('aria-checked', 'false');
});

test('Settings says how to get notifications on an iPhone, from the Home Screen', async ({ page, hub }) => {
  await pair(page, hub);
  await page.getByRole('link', { name: 'Settings' }).click();
  await expect(page.getByRole('heading', { name: 'Notifications' })).toBeVisible();
  await expect(page.getByText('Add to Home Screen')).toBeVisible();
  await expect(page.getByText('Open Airlock from its icon on the Home Screen.')).toBeVisible();
  // What the Home Screen needs is served: the manifest, its icon and the
  // service worker.
  const manifest = await (await page.request.get(`${hub.url}/manifest.webmanifest`)).json();
  expect(manifest.display).toBe('standalone');
  expect((await page.request.get(`${hub.url}/icon-512.png`)).ok()).toBe(true);
  const worker = await page.request.get(`${hub.url}/sw.js`);
  expect(worker.headers()['content-type']).toContain('javascript');
});

test('the Game Boy case works its buttons, and steps aside for a terminal', async ({ page, hub }) => {
  await pair(page, hub);
  await page.getByRole('link', { name: 'Settings' }).click();
  await page.getByRole('list', { name: 'Themes' }).getByRole('button', { name: 'Game Boy' }).click();
  const buttons = page.getByRole('group', { name: 'Game Boy buttons' });
  await expect(buttons).toBeVisible();

  // B is the screen's Back.
  await buttons.getByRole('button', { name: 'B, back' }).click();
  await expect(page.getByRole('heading', { name: 'Home', exact: true })).toBeVisible();

  // Down picks the first thing on screen, A opens it.
  await buttons.getByRole('button', { name: 'Down' }).click();
  const picked = page.locator('[data-selected]');
  await expect(picked).toHaveCount(1);
  await expect(picked).toBeFocused();
  await expect(picked).toHaveAccessibleName('Settings');
  await buttons.getByRole('button', { name: 'A, open' }).click();
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  await buttons.getByRole('button', { name: 'B, back' }).click();

  // Right and left move between the sections.
  await buttons.getByRole('button', { name: 'Right, next section' }).click();
  await expect(page.getByRole('link', { name: 'Terminals', exact: true })).toHaveAttribute('aria-current', 'page');
  await buttons.getByRole('button', { name: 'Right, next section' }).click();
  await expect(page.getByRole('link', { name: 'Work', exact: true })).toHaveAttribute('aria-current', 'page');
  await buttons.getByRole('button', { name: 'Left, previous section' }).click();
  await buttons.getByRole('button', { name: 'Left, previous section' }).click();
  await expect(page.getByRole('link', { name: 'Home', exact: true })).toHaveAttribute('aria-current', 'page');

  // Select is Files.
  await page.getByRole('button', { name: 'Select, files' }).click();
  await expect(page.getByRole('link', { name: 'Files', exact: true })).toHaveAttribute('aria-current', 'page');

  // Start opens a new terminal's sheet, inside the screen; B closes it.
  await page.getByRole('button', { name: 'Start, new terminal' }).click();
  const sheet = page.getByRole('dialog', { name: 'New terminal' });
  await expect(sheet).toBeVisible();
  await buttons.getByRole('button', { name: 'B, back' }).click();
  await expect(sheet).toBeHidden();

  // A terminal gets the whole phone.
  await openTerminal(page, 'Pocket');
  await expect(buttons).toBeHidden();
  await page.getByRole('link', { name: 'Terminals' }).click();
  await expect(buttons).toBeVisible();
});
