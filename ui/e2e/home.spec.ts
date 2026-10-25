import { join } from 'node:path';

import { expect, test } from './hub';
import { openTerminal, pair } from './phone';

// Home also reads the real laptop's disk, battery, services and stray jobs,
// so these tests look only for the things they set up.

test('Home lists every Claude session, and what one done still runs in the background', async ({ page, hub }) => {
  const demo = join(hub.projects, 'demo');
  // Done with its turn, with a watcher still running from it.
  const running = hub.claudeElsewhere(
    { session_id: 'e2e-bg', cwd: demo, transcript_path: '/dev/null', hook_event_name: 'Stop' },
    'sleep 300 # npm run watch-css',
  );
  try {
    await pair(page, hub);
    const sessions = page.getByRole('region', { name: /^Claude sessions/ });
    const row = sessions.getByRole('link', { name: /demo/ });
    await expect(row).toContainText('Done, still running: sleep 300 # npm run watch-css', { timeout: 15_000 });
    await row.click();
    await expect(page).toHaveURL(/#\/center\/s\/e2e-bg$/);
  } finally {
    if (running.pid) process.kill(-running.pid, 'SIGKILL');
  }
});

test("Home shows Claude's usage, and each session how full its context is", async ({ page, hub }) => {
  const demo = join(hub.projects, 'demo');
  const running = hub.claudeElsewhere({ session_id: 'e2e-ctx', cwd: demo, transcript_path: '/dev/null', hook_event_name: 'Stop' });
  try {
    const now = Math.floor(Date.now() / 1000);
    const line = hub.statusLine({
      session_id: 'e2e-ctx',
      model: { display_name: 'Opus 5.5' },
      context_window: { used_percentage: 42.4, context_window_size: 1_000_000 },
      rate_limits: {
        five_hour: { used_percentage: 18, resets_at: now + 2 * 3600 + 600 },
        seven_day: { used_percentage: 83, resets_at: now + 3 * 86_400 },
      },
    });
    expect(line).toBe('Opus 5.5 · context 42%');
    await pair(page, hub);

    const sessions = page.getByRole('region', { name: /^Claude sessions/ });
    const row = sessions.getByRole('link', { name: /demo/ });
    await expect(row.getByRole('meter', { name: 'Context used' })).toHaveAttribute('aria-valuenow', '42', { timeout: 15_000 });
    await expect(row).toContainText('42% of 1M');

    const usage = page.getByRole('region', { name: 'Claude usage' });
    await expect(usage).toContainText('18% · resets in 2 h 10 min');
    await expect(usage).toContainText('83% · resets in 3 days');
    await expect(usage.getByRole('meter', { name: 'This week, used' })).toHaveAttribute('aria-valuenow', '83');
  } finally {
    if (running.pid) process.kill(-running.pid, 'SIGKILL');
  }
});

test("Home's sessions say the terminal they're in, and can be hidden", async ({ page, hub }) => {
  await pair(page, hub);
  await openTerminal(page, 'Backend');
  const pane = hub.tmux('display-message', '-p', '-t', '$0', '#{pane_id}');
  hub.hook({ session_id: 'e2e-named', cwd: join(hub.projects, 'demo'), hook_event_name: 'Stop' }, pane);
  await page.getByRole('link', { name: 'Terminals' }).click();
  await page.getByRole('link', { name: 'Home', exact: true }).click();

  const sessions = page.getByRole('region', { name: /^Claude sessions/ });
  const row = sessions.getByRole('link', { name: /Backend/ });
  await expect(row).toBeVisible({ timeout: 15_000 });

  await sessions.getByRole('button', { name: 'Hide: Backend' }).click();
  await expect(row).toBeHidden();
  // Kept on this phone.
  await page.reload();
  await expect(sessions.getByRole('button', { name: 'Show 1 hidden' })).toBeVisible();
  await expect(row).toBeHidden();
  await sessions.getByRole('button', { name: 'Show 1 hidden' }).click();
  await sessions.getByRole('button', { name: 'Unhide' }).click();
  await expect(row).toBeVisible();
  await expect(sessions.getByRole('button', { name: /hidden/ })).toHaveCount(0);
});

test("a session's screen scrolls through its history, zooms, and its text can be selected", async ({ page, hub }) => {
  await pair(page, hub);
  await openTerminal(page, 'Live');
  const pane = hub.tmux('display-message', '-p', '-t', '$0', '#{pane_id}');
  await expect.poll(() => hub.tmux('capture-pane', '-p', '-t', pane), { timeout: 20_000 }).not.toBe('');
  hub.tmux('send-keys', '-t', pane, '-l', 'seq 1 200');
  hub.tmux('send-keys', '-t', pane, 'Enter');
  await expect.poll(() => hub.tmux('capture-pane', '-p', '-t', pane)).toMatch(/^200$/m);
  hub.hook({ session_id: 'e2e-live', cwd: join(hub.projects, 'demo'), hook_event_name: 'Stop' }, pane);
  await page.goto(`${hub.url}/#/center/s/e2e-live`);

  const live = page.getByRole('region', { name: 'Its terminal, live' });
  // Lines long gone from its screen are there to scroll back to.
  await expect(live).toContainText('\n40\n41\n', { timeout: 15_000 });
  const text = live.locator('pre');
  const size = async () => Number.parseFloat(await text.evaluate((element) => getComputedStyle(element).fontSize));
  const fitted = await size();
  await live.getByRole('button', { name: 'Zoom in' }).click();
  await live.getByRole('button', { name: 'Zoom in' }).click();
  expect(await size()).toBeCloseTo(fitted * 1.5, 1);
  await live.getByRole('button', { name: 'Zoom out' }).click();
  expect(await size()).toBeCloseTo(fitted * 1.25, 1);

  // Text anywhere can be selected; controls can't.
  const selectable = (locator: typeof text) =>
    locator.evaluate((element) => getComputedStyle(element).webkitUserSelect || getComputedStyle(element).userSelect);
  expect(await selectable(page.locator('main p:not(header p)').first())).not.toBe('none');
  expect(await selectable(live.getByRole('button', { name: 'Zoom in' }))).toBe('none');
});

test('Home shows what waits on you first, and hides what was only worth a look', async ({ page, hub }) => {
  await pair(page, hub);

  // Two Claude sessions in a terminal: one finished, one asking to run something.
  await openTerminal(page, 'demo');
  const pane = hub.tmux('display-message', '-p', '-t', '$0', '#{pane_id}');
  const demo = join(hub.projects, 'demo');
  const done = { session_id: 'e2e-done', cwd: demo, transcript_path: '/dev/null' };
  hub.hook({ ...done, hook_event_name: 'SessionStart', source: 'startup' }, pane);
  hub.hook({ ...done, hook_event_name: 'Stop' }, pane);
  const asking = { session_id: 'e2e-asking', cwd: demo, transcript_path: '/dev/null' };
  hub.hook({ ...asking, hook_event_name: 'SessionStart', source: 'startup' }, pane);
  hub.hook(
    { ...asking, hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: { command: 'pnpm test' } },
    pane,
  );

  await page.getByRole('link', { name: 'Terminals' }).click();
  await page.getByRole('link', { name: 'Home', exact: true }).click();
  const waiting = page.getByRole('region', { name: /^Waiting on you/ });
  await expect(waiting.getByRole('region', { name: 'demo needs you' })).toContainText('pnpm test');

  // The finished one is worth a look, and leads to its session.
  const glance = page.getByRole('region', { name: 'Worth a look' });
  const finished = glance.getByRole('link', { name: /Claude finished/ });
  await expect(finished).toContainText('demo');
  await expect(page.getByText(/1 terminal\b/)).toBeVisible();

  // Hidden, it stays hidden on this phone until shown again.
  await glance.getByRole('button', { name: 'Hide: Claude finished' }).click();
  await expect(finished).toBeHidden();
  await page.reload();
  await expect(waiting.getByRole('region', { name: 'demo needs you' })).toBeVisible();
  await expect(finished).toBeHidden();
  await page.getByRole('button', { name: 'Show 1 hidden item' }).click();
  await finished.click();
  await expect(page).toHaveURL(/#\/center\/s\/e2e-done$/);
});
