import { type ChildProcess, spawn, spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';

import { expect, test } from './hub';
import { pair } from './phone';

/** A dev server that answers every request with what it received, and
 * tries to plant a cookie named like Airlock's. */
const ECHO_SERVER = `import http.server, json, sys
class Echo(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        body = json.dumps({"path": self.path, "headers": dict(self.headers)}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "text/plain")
        self.send_header("Set-Cookie", "airlock_device=planted; Path=/")
        self.send_header("Set-Cookie", "app=1; Path=/")
        self.end_headers()
        self.wfile.write(body)
    def log_message(self, *args):
        pass
http.server.HTTPServer(("127.0.0.1", int(sys.argv[1])), Echo).serve_forever()
`;

async function freePort(): Promise<number> {
  return new Promise((done) => {
    const server = createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => done(typeof address === 'object' && address ? address.port : 0));
    });
  });
}

function exited(child: ChildProcess): Promise<void> {
  return child.exitCode !== null || child.signalCode !== null
    ? Promise.resolve()
    : new Promise((done) => child.once('exit', () => done()));
}

test('a dev server is previewed on its own origin, without Airlock’s cookies', async ({ page, hub }) => {
  const port = await freePort();
  const script = join(hub.projects, 'devserver.py');
  writeFileSync(script, ECHO_SERVER);
  const server = spawn('python3', [script, String(port)], { stdio: 'ignore' });
  try {
    await pair(page, hub);
    await page.getByRole('link', { name: 'System', exact: true }).click();
    const row = page.getByRole('button', { name: new RegExp(`^:${port} `) });
    await expect(row).toBeVisible({ timeout: 15_000 });
    await expect(row).toContainText('devserver');
    await expect(row).toContainText('laptop only');
    await row.click();
    const sheet = page.getByRole('dialog', { name: `:${port} devserver` });
    await expect(sheet).toContainText('Safe');
    await expect(sheet).toContainText('Only programs on this laptop can connect to it.');
    await sheet.getByRole('link', { name: 'Preview' }).click();
    await expect(page.getByRole('heading', { name: 'Preview' })).toBeVisible();

    const body = page.frameLocator(`iframe[title="Preview of :${port}"]`).locator('body');
    await expect(body).toContainText('"path": "/"');
    const echoed = JSON.parse((await body.textContent()) ?? '{}') as { headers: Record<string, string> };
    const header = (name: string) =>
      Object.entries(echoed.headers).find(([key]) => key.toLowerCase() === name)?.[1];
    expect(header('host'), 'the dev server sees itself asked for').toBe(`localhost:${port}`);
    expect(header('tailscale-user-login')).toBeUndefined();
    expect(header('cookie') ?? '', 'none of Airlock’s cookies reach it').not.toContain('airlock_');

    // Its planted cookie didn't land: this phone is still paired.
    await page.goto(hub.url);
    await expect(page.getByRole('heading', { name: 'Home', exact: true })).toBeVisible();
  } finally {
    server.kill();
  }
});

