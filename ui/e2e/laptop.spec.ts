import type { Page } from '@playwright/test';

import { expect, type Hub, test } from './hub';
import { Laptop } from './laptop';
import { openTerminal, pair } from './phone';

/** The phone asks to pair and returns the code it shows. */
async function askToPair(phone: Page, hub: Hub, name: string): Promise<string> {
  await phone.goto(hub.url);
  await phone.getByLabel('Name for this device').fill(name);
  await phone.getByRole('button', { name: 'Ask the laptop' }).click();
  const label = await phone.getByLabel(/^Code \d{6}$/).getAttribute('aria-label');
  return label?.replace('Code ', '') ?? '';
}

test('the laptop lets a phone in, then cuts it off', async ({ page: phone, hub, browser }) => {
  const laptop = await Laptop.open(browser, hub);
  const window = laptop.page;
  await expect(window.getByText('Hub running')).toBeVisible();
  await expect(window.getByText('No device is asking to pair.', { exact: false })).toBeVisible();

  // The request shows up on its own, with the code the phone shows.
  const code = await askToPair(phone, hub, 'Test phone');
  const requests = window.getByRole('region', { name: 'Waiting to pair' });
  const request = requests.getByRole('listitem').filter({ hasText: 'Test phone' });
  await expect(request.getByLabel(`Code ${code}`)).toBeVisible();

  await request.getByRole('button', { name: 'Let Test phone in' }).click();
  await expect(phone.getByRole('heading', { name: 'Home', exact: true })).toBeVisible();
  const devices = window.getByRole('region', { name: 'Paired devices' });
  await expect(devices.getByText('Test phone')).toBeVisible();
  await expect(requests.getByRole('listitem')).toHaveCount(0);
  const activity = window.getByRole('region', { name: 'Activity' });
  await expect(activity).toContainText('pairing approved');
  await expect(activity).toContainText('device paired');

  // Revoking asks first; Cancel leaves the device alone.
  await devices.getByRole('button', { name: 'Revoke' }).click();
  const confirm = window.getByRole('dialog', { name: 'Revoke Test phone?' });
  await expect(confirm).toBeVisible();
  await expect(confirm.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await confirm.getByRole('button', { name: 'Cancel' }).click();
  await expect(confirm).toBeHidden();
  await expect(devices.getByText('Test phone')).toBeVisible();

  await devices.getByRole('button', { name: 'Revoke' }).click();
  await confirm.getByRole('button', { name: 'Revoke' }).click();
  await expect(devices.getByText('No devices are paired.')).toBeVisible();
  await expect(activity).toContainText('device revoked');
  // The phone is out at once.
  await expect(phone.getByRole('button', { name: 'Ask the laptop' })).toBeVisible();

  await laptop.close();
});

test('the laptop turns a phone away', async ({ page: phone, hub, browser }) => {
  const laptop = await Laptop.open(browser, hub);
  await askToPair(phone, hub, 'Stranger phone');
  const request = laptop.page.getByRole('listitem').filter({ hasText: 'Stranger phone' });
  await request.getByRole('button', { name: 'Turn away' }).click();
  await expect(phone.getByText('The laptop turned this device away.')).toBeVisible();
  await expect(laptop.page.getByRole('region', { name: 'Activity' })).toContainText('pairing denied');
  await laptop.close();
});

test('the laptop says so when the hub stops', async ({ hub, browser }) => {
  const laptop = await Laptop.open(browser, hub);
  await expect(laptop.page.getByText('Hub running')).toBeVisible();
  await hub.kill();
  await expect(laptop.page.getByText('Hub not running')).toBeVisible();
  await expect(laptop.page.getByRole('heading', { name: "The hub isn't running" })).toBeVisible();
  await laptop.close();
});

test("the phone's terminals and sessions show on the laptop, and stay in its history", async ({
  page: phone,
  hub,
  browser,
}) => {
  await pair(phone, hub);
  await openTerminal(phone, 'from-phone');
  const pane = hub.tmux('display-message', '-p', '-t', '$0', '#{pane_id}');
  // Typed once its shell is up: a busy laptop can take seconds to start one.
  await expect.poll(() => hub.tmux('capture-pane', '-p', '-t', pane), { timeout: 20_000 }).not.toBe('');
  hub.tmux('send-keys', '-t', pane, '-l', 'echo kept-$((40+2))');
  hub.tmux('send-keys', '-t', pane, 'Enter');
  await expect.poll(() => hub.tmux('capture-pane', '-p', '-t', pane)).toMatch(/^kept-42$/m);
  hub.hook({ session_id: 'laptop-session', cwd: hub.projects, hook_event_name: 'UserPromptSubmit', prompt: 'tidy the notes' }, pane);

  const laptop = await Laptop.open(browser, hub);
  const window = laptop.page;
  const failures: string[] = [];
  window.on('pageerror', (error) => failures.push(error.message));
  const sections = window.getByRole('navigation', { name: 'Sections' });

  // The window locks Object.prototype once it has loaded, and its terminal
  // library still works under the lock (it once left the window blank).
  expect(await window.evaluate(() => Object.isFrozen(Object.prototype))).toBe(true);

  // Terminals: the phone's terminal, opened here.
  await sections.getByRole('button', { name: 'Terminals' }).click();
  const card = window.getByRole('listitem').filter({ hasText: 'from-phone' });
  await expect(card).toContainText('kept-42');
  await card.getByRole('button', { name: 'Open here' }).click();
  await expect(window.locator('.xterm')).toBeVisible();
  expect(failures).toEqual([]);
  await sections.getByRole('button', { name: 'Terminals' }).click();

  // Sessions: Claude, working, with what you asked.
  await sections.getByRole('button', { name: 'Sessions' }).click();
  const session = window.getByRole('button', { name: /Working/ });
  await expect(session).toContainText("one of Airlock's terminals");
  await session.click();
  await expect(window.getByText('You asked: tidy the notes')).toBeVisible();

  // History: the terminal is kept, open now; once it closes, still there,
  // with what it showed.
  await sections.getByRole('button', { name: 'History' }).click();
  const kept = window.getByRole('listitem').filter({ hasText: 'from-phone' });
  await expect(kept).toContainText('open now');
  hub.tmux('kill-session', '-t', '$0');
  await window.getByRole('button', { name: 'Refresh' }).click();
  await expect(kept).toContainText('closed');
  await kept.getByRole('button', { name: /from-phone/ }).click();
  await expect(window.getByRole('region', { name: 'Kept terminal from-phone' })).toContainText('kept-42');
  await window.getByRole('button', { name: 'History', exact: false }).filter({ hasText: '‹' }).click();

  // Deleted sooner, on purpose: asked twice.
  await kept.getByRole('button', { name: 'Delete' }).click();
  await kept.getByRole('button', { name: 'Delete for good?' }).click();
  await expect(kept).toBeHidden();
  await laptop.close();
});

test('a copied token raises an alarm until dismissed', async ({ hub, browser }) => {
  const laptop = await Laptop.open(browser, hub);
  await expect(laptop.page.getByText('Hub running')).toBeVisible();
  // The hub's own tests cover catching the copy; this is the window's part.
  await laptop.emit('hub-event', { type: 'token_reused', id: 'd1', name: 'iPhone' });
  const alarm = laptop.page.getByRole('alert').filter({ hasText: 'Airlock cut off iPhone.' });
  await expect(alarm).toBeVisible();
  await alarm.getByRole('button', { name: 'Dismiss' }).click();
  await expect(alarm).toBeHidden();
  await laptop.close();
});
