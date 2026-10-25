import type { ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test } from './hub';
import { openTerminal, pair } from './phone';

/** A stand-in for Claude's permission prompt: shows it, then records the
 * keys it gets into the file named by its argument. */
const FAKE_PROMPT = `stty -icanon min 1 time 0 -echo
clear
printf 'Bash command\\n\\n  pnpm test\\n\\nDo you want to proceed?\\n'
printf '\\342\\235\\257 1. Yes\\n'
printf "  2. Yes, and don't ask again for: pnpm test\\n"
printf '  3. No\\n'
timeout --foreground 20 cat > "$1"
`;

test('a session that needs you is answered from the phone', async ({ page, hub }) => {
  await pair(page, hub);
  await openTerminal(page, 'demo');
  const demo = join(hub.projects, 'demo');

  // Claude, played by the fake prompt, asks in the terminal's pane; its
  // hooks tell the hub.
  const script = join(hub.projects, 'prompt.sh');
  const keys = join(hub.projects, 'keys.out');
  writeFileSync(script, FAKE_PROMPT);
  const pane = hub.tmux('display-message', '-p', '-t', '$0', '#{pane_id}');
  // Typed once its shell is up: a busy laptop can take seconds to start one.
  await expect.poll(() => hub.tmux('capture-pane', '-p', '-t', pane), { timeout: 20_000 }).not.toBe('');
  hub.tmux('send-keys', '-t', pane, '-l', `bash ${script} ${keys}`);
  hub.tmux('send-keys', '-t', pane, 'Enter');
  await expect.poll(() => hub.tmux('capture-pane', '-p', '-t', pane)).toContain('Do you want to proceed?');
  const event = { session_id: 'e2e-session', cwd: demo, transcript_path: '/dev/null' };
  hub.hook({ ...event, hook_event_name: 'SessionStart', source: 'startup' }, pane);
  hub.hook({ ...event, hook_event_name: 'UserPromptSubmit', prompt: 'run the tests' }, pane);
  hub.hook({ ...event, hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: { command: 'pnpm test' } }, pane);

  await page.getByRole('link', { name: 'Terminals', exact: true }).click();
  await page.getByRole('link', { name: 'Work', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Projects' })).toHaveAttribute('aria-pressed', 'true');
  const ask = page.getByRole('region', { name: 'demo needs you' });
  await expect(ask).toContainText('Claude wants to run');
  await expect(ask).toContainText('pnpm test');
  await expect(page.getByRole('heading', { name: /1 project · 1 needs you/ })).toBeVisible();
  const repo = page.getByRole('link', { name: /^demo/ });
  await expect(repo).toContainText('main · clean');

  // Allow once is typed into the terminal: Enter on "Yes".
  await ask.getByRole('button', { name: 'Allow once' }).click();
  await expect(ask).toBeHidden();
  await expect.poll(() => (existsSync(keys) ? readFileSync(keys, 'utf8') : '')).toBe('\n');

  hub.hook({ ...event, hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'pnpm test' } }, pane);
  hub.hook({ ...event, hook_event_name: 'Stop' }, pane);
  await repo.click();
  await expect(page.getByRole('heading', { name: 'demo' })).toBeVisible();
  await expect(page.getByText('WORKTREES · 1')).toBeVisible();
  await expect(page.getByText('Finished; waiting for you')).toBeVisible();
  await expect(page.getByText("This repo isn't on GitHub.")).toBeVisible();

  await page.getByRole('link', { name: 'Session details' }).click();
  await expect(page.getByText('Idle', { exact: true })).toBeVisible();
  await expect(page.getByText('You asked: run the tests')).toBeVisible();

  const live = page.getByRole('region', { name: 'Its terminal, live' });
  await expect(live).toBeVisible();
  await expect(live.locator('pre')).toContainText('Do you want to proceed?');
  // The fake prompt is still reading its keys: what's typed lands there.
  await live.getByLabel('Type into it').fill('typed-on-the-phone');
  await live.getByRole('button', { name: 'Send' }).click();
  await expect.poll(() => readFileSync(keys, 'utf8')).toContain('typed-on-the-phone');

  hub.transcript('e2e-session', [
    { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'toolu_e2e', name: 'Bash', input: { command: 'pnpm test', description: 'Run the tests' } }] } },
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_e2e', content: '12 passed' }] } },
  ]);
  await page.getByRole('link', { name: /Ran pnpm test/ }).click();
  await expect(page.getByRole('heading', { name: 'Command', exact: true })).toBeVisible();
  await expect(page.getByText('Run the tests')).toBeVisible();
  await expect(page.getByText('12 passed')).toBeVisible();
  await page.getByRole('link', { name: 'Session' }).click();

  await page.getByRole('button', { name: 'in its terminal ›' }).click();
  await expect(page.getByRole('heading', { name: 'demo' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Tabs' })).toBeVisible();
});

test('projects are grouped by their folder, fold away, and hide', async ({ page, hub }) => {
  mkdirSync(join(hub.projects, 'notes'));
  await pair(page, hub);
  await page.getByRole('link', { name: 'Work', exact: true }).click();
  const group = page.getByRole('region', { name: /2 projects/ });
  await expect(group.getByRole('link', { name: /^demo/ })).toBeVisible();
  // A folder that isn't a repo is a project too.
  await expect(group.getByRole('link', { name: /^notes/ })).toContainText('folder');

  await group.getByRole('button', { name: /2 projects/ }).click();
  await expect(group.getByRole('link', { name: /^demo/ })).toBeHidden();
  await page.reload();
  await expect(page.getByRole('region', { name: /2 projects/ }).getByRole('link', { name: /^demo/ })).toBeHidden();
  await page.getByRole('button', { name: /2 projects/ }).click();

  await page.getByRole('button', { name: 'Edit' }).click();
  await page.getByRole('button', { name: 'Hide notes' }).click();
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByRole('link', { name: /^notes/ })).toBeHidden();
  await page.getByRole('button', { name: 'Show 1 hidden' }).click();
  await expect(page.getByRole('link', { name: /^notes/ })).toBeVisible();

  await page.getByRole('link', { name: /^notes/ }).click();
  await expect(page.getByRole('heading', { name: 'notes' })).toBeVisible();
  await expect(page.getByText('No Claude sessions here yet.')).toBeVisible();
});