test('a busy process is stopped from the phone, after asking', async ({ page, hub }) => {
  const script = join(hub.projects, 'e2e-burner.py');
  writeFileSync(script, 'while True:\n    pass\n');
  const burner = spawn('python3', [script], { stdio: 'ignore' });
  try {
    await pair(page, hub);
    await page.getByRole('link', { name: 'System', exact: true }).click();
    await page.getByRole('link', { name: 'Processes' }).click();
    await expect(page.getByRole('region', { name: 'The laptop now' })).toContainText('cores');
    await page.getByLabel('Search processes').fill('e2e-burner');
    const row = page.getByRole('button', { name: /^e2e-burner/ });
    await expect(row).toBeVisible({ timeout: 20_000 });
    // Once it has been looked at twice, it shows its CPU.
    await expect(row).toContainText(/\d+%/, { timeout: 10_000 });

    await row.click();
    await expect(page.getByText('python3 ', { exact: false }).first()).toBeVisible();
    await page.getByRole('button', { name: 'What is threads?' }).click();
    await expect(page.getByRole('note', { name: 'Threads' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('note', { name: 'Threads' })).toBeHidden();

    await page.getByRole('button', { name: 'Stop', exact: true }).click();
    const ask = page.getByRole('alertdialog', { name: 'Stop e2e-burner?' });
    await expect(ask).toContainText('Airlock asks it to stop politely first.');
    await ask.getByRole('button', { name: 'Stop' }).click();
    await expect(ask).toBeHidden();
    await exited(burner);
    expect(burner.signalCode).toBe('SIGTERM');
  } finally {
    burner.kill('SIGKILL');
  }
});

test('a listening port says what it is, and its program is stopped from there', async ({ page, hub }) => {
  const port = await freePort();
  const script = join(hub.projects, 'e2e-listener.py');
  writeFileSync(
    script,
    'import socket, sys, time\ns = socket.socket()\ns.bind(("127.0.0.1", int(sys.argv[1])))\ns.listen()\ntime.sleep(600)\n',
  );
  const listener = spawn('python3', [script, String(port)], { stdio: 'ignore' });
  try {
    await pair(page, hub);
    await page.getByRole('link', { name: 'System', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'LISTENING PORTS' })).toBeVisible();
    // Ports open to other networks come first; this one may be further down.
    const more = page.getByRole('button', { name: /^Show \d+ more$/ });
    if (await more.isVisible()) await more.click();
    const row = page.getByRole('button', { name: new RegExp(`^:${port} e2e-listener`) });
    await expect(row).toBeVisible({ timeout: 15_000 });
    await row.click();

    const sheet = page.getByRole('dialog', { name: `:${port} e2e-listener` });
    // A script is named with what it was given: here, its port.
    await expect(sheet).toContainText(`e2e-listener ${port}, one of your programs.`);
    await expect(sheet).toContainText(/Run by you, as process \d+/);
    await expect(sheet.getByRole('status')).toContainText('Safe');
    await sheet.getByRole('button', { name: `Stop e2e-listener ${port}…` }).click();
    const ask = page.getByRole('alertdialog', { name: `Stop e2e-listener ${port}?` });
    await expect(ask).toContainText(`It stops serving :${port}.`);
    await ask.getByRole('button', { name: 'Stop' }).click();
    await expect(ask).toBeHidden();
    await exited(listener);
    expect(listener.signalCode).toBe('SIGTERM');
    await expect(row).toBeHidden({ timeout: 10_000 });
  } finally {
    listener.kill('SIGKILL');
  }
});

test('a service of yours is stopped from the phone, after asking', async ({ page, hub }) => {
  const unit = `e2e-sleeper-${process.pid}-${Date.now()}`;
  const started = spawnSync('systemd-run', ['--user', `--unit=${unit}`, '--quiet', 'sleep', '600']);
  test.skip(started.status !== 0, `no user systemd here: ${started.stderr}`);
  try {
    await pair(page, hub);
    await page.getByRole('link', { name: 'System', exact: true }).click();
    await page.getByRole('link', { name: 'Services & timers' }).click();
    await expect(page.getByRole('button', { name: 'Yours', exact: true })).toHaveAttribute('aria-pressed', 'true');
    const row = page.getByRole('button', { name: new RegExp(`^${unit}`) });
    await expect(row).toBeVisible({ timeout: 15_000 });
    await expect(row).toContainText('running');
    await row.click();
    await page.getByRole('button', { name: 'Stop', exact: true }).click();
    const ask = page.getByRole('alertdialog', { name: `Stop ${unit}?` });
    await ask.getByRole('button', { name: 'Stop' }).click();
    await expect(ask).toBeHidden();
    await expect(row).toBeHidden();

    await page.getByRole('button', { name: 'System', exact: true }).click();
    await expect(page.getByRole('button', { name: /^systemd-journald/ })).toBeVisible();
    const state = spawnSync('systemctl', ['--user', 'is-active', `${unit}.service`], { encoding: 'utf8' });
    expect(state.stdout.trim()).not.toBe('active');
  } finally {
    spawnSync('systemctl', ['--user', 'stop', `${unit}.service`]);
  }
});

test('a service of yours that failed waits on Home, and says why it failed', async ({ page, hub }) => {
  const unit = `e2e-fails-${process.pid}-${Date.now()}`;
  const ran = spawnSync('systemd-run', ['--user', `--unit=${unit}`, '--quiet', '--wait', 'sh', '-c', 'echo the backup disk is missing; exit 3']);
  test.skip(ran.status === null || ran.error !== undefined, `no user systemd here: ${ran.stderr}`);
  try {
    await pair(page, hub);
    const waiting = page.getByRole('region', { name: /^Waiting on you/ });
    const item = waiting.getByRole('link', { name: new RegExp(`${unit}\\.service failed`) });
    // The services may have been read just before it failed: then it shows
    // with Home's next refresh, every 10 seconds.
    await expect(item).toBeVisible({ timeout: 20_000 });
    await item.click();

    await expect(page).toHaveURL(new RegExp(`#/system/services/user/${unit}\\.service$`));
    const why = page.getByRole('region', { name: 'Why it failed' });
    await expect(why).toContainText('It ended with an error (exit status 3).');
    await expect(why).toContainText('the backup disk is missing');
    await expect(page.getByRole('status').filter({ hasText: 'Worth fixing' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'What to do' })).toContainText(`systemctl --user restart ${unit}.service`);
  } finally {
    spawnSync('systemctl', ['--user', 'reset-failed', `${unit}.service`]);
  }
});
