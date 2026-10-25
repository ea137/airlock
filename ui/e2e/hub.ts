// A real hub for one test, behind an HTTPS front that does what Tailscale
// Serve does: terminates TLS and adds the Tailscale-User-Login header (and a
// plain one on localhost, for passkeys). Each hub gets its own config, state,
// admin socket and tmux server, all removed afterwards.

import { type ChildProcess, spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import {
  createServer as createHttpServer,
  type Server as HttpServer,
  request as httpRequest,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import { createServer as createHttpsServer, type Server } from 'node:https';
import { connect, createServer } from 'node:net';
import type { Duplex } from 'node:stream';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { test as base } from '@playwright/test';

export const LOGIN = 'e2e@example.com';
const BINARY = resolve(import.meta.dirname, '../../target/debug/airlock');

async function freePort(): Promise<number> {
  return new Promise((done, fail) => {
    const server = createServer();
    server.once('error', fail);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => done(port));
    });
  });
}

function makeRepo(path: string): void {
  mkdirSync(path, { recursive: true });
  const git = (...args: string[]) => {
    const run = spawnSync(
      'git',
      ['-C', path, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', '-c', 'init.defaultBranch=main', ...args],
      { encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' } },
    );
    if (run.status !== 0) throw new Error(`git ${args.join(' ')}: ${run.stderr}`);
  };
  git('init', '-q');
  writeFileSync(join(path, 'README.md'), '# demo\n');
  git('add', '.');
  git('commit', '-q', '-m', 'First');
}

/** Passes requests and websockets to the hub, adding the identity header as
 * Tailscale Serve would. */
function proxyTo(server: HttpServer | Server, hubPort: number): void {
  server.on('request', (req: IncomingMessage, res: ServerResponse) => {
    const upstream = httpRequest(
      {
        host: '127.0.0.1',
        port: hubPort,
        method: req.method,
        path: req.url,
        headers: { ...req.headers, 'tailscale-user-login': LOGIN },
      },
      (answer) => {
        res.writeHead(answer.statusCode ?? 502, answer.headers);
        answer.pipe(res);
      },
    );
    upstream.on('error', () => res.writeHead(502).end());
    req.pipe(upstream);
  });
  server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const upstream = connect(hubPort, '127.0.0.1', () => {
      const lines = [`${req.method} ${req.url} HTTP/1.1`, `tailscale-user-login: ${LOGIN}`];
      for (let i = 0; i < req.rawHeaders.length; i += 2) {
        if (req.rawHeaders[i]?.toLowerCase() !== 'tailscale-user-login') {
          lines.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`);
        }
      }
      upstream.write(`${lines.join('\r\n')}\r\n\r\n`);
      upstream.write(head);
      upstream.once('data', (answer: Buffer) => {
        socket.write(answer);
        // Refused (a 404 for a terminal that closed): no websocket follows,
        // and the browser mustn't reuse this connection for requests that
        // would then skip the identity header. Tailscale Serve proxies each
        // request on its own.
        if (!answer.subarray(0, 12).toString().startsWith('HTTP/1.1 101')) {
          socket.end();
          upstream.end();
          return;
        }
        socket.pipe(upstream).pipe(socket);
      });
    });
    upstream.on('error', () => socket.destroy());
    socket.on('error', () => upstream.destroy());
  });
}

/** The phone's way in: HTTPS, with a throwaway self-signed certificate. */
function serveFront(dir: string, port: number, hubPort: number): Promise<Server> {
  mkdirSync(dir, { recursive: true });
  const key = join(dir, 'key.pem');
  const cert = join(dir, 'cert.pem');
  const made = spawnSync('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
    '-subj', '/CN=127.0.0.1', '-keyout', key, '-out', cert,
  ]);
  if (made.status !== 0) {
    throw new Error(`openssl couldn't make a test certificate: ${made.stderr.toString()}`);
  }
  const server = createHttpsServer({ key: readFileSync(key), cert: readFileSync(cert) });
  proxyTo(server, hubPort);
  return new Promise((done) => server.listen(port, '127.0.0.1', () => done(server)));
}

/** A second way in, plain HTTP on `localhost`: a secure context with a host
 * name, which passkeys need (they refuse IP addresses and bad certificates). */
function serveLocalFront(port: number, hubPort: number): Promise<HttpServer> {
  const server = createHttpServer();
  proxyTo(server, hubPort);
  return new Promise((done) => server.listen(port, '127.0.0.1', () => done(server)));
}

/** A Face ID device locks after this many quiet seconds in the tests. */
export const FACE_ID_LOCK_SECS = 2;

export class Hub {
  /** Where the phone goes: the HTTPS front. */
  readonly url: string;
  /** The same front over plain HTTP on `localhost`, for passkeys. */
  readonly localUrl: string;
  /** The hub itself, plain HTTP and without the identity header. */
  readonly directUrl: string;
  readonly #port: number;
  readonly #localPort: number;
  readonly #hubPort: number;
  readonly #previewPort: number;
  readonly #previewFrontPort: number;
  readonly #env: NodeJS.ProcessEnv;
  readonly #dir: string;
  readonly #runtime: string;
  readonly #tmuxSocket: string;
  #process: ChildProcess | null = null;
  #fronts: (Server | HttpServer)[] = [];
  /** The tmux server holding the test's stand-in laptop tabs, once opened. */
  #laptopTabs: string | null = null;

  /** The hub's projects folder, holding one git repo: `demo`. */
  readonly projects: string;

  constructor(ports: { front: number; local: number; hub: number; preview: number; previewFront: number }) {
    const { front: port, local: localPort, hub: hubPort } = ports;
    const name = `airlock-e2e-${process.pid}-${hubPort}`;
    this.#port = port;
    this.#localPort = localPort;
    this.#hubPort = hubPort;
    this.#previewPort = ports.preview;
    this.#previewFrontPort = ports.previewFront;
    this.url = `https://127.0.0.1:${port}`;
    this.localUrl = `http://localhost:${localPort}`;
    this.directUrl = `http://127.0.0.1:${hubPort}`;
    this.#dir = mkdtempSync(join(tmpdir(), 'airlock-e2e-'));
    // Unix socket paths are short; the runtime dir goes where they fit.
    this.#runtime = join(process.env.XDG_RUNTIME_DIR ?? tmpdir(), name);
    this.#tmuxSocket = name;
    // Apart from the hub's own folders, which the phone never sees.
    this.projects = mkdtempSync(join(tmpdir(), 'airlock-e2e-projects-'));
    makeRepo(join(this.projects, 'demo'));
    writeFileSync(
      join(this.#dir, 'config.toml'),
      [
        `listen = "127.0.0.1:${hubPort}"`,
        `allowed_logins = ["${LOGIN}"]`,
        `tmux_socket = "${name}"`,
        `projects_dir = "${this.projects}"`,
        // The phone's files are this test's projects folder, never your home.
        `files_root = "${this.projects}"`,
        `face_id_lock_secs = ${FACE_ID_LOCK_SECS}`,
        // Previews: the hub's second listener, behind its own HTTPS front,
        // as Tailscale Serve publishes it on 8443.
        `preview_listen = "127.0.0.1:${ports.preview}"`,
        `preview_port = ${ports.previewFront}`,
        // A resumed session starts the stand-in below, never Claude Code.
        `claude_command = "${join(this.#dir, 'bin', 'claude')}"`,
        '',
      ].join('\n'),
    );
    // A stand-in for Claude Code (`claude_command` above), so a test that
    // resumes a session never starts the real one. With AIRLOCK_HOOK_EVENT
    // set, it reports that event through `airlock hook` as Claude Code
    // would, then stays open like a session in a terminal Airlock can't
    // reach.
    const bin = join(this.#dir, 'bin');
    mkdirSync(bin);
    writeFileSync(
      join(bin, 'claude'),
      [
        '#!/bin/sh',
        // Asked from the phone (`claude -p`): it answers only when started
        // with Ask Claude's safety settings, says what it checked, and
        // answers with the model it was given and the first line of what
        // the question is about.
        'if [ "$1" = "-p" ]; then',
        '  case " $* " in *" --restricted "*"--no-session-persistence "*"--permission-mode dontAsk "*) ;;',
        `    *) echo '{"type":"result","subtype":"error_unsafe","is_error":true,"result":"not started safely"}'; exit 0 ;;`,
        '  esac',
        '  model=; previous=',
        '  for arg in "$@"; do [ "$previous" = "--model" ] && model=$arg; previous=$arg; done',
        `  about=$(printf %s "$2" | sed -n '2p' | tr -d '"\\\\')`,
        `  echo '{"type":"system","subtype":"init"}'`,
        `  echo '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Bash","input":{"command":"systemctl status vboxdrv"}}]}}'`,
        `  printf '{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"**Safe to ignore.** "}}}\\n'`,
        `  printf '{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"About: %s (model %s)"}}}\\n' "$about" "$model"`,
        `  echo '{"type":"result","subtype":"success","is_error":false,"result":"ok"}'`,
        '  exit 0',
        'fi',
        'if [ -n "$AIRLOCK_HOOK_EVENT" ]; then',
        '  printf %s "$AIRLOCK_HOOK_EVENT" | "$AIRLOCK_BINARY" hook',
        // With AIRLOCK_PROMPT_KEYS, it shows Claude's permission prompt and
        // records the keys it gets there.
        '  if [ -n "$AIRLOCK_PROMPT_KEYS" ]; then',
        '    stty -icanon min 1 time 0 -echo',
        "    printf 'Bash command\\n\\n  pnpm test\\n\\nDo you want to proceed?\\n'",
        "    printf '\\342\\235\\257 1. Yes\\n'",
        '    printf "  2. Yes, and don\'t ask again for: pnpm test\\n"',
        "    printf '  3. No\\n'",
        '    timeout --foreground 20 cat > "$AIRLOCK_PROMPT_KEYS"',
        '    exit',
        '  fi',
        // With AIRLOCK_BACKGROUND, it leaves that command running in the
        // background, in a shell as Claude Code starts one.
        '  if [ -n "$AIRLOCK_BACKGROUND" ]; then',
        `    bash -c "source ${this.#dir}/shell-snapshots/snapshot-bash-1.sh 2>/dev/null || true && eval '$AIRLOCK_BACKGROUND' \\\\< /dev/null" &`,
        '  fi',
        // Asked to quit, it does, and takes its sleep with it.
        '  sleep 600 &',
        "  trap 'kill $! 2>/dev/null; exit 143' TERM",
        '  wait',
        'else',
        '  echo "claude (stand-in) $*"',
        'fi',
        '',
      ].join('\n'),
      { mode: 0o755 },
    );
    this.#env = {
      ...process.env,
      AIRLOCK_BINARY: BINARY,
      AIRLOCK_CONFIG_DIR: this.#dir,
      AIRLOCK_STATE_DIR: join(this.#dir, 'state'),
      AIRLOCK_RUNTIME_DIR: this.#runtime,
      // Claude Code's own folder (transcripts), this test's, never yours.
      CLAUDE_CONFIG_DIR: this.claudeDir,
      // The shell history of this test's terminals: what they run never
      // goes into yours, and ↑ in one never brings back one of your commands.
      HISTFILE: join(this.#dir, 'bash_history'),
      RUST_LOG: 'warn',
    };
  }

  get standInClaude(): string {
    return join(this.#dir, 'bin', 'claude');
  }

  /** Where this hub looks for Claude Code's transcripts. */
  get claudeDir(): string {
    return join(this.#dir, 'claude');
  }

  /** Writes a session's transcript, one JSON entry a line, as Claude Code keeps it. */
  transcript(session: string, entries: unknown[]): void {
    const folder = join(this.claudeDir, 'projects', '-e2e');
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, `${session}.jsonl`), entries.map((entry) => JSON.stringify(entry)).join('\n'));
  }

  async start(): Promise<void> {
    this.#process = spawn(BINARY, ['serve'], { env: this.#env, stdio: ['ignore', 'inherit', 'inherit'] });
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const up = await fetch(`${this.directUrl}/api/session`).then(
        () => true,
        () => false,
      );
      if (up) {
        this.#fronts = [
          await serveFront(join(this.#dir, 'front'), this.#port, this.#hubPort),
          await serveLocalFront(this.#localPort, this.#hubPort),
          await serveFront(join(this.#dir, 'preview-front'), this.#previewFrontPort, this.#previewPort),
        ];
        return;
      }
      await new Promise((wait) => setTimeout(wait, 100));
    }
    throw new Error(`The hub at ${this.directUrl} didn't start within 10 seconds (binary: ${BINARY}).`);
  }

  tmux(...args: string[]): string {
    const run = spawnSync('tmux', ['-L', this.#tmuxSocket, ...args], { encoding: 'utf8' });
    if (run.status !== 0) {
      throw new Error(`tmux ${args.join(' ')} failed (${run.status}): ${run.stderr}`);
    }
    return run.stdout.trim();
  }

  /**
   * Reports a Claude Code hook event through `airlock hook`, as a session
   * running in `pane` (like `%0`) on the hub's tmux would.
   */
  hook(event: Record<string, unknown>, pane: string): void {
    // Where tmux puts the server's socket, running or not.
    const socket = join(process.env.TMUX_TMPDIR ?? '/tmp', `tmux-${process.getuid?.() ?? 0}`, this.#tmuxSocket);
    const run = spawnSync(BINARY, ['hook'], {
      env: { ...this.#env, TMUX: `${socket},1,0`, TMUX_PANE: pane },
      input: JSON.stringify(event),
      encoding: 'utf8',
    });
    if (run.status !== 0 || run.stdout !== '') {
      throw new Error(`airlock hook must print nothing and succeed; got ${run.status}: ${run.stdout}${run.stderr}`);
    }
  }

  /** Feeds `airlock statusline` what Claude Code's status line would; returns the line it prints. */
  statusLine(input: Record<string, unknown>): string {
    const run = spawnSync(BINARY, ['statusline'], { env: this.#env, input: JSON.stringify(input), encoding: 'utf8' });
    if (run.status !== 0) throw new Error(`airlock statusline failed: ${run.stderr}`);
    return run.stdout.trim();
  }

  /**
   * Starts a stand-in Claude Code that reports `event` through its hooks
   * and stays open, outside tmux: a session in another terminal app. Kill
   * the process it returns when the test is done with it.
   */
  claudeElsewhere(event: Record<string, unknown>, background?: string): ChildProcess {
    return spawn(join(this.#dir, 'bin', 'claude'), [], {
      env: {
        ...this.#env,
        TMUX: undefined,
        TMUX_PANE: undefined,
        AIRLOCK_HOOK_EVENT: JSON.stringify(event),
        AIRLOCK_BACKGROUND: background,
      },
      stdio: 'ignore',
      // Its own group, so a test can end it and what it left running.
      detached: true,
    });
  }

  /**
   * Opens a stand-in for a GNOME Terminal tab, `cols` wide: a pane on a tmux
   * server of the test's own, running `airlock tab` with a plain bash. The
   * laptop's side of it is read and typed through the pane.
   */
  laptopTab(cols = 100): { screen: () => string; type: (keys: string) => void; holder: () => string } {
    const outer = `${this.#tmuxSocket}-laptop`;
    this.#laptopTabs = outer;
    const shell = join(this.#dir, 'bin', 'plain-bash');
    writeFileSync(shell, "#!/bin/sh\nPS1='tab$ ' exec /bin/bash --norc --noprofile -i\n", { mode: 0o755 });
    const run = spawnSync(
      'tmux',
      ['-L', outer, '-f', '/dev/null', 'new-session', '-d', '-x', String(cols), '-y', '20', BINARY, 'tab'],
      { env: { ...this.#env, SHELL: shell, TMUX: undefined }, encoding: 'utf8' },
    );
    if (run.status !== 0) throw new Error(`couldn't open the laptop tab: ${run.stderr}`);
    const tmux = (...args: string[]) =>
      spawnSync('tmux', ['-L', outer, ...args], { encoding: 'utf8' }).stdout.trimEnd();
    return {
      screen: () => tmux('capture-pane', '-p', '-J'),
      type: (keys) => void tmux('send-keys', '-l', keys),
      // Who holds the tab's keyboard (its foreground process), which is what
      // a terminal app looks at before closing a tab.
      holder: () => tmux('display-message', '-p', '#{pane_current_command}'),
    };
  }

  get adminSocket(): string {
    return join(this.#runtime, 'admin.sock');
  }

  /** Stops the hub process only, as if it crashed or was stopped. */
  async kill(): Promise<void> {
    const hub = this.#process;
    if (!hub || hub.exitCode !== null) return;
    const exited = new Promise((done) => hub.once('exit', done));
    hub.kill('SIGTERM');
    await exited;
  }

  airlock(...args: string[]): string {
    const run = spawnSync(BINARY, args, { env: this.#env, encoding: 'utf8' });
    if (run.status !== 0) {
      throw new Error(`airlock ${args.join(' ')} failed (${run.status}): ${run.stderr}`);
    }
    return run.stdout;
  }

  stop(): void {
    for (const front of this.#fronts) {
      front.closeAllConnections();
      front.close();
    }
    this.#process?.kill('SIGTERM');
    spawnSync('tmux', ['-L', this.#tmuxSocket, 'kill-server']);
    if (this.#laptopTabs) spawnSync('tmux', ['-L', this.#laptopTabs, 'kill-server']);
    rmSync(join(tmpdir(), `tmux-${process.getuid?.() ?? 0}`, this.#tmuxSocket), { force: true });
    // The shells tmux just closed may still be writing their history here.
    rmSync(this.#dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    rmSync(this.projects, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    rmSync(this.#runtime, { recursive: true, force: true });
  }
}

export const test = base.extend<{ hub: Hub }>({
  // Automatic, so it starts before the page and stops after it: a failing
  // test's page snapshot is taken while the hub is still up.
  hub: [
    async ({}, use) => {
      const hub = new Hub({
        front: await freePort(),
        local: await freePort(),
        hub: await freePort(),
        preview: await freePort(),
        previewFront: await freePort(),
      });
      await hub.start();
      await use(hub);
      hub.stop();
    },
    { auto: true },
  ],
  // The game starts muted, unless a test set it otherwise: a hidden browser
  // still plays sound, and its music would play on the laptop.
  page: async ({ page }, use) => {
    await page.addInitScript(() => {
      try {
        if (localStorage.getItem('airlock.game.settings') === null) {
          localStorage.setItem('airlock.game.settings', JSON.stringify({ muted: true }));
        }
      } catch {
        // No storage: the game plays with sound, as it would anyway.
      }
    });
    await use(page);
  },
});

export { expect } from '@playwright/test';
