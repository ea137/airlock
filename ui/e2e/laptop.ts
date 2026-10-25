// The laptop app's window, in WebKit (the engine Tauri uses on Linux), wired
// to a real hub. Only Tauri's own glue is stood in for: each command goes to
// the hub's admin socket as app/src/main.rs sends it, and the hub's event
// stream arrives as the app passes it on (`hub-event`, `hub-link`).

import { readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, request as httpRequest, type Server } from 'node:http';
import { extname, join, resolve } from 'node:path';

import type { Browser, Page } from '@playwright/test';

import type { Hub } from './hub';

const DIST = resolve(import.meta.dirname, '../dist-laptop');
const TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};

/** Serves the built laptop UI (`npm run build`) on a loopback port. */
async function serveLaptopUi(): Promise<{ server: Server; url: string }> {
  const server = createServer(async (req, res) => {
    const path = new URL(req.url ?? '/', 'http://localhost').pathname;
    const file = join(DIST, path === '/' ? 'laptop.html' : path);
    if (!file.startsWith(DIST)) {
      res.writeHead(403).end();
      return;
    }
    try {
      const body = await readFile(file);
      res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' }).end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  return { server, url: `http://127.0.0.1:${port}/laptop.html` };
}

type Failure = { kind: 'hub_down' | 'refused' | 'broken'; message: string };
type Answer = { ok: true; value: unknown } | { ok: false; failure: Failure };

/** One admin socket request, answered as the app's commands answer. */
function admin(socket: string, method: string, path: string, body?: unknown): Promise<Answer> {
  return new Promise((done) => {
    const headers: Record<string, string> = { host: 'airlock' };
    if (body !== undefined) headers['content-type'] = 'application/json';
    const req = httpRequest({ socketPath: socket, method, path, headers }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => (body += chunk));
      res.on('end', () => {
        const parsed: unknown = body ? JSON.parse(body) : null;
        if ((res.statusCode ?? 500) < 300) {
          done({ ok: true, value: parsed });
          return;
        }
        const reason =
          parsed && typeof parsed === 'object' && 'error' in parsed && typeof parsed.error === 'string'
            ? parsed.error
            : `the hub answered ${res.statusCode}`;
        done({ ok: false, failure: { kind: 'refused', message: reason } });
      });
    });
    req.on('error', (error: NodeJS.ErrnoException) => {
      const down = error.code === 'ENOENT' || error.code === 'ECONNREFUSED';
      done({
        ok: false,
        failure: down
          ? { kind: 'hub_down', message: "the hub isn't running; start it with `airlock serve`" }
          : { kind: 'broken', message: `talking to the hub failed: ${error.message}` },
      });
    });
    req.end(body === undefined ? undefined : JSON.stringify(body));
  });
}

/** The app's commands (app/src/main.rs), as admin socket requests. */
function command(socket: string, name: string, args: Record<string, unknown>): Promise<Answer> {
  const id = encodeURIComponent(String(args.id ?? ''));
  const key = encodeURIComponent(String(args.key ?? ''));
  switch (name) {
    case 'pairings':
      return admin(socket, 'GET', '/pairings');
    case 'approve':
      return admin(socket, 'POST', `/pairings/${id}/approve`);
    case 'deny':
      return admin(socket, 'POST', `/pairings/${id}/deny`);
    case 'devices':
      return admin(socket, 'GET', '/devices');
    case 'revoke':
      return admin(socket, 'POST', `/devices/${id}/revoke`);
    case 'activity':
      return admin(socket, 'GET', '/audit');
    case 'changes':
      return admin(socket, 'GET', '/changes');
    case 'change':
      return admin(socket, 'GET', `/changes/${id}`);
    case 'apply_change':
      return admin(socket, 'POST', `/changes/${id}/apply`, { use: args.with, overwrite: args.overwrite });
    case 'decline_change':
      return admin(socket, 'POST', `/changes/${id}/decline`);
    case 'settings':
      return admin(socket, 'GET', '/settings');
    case 'save_settings':
      return admin(socket, 'PUT', '/settings', args.settings);
    case 'terminals':
      return admin(socket, 'GET', '/terminals');
    case 'sessions':
      return admin(socket, 'GET', '/sessions');
    case 'session':
      return admin(socket, 'GET', `/sessions/${id}`);
    case 'history':
      return admin(socket, 'GET', '/history');
    case 'terminal_record':
      return admin(socket, 'GET', `/history/terminals/${key}`);
    case 'delete_terminal_record':
      return admin(socket, 'DELETE', `/history/terminals/${key}`);
    case 'session_record':
      return admin(socket, 'GET', `/history/sessions/${id}`);
    case 'delete_session_record':
      return admin(socket, 'DELETE', `/history/sessions/${id}`);
    default:
      // The capability file grants nothing else.
      return Promise.resolve({ ok: false, failure: { kind: 'broken', message: `${name} not allowed` } });
  }
}

function tauriStandIn(): void {
  type Listener = { event: string; eventId: number; handler: number };
  const callbacks = new Map<number, (payload: unknown) => void>();
  let listeners: Listener[] = [];
  let next = 1;
  const page = window as unknown as {
    airlockCommand: (name: string, args: unknown) => Promise<{ ok: boolean; value?: unknown; failure?: unknown }>;
    airlockEmit: (event: string, payload: unknown) => void;
    __TAURI_INTERNALS__: unknown;
    __TAURI_EVENT_PLUGIN_INTERNALS__: unknown;
  };
  page.__TAURI_INTERNALS__ = {
    transformCallback(callback: (payload: unknown) => void, once: boolean) {
      const id = next++;
      callbacks.set(id, (payload) => {
        if (once) callbacks.delete(id);
        callback(payload);
      });
      return id;
    },
    unregisterCallback(id: number) {
      callbacks.delete(id);
    },
    async invoke(name: string, args: Record<string, unknown> = {}) {
      if (name === 'plugin:event|listen') {
        const eventId = next++;
        listeners.push({ event: String(args.event), eventId, handler: Number(args.handler) });
        return eventId;
      }
      if (name === 'plugin:event|unlisten') {
        listeners = listeners.filter((known) => known.eventId !== args.eventId);
        return null;
      }
      const answer = await page.airlockCommand(name, args);
      if (!answer.ok) throw answer.failure;
      return answer.value;
    },
  };
  page.__TAURI_EVENT_PLUGIN_INTERNALS__ = {
    unregisterListener(event: string, eventId: number) {
      listeners = listeners.filter((known) => !(known.event === event && known.eventId === eventId));
    },
  };
  page.airlockEmit = (event, payload) => {
    for (const known of listeners.filter((listener) => listener.event === event)) {
      callbacks.get(known.handler)?.({ event, id: known.eventId, payload });
    }
  };
}

export class Laptop {
  readonly page: Page;
  readonly #server: Server;
  readonly #socket: string;
  #following: IncomingMessage | null = null;
  #closed = false;

  private constructor(page: Page, server: Server, socket: string) {
    this.page = page;
    this.#server = server;
    this.#socket = socket;
  }

  static async open(browser: Browser, hub: Hub): Promise<Laptop> {
    const { server, url } = await serveLaptopUi();
    const context = await browser.newContext({ viewport: { width: 760, height: 900 } });
    const page = await context.newPage();
    const laptop = new Laptop(page, server, hub.adminSocket);
    await page.exposeFunction('airlockCommand', (name: string, args: Record<string, unknown>) =>
      command(hub.adminSocket, name, args ?? {}),
    );
    await page.addInitScript(tauriStandIn);
    await page.goto(url);
    laptop.#follow();
    return laptop;
  }

  async emit(event: string, payload: unknown): Promise<void> {
    await this.page.evaluate(([name, body]) => {
      (window as unknown as { airlockEmit: (event: string, payload: unknown) => void }).airlockEmit(name, body);
    }, [event, payload] as const);
  }

  #follow(): void {
    const req = httpRequest({ socketPath: this.#socket, path: '/events', headers: { host: 'airlock' } }, (res) => {
      if (res.statusCode !== 200) {
        throw new Error(`The hub refused its event stream (${res.statusCode}); is target/debug/airlock current?`);
      }
      this.#following = res;
      void this.emit('hub-link', 'up').catch(() => {});
      let buffer = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => {
        buffer += chunk;
        let end = buffer.indexOf('\n');
        while (end >= 0) {
          const line = buffer.slice(0, end);
          buffer = buffer.slice(end + 1);
          if (line) void this.emit('hub-event', JSON.parse(line)).catch(() => {});
          end = buffer.indexOf('\n');
        }
      });
      res.on('end', () => {
        if (!this.#closed) void this.emit('hub-link', 'down').catch(() => {});
      });
    });
    req.on('error', () => {});
    req.end();
  }

  async close(): Promise<void> {
    this.#closed = true;
    this.#following?.destroy();
    await this.page.context().close();
    await new Promise((done) => this.#server.close(done));
  }
}
