import type { Locator, Page } from '@playwright/test';

import { expect, test } from './hub';
import { pair } from './phone';

/** Holds the mouse down on the middle of an element for a while. */
async function hold(page: Page, target: Locator, ms: number): Promise<void> {
  const box = await target.boundingBox();
  if (!box) throw new Error('Nothing to press.');
  await page.mouse.move(box.x + box.width * 0.4, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(ms);
  await page.mouse.up();
}

/** Taps through a conversation to its end, answering each question with `answer` (the first choice by default). */
async function talkThrough(game: Locator, answer = (choices: Locator) => choices.getByRole('button').first()): Promise<void> {
  const talk = game.getByRole('group', { name: 'Conversation' });
  for (let i = 0; i < 80 && (await talk.count()) > 0; i += 1) {
    const choices = game.getByRole('group', { name: 'Your answer' });
    if ((await choices.count()) > 0) await answer(choices).click();
    else await talk.getByRole('button').first().click();
  }
  await expect(talk).toHaveCount(0);
}

type Saved = { area: string; party: string[]; flags: string[]; trust: Record<string, number> };

async function saved(page: Page): Promise<Saved | null> {
  return page.evaluate(() => JSON.parse(localStorage.getItem('airlock.keepalive') ?? 'null') as Saved | null);
}

test('Keepalive opens from a header, you talk to a companion and choose, and it picks up where it was left', async ({ page, hub }) => {
  await pair(page, hub);
  await hold(page, page.locator('header').first(), 900);
  const picker = page.getByRole('dialog', { name: 'Secret games' });
  await expect(picker).toBeVisible();
  await picker.getByRole('button', { name: /Keepalive/ }).click();
  const game = page.getByRole('dialog', { name: /KEEPALIVE/ });
  await expect(game).toBeVisible();
  // It starts with the secret games' sound switch, off for the tests: no sound from the test browser.
  await expect(game.getByRole('button', { name: 'Sound' })).toHaveAttribute('aria-pressed', 'false');

  // A new game: the prologue's card, then Gran.
  await game.getByRole('button', { name: 'New game' }).click();
  await page.waitForTimeout(900);
  await page.keyboard.press('z');
  const talk = game.getByRole('group', { name: 'Conversation' });
  await expect(talk).toContainText('A hum.');
  // A tap on the words: Gran speaks.
  await expect(async () => {
    await talk.getByRole('button').first().click();
    await expect(talk).toContainText('Gran', { timeout: 300 });
  }).toPass();
  await talkThrough(game);

  // Cron burst in, and stands at the door. Talk to him, and be kind.
  await page.keyboard.press('z');
  await expect(talk).toContainText('Cron');
  await talkThrough(game, (choices) => choices.getByRole('button', { name: 'That sounds lonely.' }));
  const status = game.locator('p[aria-live]').last();
  await expect(status).toHaveText("Gran's house. With Cron.");

  // Closing saves.
  await game.getByRole('button', { name: 'Close game' }).click();
  await expect(game).toBeHidden();
  const first = await saved(page);
  expect(first?.area).toBe('gran');
  expect(first?.party).toEqual(['cron']);
  expect(first?.flags).toContain('seen.p.cron');
  expect(first?.trust.cron).toBe(4);

  // Opened again from another screen, it remembers the game played last and picks up there.
  await page.getByRole('link', { name: 'Settings' }).click();
  await hold(page, page.getByRole('heading', { name: 'Settings' }), 900);
  await expect(picker.getByRole('button').nth(1)).toHaveAccessibleName(/Keepalive/);
  await picker.getByRole('button', { name: /Keepalive/ }).click();
  await game.getByRole('button', { name: 'Continue' }).click();
  await expect(status).toHaveText("Gran's house. With Cron.");

  // The world map, from the pause menu: the town, and where you are.
  await game.getByRole('button', { name: 'Menu' }).click();
  await game.getByRole('button', { name: 'Map' }).click();
  const map = game.getByRole('group', { name: 'World map' });
  await expect(map).toBeVisible();
  await expect(map).toContainText('Loopback');
  await expect(map).toContainText('you are here');
  await expect(map.getByRole('button', { name: "You're here" })).toBeDisabled();
  await map.getByRole('button', { name: 'Back' }).click();
  await expect(game.getByRole('group', { name: 'Paused' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(game).toBeHidden();
  const second = await saved(page);
  expect(second?.party).toEqual(['cron']);
});