test('a session whose terminal is gone leaves the sessions view', async ({ page, hub }) => {
  await pair(page, hub);
  hub.hook(
    {
      session_id: 'outside',
      cwd: join(hub.projects, 'demo'),
      hook_event_name: 'PreToolUse',
      tool_name: 'Edit',
      tool_input: { file_path: join(hub.projects, 'demo', 'README.md') },
    },
    '%999',
  );
  await page.getByRole('link', { name: 'Work', exact: true }).click();
  await page.getByRole('button', { name: 'Sessions' }).click();
  await expect(page.getByRole('button', { name: 'Sessions' })).toHaveAttribute('aria-pressed', 'true');
  // Its pane doesn't exist, so it shows as ended, and ended sessions leave
  // the live list.
  await expect(page.getByText('No Claude sessions are running.', { exact: false })).toBeVisible();
});

test("a session open in a tab the phone can't reach is shared, never resumed beside it", async ({ page, hub }) => {
  const event = { session_id: 'e2e-away', cwd: join(hub.projects, 'demo'), transcript_path: '/dev/null' };
  const working = hub.claudeElsewhere({
    ...event,
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    tool_input: { command: 'pnpm test' },
  });
  let finished: ChildProcess | null = null;
  try {
    await pair(page, hub);
    await page.evaluate(() => {
      location.hash = '#/center/s/e2e-away';
    });
    await expect(page.getByText('so the phone can follow it but not type into it')).toBeVisible();
    const move = page.getByRole('button', { name: 'Share with the phone' });
    await expect(page.getByText("It's working. It can be shared once it has finished its turn.")).toBeVisible();
    await expect(move).toHaveAttribute('aria-disabled', 'true');
    await move.click({ force: true });
    await expect(page.getByRole('dialog')).toBeHidden();

    // It finishes its turn (the hooks now come from this Claude).
    finished = hub.claudeElsewhere({ ...event, hook_event_name: 'Stop' });
    await expect(move).toHaveAttribute('aria-disabled', 'false', { timeout: 10_000 });
    await move.click();
    const ask = page.getByRole('dialog', { name: 'Share this session with the phone?' });
    await expect(ask).toContainText('Claude quits in');
    await ask.getByRole('button', { name: 'Share it' }).click();

    const quit = finished;
    await expect.poll(() => quit.exitCode, { timeout: 10_000 }).toBe(143);
    await expect(page).toHaveURL(/#\/t\/\d+$/);
    const terminal = /#\/t\/(\d+)$/.exec(page.url())?.[1];
    await expect
      .poll(() => hub.tmux('capture-pane', '-p', '-t', `$${terminal}`))
      .toContain('claude (stand-in) --resume e2e-away');
  } finally {
    working.kill('SIGTERM');
    finished?.kill('SIGTERM');
  }
});
