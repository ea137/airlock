import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test } from './hub';
import { pair } from './phone';

test('a program running in a laptop tab still has the terminal ask before closing it', async ({ hub }) => {
  const laptop = hub.laptopTab(100);
  await expect.poll(laptop.screen).toContain('tab$');
  // At the prompt the tab's own process holds the keyboard: nothing to ask.
  expect(laptop.holder()).toBe('airlock');
  // A program runs: a helper of its own holds it, as GNOME Terminal asks
  // before closing a tab whose keyboard isn't held by what it started.
  laptop.type('cat\n');
  await expect.poll(laptop.holder).toBe('airlock-tab-busy');
  // Typing still reaches the program, and the prompt gets the keyboard back.
  laptop.type('typed-while-running\n');
  await expect.poll(laptop.screen).toMatch(/typed-while-running\ntyped-while-running/);
  laptop.type('\x04');
  await expect.poll(laptop.holder).toBe('airlock');
  laptop.type('echo back-$((1+1))\n');
  await expect.poll(laptop.screen).toMatch(/^back-2$/m);
});

test('Claude asking in a laptop tab is answered from the phone', async ({ page, hub }) => {
  await pair(page, hub);
  const laptop = hub.laptopTab(100);
  await expect.poll(laptop.screen).toContain('tab$');
  // Claude, played by the stand-in, asks for permission in the tab.
  const keys = join(hub.projects, 'keys.out');
  const event = JSON.stringify({
    session_id: 'tab-session',
    cwd: join(hub.projects, 'demo'),
    hook_event_name: 'PermissionRequest',
    tool_name: 'Bash',
    tool_input: { command: 'pnpm test' },
  });
  laptop.type(`AIRLOCK_HOOK_EVENT='${event}' AIRLOCK_PROMPT_KEYS=${keys} ${hub.standInClaude}\n`);
  await expect.poll(laptop.screen).toContain('Do you want to proceed?');

  // Work shows it waiting, says where it runs, and Allow once types Enter there.
  await page.getByRole('link', { name: 'Work', exact: true }).click();
  const ask = page.getByRole('region', { name: 'demo needs you' });
  await expect(ask).toContainText('pnpm test', { timeout: 10_000 });
  await ask.getByRole('button', { name: 'Allow once' }).click();
  await expect(ask).toBeHidden();
  await expect.poll(() => (existsSync(keys) ? readFileSync(keys, 'utf8') : '')).toBe('\n');
});

test("a laptop tab shows on the phone as it is, and both type into it", async ({ page, hub }) => {
  await pair(page, hub);
  // A GNOME Terminal tab, 100 wide, with its shell shared.
  const laptop = hub.laptopTab(100);
  await expect.poll(laptop.screen).toContain('tab$');

  await page.getByRole('link', { name: 'Terminals', exact: true }).click();
  const section = page.getByRole('region', { name: 'ON THE LAPTOP' });
  const row = section.getByRole('link').first();
  await expect(row).toBeVisible({ timeout: 10_000 });
  await row.click();
  await expect(page.getByText('On the laptop', { exact: false })).toBeVisible();

  // Each row of the phone's screen, as xterm draws it.
  const shown = (text: RegExp) => page.locator('.xterm-rows > div').filter({ hasText: text });
  await page.locator('.xterm').click();
  // Typed on the phone, run in the laptop's tab: the shell computes 40+2.
  await page.keyboard.type('echo phone-$((40+2)); tput cols');
  await page.keyboard.press('Enter');
  await expect.poll(laptop.screen).toMatch(/^phone-42$/m);
  // The tab took the phone's width while the phone typed.
  const phoneCols = Number(/phone-42\n(\d+)/.exec(laptop.screen())?.[1]);
  expect(phoneCols).toBeLessThan(100);
  await expect(shown(/^phone-42\s*$/)).toHaveCount(1);

  // Typed on the laptop, shown on the phone; the laptop has its size back.
  laptop.type('echo laptop-$((1+1)); tput cols\n');
  await expect(shown(/^laptop-2\s*$/)).toHaveCount(1);
  await expect.poll(laptop.screen).toMatch(/^laptop-2\n100$/m);

  // Closed on the laptop, it leaves the phone at once.
  laptop.type('exit\n');
  await expect(page).toHaveURL(/#\/terminals$/, { timeout: 5_000 });
  await expect(section.getByRole('link')).toHaveCount(0);
});
