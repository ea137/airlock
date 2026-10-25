import { expect, test } from './hub';
import { openTerminal, pair } from './phone';

test('a phone pairs, opens a terminal, and runs what it types', async ({ page, hub }) => {
  await pair(page, hub);
  await page.getByRole('link', { name: 'Terminals', exact: true }).click();
  await expect(page.getByText('No Airlock terminals are open.', { exact: false })).toBeVisible();
  await openTerminal(page, 'E2E');
  const row = (text: RegExp) => page.locator('.xterm-rows > div').filter({ hasText: text });
  await page.locator('.xterm').click();
  // The shell computes 40+2: a row reading 42 means the keys ran, not just echoed.
  await page.keyboard.type('echo airlock-$((40+2))');
  await page.keyboard.press('Enter');
  await expect(row(/^airlock-42\s*$/)).toHaveCount(1);

  // Ctrl from the key bar, then a typed c, throws the line away: the next
  // command runs on its own, with nothing of the first left in front of it.
  await page.keyboard.type('echo never-runs');
  const ctrl = page.getByRole('button', { name: 'Ctrl', exact: true });
  await ctrl.click();
  await expect(ctrl).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.type('c');
  await expect(ctrl).toHaveAttribute('aria-pressed', 'false');
  await page.keyboard.type('echo after-$((1+1))');
  await page.keyboard.press('Enter');
  await expect(row(/^after-2\s*$/)).toHaveCount(1);
  await expect(row(/never-runsc/)).toHaveCount(0);

  const tabs = page.getByRole('navigation', { name: 'Tabs' });
  await tabs.getByRole('button', { name: 'New tab' }).click();
  await expect(tabs.getByRole('button')).toHaveCount(4);
  await tabs.getByRole('button').nth(1).click({ button: 'right' });
  const tabSheet = page.getByRole('dialog');
  await tabSheet.getByLabel('Name').fill('claude');
  await tabSheet.getByRole('button', { name: 'Save name' }).click();
  await expect(tabs.getByRole('button', { name: 'claude' })).toBeVisible();

  await page.getByRole('link', { name: 'Terminals', exact: true }).click();
  const card = page.getByRole('link', { name: /E2E/ });
  await expect(card).toContainText('2 tabs');
  await expect(card).toContainText('claude');
});

test("the phone's keyboard comes up only from its button", async ({ page, hub }) => {
  await pair(page, hub);
  await openTerminal(page, 'Keys');
  // What the phone's keyboard follows: the terminal's input, focused, and
  // its input mode ("none": no keyboard on screen).
  const input = page.locator('.xterm-helper-textarea');
  const keyboard = page.getByRole('button', { name: 'Keyboard' });
  const row = (text: RegExp) => page.locator('.xterm-rows > div').filter({ hasText: text });

  await expect(input).toBeFocused();
  await expect(input).toHaveAttribute('inputmode', 'none');
  await expect(row(/\$\s*$/).first()).toBeVisible();
  await page.getByRole('button', { name: '→', exact: true }).click();
  await page.locator('.xterm').click();
  await expect(input).toBeFocused();
  await expect(input).toHaveAttribute('inputmode', 'none');
  await expect(keyboard).toHaveAttribute('aria-pressed', 'false');
  // A hardware keyboard types in all the same.
  await page.keyboard.type('echo typed-$((2+3))');
  await page.keyboard.press('Enter');
  await expect(row(/^typed-5\s*$/)).toHaveCount(1);

  await keyboard.click();
  await expect(keyboard).toHaveAttribute('aria-pressed', 'true');
  await expect(input).toHaveAttribute('inputmode', 'text');
  await expect(input).toBeFocused();
  await page.getByRole('button', { name: '→', exact: true }).click();
  await expect(input).toHaveAttribute('inputmode', 'text');

  await keyboard.click();
  await expect(keyboard).toHaveAttribute('aria-pressed', 'false');
  await expect(input).toHaveAttribute('inputmode', 'none');
  await expect(input).toBeFocused();
  await keyboard.click();
  await page.getByRole('button', { name: 'Go to…' }).click();
  await expect(keyboard).toHaveAttribute('aria-pressed', 'false');
  await expect(input).toHaveAttribute('inputmode', 'none');
});

test('a swipe back into history has a way to the bottom, and Copy holds the history too', async ({ page, hub }) => {
  await pair(page, hub);
  await openTerminal(page, 'History');
  const row = (text: RegExp) => page.locator('.xterm-rows > div').filter({ hasText: text });
  await expect(row(/\$\s*$/).first()).toBeVisible();
  await page.keyboard.type('seq 1 300');
  await page.keyboard.press('Enter');
  await expect(row(/^300\s*$/)).toHaveCount(1);
  const pane = hub.tmux('display-message', '-p', '-t', '$0', '#{pane_id}');

  // A finger moving down the screen shows older lines: tmux's history view.
  const term = page.locator('.xterm');
  const box = (await term.boundingBox())!;
  const at = (y: number) => [{ identifier: 1, clientX: box.x + box.width / 2, clientY: y }];
  await term.dispatchEvent('touchstart', { touches: at(box.y + 40), changedTouches: at(box.y + 40) });
  for (let y = box.y + 40; y < box.y + 400; y += 20) {
    await term.dispatchEvent('touchmove', { touches: at(y), changedTouches: at(y) });
  }
  await term.dispatchEvent('touchend', { touches: [], changedTouches: at(box.y + 400) });
  await expect.poll(() => hub.tmux('display-message', '-p', '-t', pane, '#{pane_in_mode}')).toBe('1');

  const bottom = page.getByRole('button', { name: 'To the bottom' });
  await bottom.click();
  await expect.poll(() => hub.tmux('display-message', '-p', '-t', pane, '#{pane_in_mode}')).toBe('0');
  await expect(bottom).toBeHidden();

  await page.getByRole('button', { name: 'Copy', exact: true }).click();
  const copy = page.getByRole('region', { name: 'Copy text' });
  await expect(copy).toContainText('\n12\n13\n');
  await expect(copy).toContainText('300');
});

test('revoking the phone on the laptop sends it back to pairing', async ({ page, hub }) => {
  await pair(page, hub);
  hub.airlock('revoke', 'E2E phone');
  await expect(page.getByRole('button', { name: 'Ask the laptop' })).toBeVisible();
});

test('strangers without the Tailscale identity get nothing', async ({ request, hub }) => {
  // Straight to the hub, around the front that adds the identity, as anyone
  // without Tailscale's word would arrive.
  const response = await request.get(`${hub.directUrl}/api/terminals`);
  expect(response.status()).toBe(403);
});
