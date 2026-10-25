import type { Locator, Page } from '@playwright/test';

import { expect, test } from './hub';
import { pair } from './phone';

async function hold(page: Page, target: Locator, ms: number, at = 0.5): Promise<void> {
  const box = await target.boundingBox();
  if (!box) throw new Error('Nothing to press.');
  await page.mouse.move(box.x + box.width * at, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(ms);
  await page.mouse.up();
}

async function pick(page: Page): Promise<void> {
  await page.getByRole('dialog', { name: 'Secret games' }).getByRole('button', { name: /Hop Count/ }).click();
}

async function pressOn(page: Page, target: Locator): Promise<void> {
  const box = await target.boundingBox();
  if (!box) throw new Error('Nothing to press.');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
}

type Saved = { n: { zone: number; hop: number; score: number }; body: number[]; world?: { cleared: boolean }[] };

async function saved(page: Page): Promise<Saved | null> {
  return page.evaluate(() => JSON.parse(localStorage.getItem('airlock.game') ?? 'null') as Saved | null);
}

/** The game as it is right now, from a save made on the spot. */
async function current(page: Page): Promise<Saved | null> {
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  return saved(page);
}

async function packet(page: Page): Promise<{ vx: number; facing: number }> {
  const body = (await current(page))?.body ?? [];
  return { vx: body[4] ?? Number.NaN, facing: body[7] ?? Number.NaN };
}

/** A key pressed long enough for the game, which looks at its buttons 60 times a second, to see it. */
async function tapKey(page: Page, key: string): Promise<void> {
  await page.keyboard.down(key);
  await page.waitForTimeout(80);
  await page.keyboard.up(key);
}

async function reopenChanged(page: Page, change: () => void): Promise<Locator> {
  const game = page.getByRole('dialog', { name: /HOP COUNT/ });
  await hold(page, page.locator('header').first(), 900, 0.4);
  await pick(page);
  await expect(game).toBeVisible();
  await game.getByRole('button', { name: 'Start' }).click();
  await page.waitForTimeout(500);
  await page.keyboard.press('Escape');
  await expect(game).toBeHidden();
  await page.evaluate(change);
  await hold(page, page.locator('header').first(), 900, 0.4);
  await pick(page);
  await expect(game.getByRole('group', { name: 'Paused' })).toBeVisible();
  return game;
}

/** Opens the game playing at a new level's start, with the bugs taken out of its room, so none ends the run. */
async function calmStart(page: Page): Promise<Locator> {
  const game = await reopenChanged(page, () => {
    const save = JSON.parse(localStorage.getItem('airlock.game') ?? 'null') as { ents: number[] };
    save.ents = [];
    localStorage.setItem('airlock.game', JSON.stringify(save));
  });
  await game.getByRole('group', { name: 'Paused' }).getByRole('button', { name: 'Continue' }).click();
  await expect(game.getByRole('button', { name: 'Pause' })).toBeVisible();
  return game;
}

async function loseNextRelease(page: Page): Promise<void> {
  await page.evaluate(() => window.addEventListener('pointerup', (event) => event.stopPropagation(), { capture: true, once: true }));
}

/** How many different colours the game's canvas shows (a blank one shows one). */
async function colours(canvas: Locator): Promise<number> {
  return canvas.evaluate((element) => {
    const c = element as HTMLCanvasElement;
    const data = c.getContext('2d')?.getImageData(0, 0, c.width, c.height).data ?? new Uint8ClampedArray();
    const seen = new Set<number>();
    for (let i = 0; i < data.length; i += 4 * 7) seen.add(((data[i] ?? 0) << 16) | ((data[i + 1] ?? 0) << 8) | (data[i + 2] ?? 0));
    return seen.size;
  });
}

test('holding a header opens the secret game; it saves when closed and picks up where it was', async ({ page, hub }) => {
  await pair(page, hub);
  const game = page.getByRole('dialog', { name: /HOP COUNT/ });

  await hold(page, page.locator('header').first(), 100, 0.4);
  await expect(game).toBeHidden();
  await hold(page, page.locator('header').first(), 900, 0.4);
  await pick(page);
  await expect(game).toBeVisible();
  const canvas = game.getByLabel('HOP COUNT game screen');
  await expect(canvas).toBeVisible();
  await expect.poll(() => colours(canvas)).toBeGreaterThan(5);
  for (const name of ['Left', 'Down, into pipes', 'Right', 'B, run and fire', 'A, jump']) {
    await expect(game.getByRole('button', { name })).toBeVisible();
  }

  await game.getByRole('button', { name: 'Close game' }).first().click();
  await expect(game).toBeHidden();
  await calmStart(page);
  const from = (await current(page))?.body[0] ?? Number.NaN;
  await page.keyboard.down('ArrowRight');
  await expect.poll(async () => ((await current(page))?.body[0] ?? 0) - from, { timeout: 10_000 }).toBeGreaterThan(24);
  await page.keyboard.up('ArrowRight');

  await game.getByRole('button', { name: 'Close game' }).first().click();
  await expect(game).toBeHidden();
  const first = await saved(page);
  expect(first).not.toBeNull();
  if (!first) return;
  expect((first.body[0] ?? 0) - from).toBeGreaterThan(24);

  await page.getByRole('link', { name: 'Settings' }).click();
  await hold(page, page.getByRole('heading', { name: 'Settings' }), 900);
  await pick(page);
  await expect(game).toBeVisible();
  const menu = game.getByRole('group', { name: 'Paused' });
  await expect(menu.getByRole('button', { name: 'Continue' })).toBeFocused();
  await page.waitForTimeout(400);
  await page.keyboard.press('Escape');
  await expect(game).toBeHidden();
  const second = await saved(page);
  expect(second?.n).toEqual(first.n);
  expect(second?.body).toEqual(first.body);

  await hold(page, page.getByRole('heading', { name: 'Settings' }), 900);
  await pick(page);
  await menu.getByRole('button', { name: 'Continue' }).click();
  await expect(menu).toBeHidden();
  await expect(game.getByRole('button', { name: 'Pause' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(game).toBeHidden();
});

test('a held direction never sticks, and the last one pressed takes over', async ({ page, hub }) => {
  await pair(page, hub);
  const game = await calmStart(page);
  const right = game.getByRole('button', { name: 'Right' });
  const left = game.getByRole('button', { name: 'Left' });

  // Running right, the page loses focus, and the key's release goes elsewhere: it stops.
  await page.keyboard.down('ArrowRight');
  await page.waitForTimeout(600);
  expect((await packet(page)).vx).toBeGreaterThan(0);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await page.waitForTimeout(400);
  expect((await packet(page)).vx).toBe(0);
  await page.keyboard.up('ArrowRight');

  // The on-screen Right, lifted without the buttons hearing it: losing the capture lets go.
  await loseNextRelease(page);
  await pressOn(page, right);
  await page.waitForTimeout(500);
  expect((await packet(page)).vx).toBeGreaterThan(0);
  await page.mouse.up();
  await page.waitForTimeout(400);
  expect((await packet(page)).vx).toBe(0);

  await page.keyboard.down('ArrowRight');
  await page.waitForTimeout(300);
  expect((await packet(page)).facing).toBe(1);
  await pressOn(page, left);
  await page.waitForTimeout(300);
  expect((await packet(page)).facing).toBe(-1);
  await page.mouse.up();
  await page.waitForTimeout(300);
  expect((await packet(page)).facing).toBe(1);
  await page.keyboard.up('ArrowRight');
});

test('the world map: a cleared hop opens the next, which the map plays; the pause menu has it too', async ({ page, hub }) => {
  await pair(page, hub);
  // A new game with the packet beside the first hop's flag, and nothing else left in the room.
  const game = await reopenChanged(page, () => {
    const save = JSON.parse(localStorage.getItem('airlock.game') ?? 'null') as { ents: number[]; body: number[] };
    // An entity is 19 numbers, its kind first; the flag is kind 31.
    const at = save.ents.findIndex((value, i) => i % 19 === 0 && value === 31);
    const flag = save.ents.slice(at, at + 19);
    save.ents = flag;
    save.body[0] = (flag[1] ?? 0) - 4;
    save.body[1] = (flag[2] ?? 0) + 20;
    localStorage.setItem('airlock.game', JSON.stringify(save));
  });
  const menu = game.getByRole('group', { name: 'Paused' });
  const status = game.locator('[aria-live]');
  await menu.getByRole('button', { name: 'Continue' }).click();

  await expect(status).toContainText('World map. 1-2, LOCALHOST hop 2: not cleared yet', { timeout: 15_000 });
  const cleared = await current(page);
  expect(cleared?.world?.[0]?.cleared).toBe(true);
  expect(cleared?.world?.[1]?.cleared ?? false).toBe(false);
  // A plays it.
  await tapKey(page, 'z');
  await expect(game.getByRole('button', { name: 'Pause' })).toBeVisible();
  await expect(status).toContainText('Zone 1, LOCALHOST, hop 2.');
  expect((await current(page))?.n).toMatchObject({ zone: 1, hop: 2 });

  // From the pause menu: the map, where A would carry on, and B back to the menu.
  await tapKey(page, 'Enter');
  await menu.getByRole('button', { name: 'World map' }).click();
  await expect(status).toContainText('1-2, LOCALHOST hop 2: not cleared yet, 0 of 3 keys. A to carry on');
  await tapKey(page, 'x');
  await expect(menu.getByRole('button', { name: 'Continue' })).toBeFocused();
  await menu.getByRole('button', { name: 'World map' }).click();
  await tapKey(page, 'ArrowLeft');
  await expect(status).toContainText('1-1, LOCALHOST hop 1: cleared, 0 of 3 keys, best time');
  await tapKey(page, 'z');
  await expect(game.getByRole('button', { name: 'Pause' })).toBeVisible();
  expect((await current(page))?.n).toMatchObject({ zone: 1, hop: 1 });
});

test('in the Game Boy theme the game plays in the case, driven by its buttons', async ({ page, hub }) => {
  await pair(page, hub);
  await page.getByRole('link', { name: 'Settings' }).click();
  await page.getByRole('list', { name: 'Themes' }).getByRole('button', { name: 'Game Boy' }).click();
  const buttons = page.getByRole('group', { name: 'Game Boy buttons' });
  await buttons.getByRole('button', { name: 'B, back' }).click();
  await expect(page.getByRole('heading', { name: 'Home', exact: true })).toBeVisible();

  await hold(page, page.getByRole('heading', { name: 'Home', exact: true }), 900);
  await pick(page);
  const game = page.getByRole('dialog', { name: /HOP COUNT/ });
  await expect(game).toBeVisible();
  const screen = await game.boundingBox();
  const pad = await buttons.boundingBox();
  expect(screen && pad && screen.y + screen.height <= pad.y).toBe(true);
  await expect(game.getByRole('button', { name: 'A, jump' })).toHaveCount(0);
  await expect.poll(() => colours(game.getByLabel('HOP COUNT game screen'))).toBeGreaterThan(3);

  // Start on the case starts; A skips the card; holding right runs.
  await hold(page, page.getByRole('button', { name: 'Start, new terminal' }), 150);
  await page.waitForTimeout(700);
  await hold(page, buttons.getByRole('button', { name: 'A, open' }), 150);
  await hold(page, buttons.getByRole('button', { name: 'Right, next section' }), 1200);
  await loseNextRelease(page);
  await hold(page, buttons.getByRole('button', { name: 'Right, next section' }), 500);
  await page.waitForTimeout(400);
  expect((await packet(page)).vx).toBe(0);
  // While it's open the buttons are the game's: right didn't change the section.
  await game.getByRole('button', { name: 'Close game' }).first().click();
  await expect(game).toBeHidden();
  await expect(page.getByRole('link', { name: 'Home', exact: true })).toHaveAttribute('aria-current', 'page');
  const state = await saved(page);
  expect(state?.body[0] ?? 0).toBeGreaterThan(20);

  await buttons.getByRole('button', { name: 'Right, next section' }).click();
  await expect(page.getByRole('link', { name: 'Terminals', exact: true })).toHaveAttribute('aria-current', 'page');
});
