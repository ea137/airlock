// One terminal on screen: xterm.js fed by the hub's websocket. Binary frames
// are the terminal's bytes both ways; text frames are control messages
// (resize, ping and pong).

import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';

import { checkSession } from '../../lib/session.svelte';
import { terminalTheme } from './palette';

/** `ended`: the terminal or tab itself closed, so there's nothing to go back to. */
export type LinkStatus = 'connecting' | 'live' | 'lost' | 'ended';

/** No pong this long after a ping means the link is dead. */
export const PROBE_MS = 2500;
/** Waits between reconnect attempts while the page is visible. */
const RETRY_MS = [1000, 2000, 5000];
/** Connects after this long even if the screen never got a size. */
const CONNECT_ANYWAY_MS = 500;
/** The hub's close codes. */
const REPLACED = 4001;
const LOCKED = 4003;
const ENDED = 4004;
/** Drawn with this until the theme's font has loaded. */
const FALLBACK_FONT = 'ui-monospace, Menlo, monospace';

const encoder = new TextEncoder();

function token(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export type LinkOptions = {
  fontSize: number;
  onStatus: (status: LinkStatus) => void;
  /** Typed input, before it is sent: the screen applies Ctrl and Alt here. */
  onInput: (data: string) => void;
  /** The phone's keyboard came up or went away. */
  onKeyboard: (up: boolean) => void;
};

/** The websocket address of what's shown, at a size. */
export type StreamUrl = (cols: number, rows: number) => string;

export class TerminalLink {
  readonly term: Terminal;
  readonly #fit = new FitAddon();
  readonly #url: StreamUrl;
  readonly #options: LinkOptions;
  readonly #resizeObserver: ResizeObserver;
  #socket: WebSocket | null = null;
  #probeTimer: ReturnType<typeof setTimeout> | undefined;
  #retryTimer: ReturnType<typeof setTimeout> | undefined;
  #retries = 0;
  #disposed = false;
  /** The size the person chose; a theme's font may draw it larger. */
  #fontSize: number;
  /** The size the hub last heard, as `colsxrows`, on this socket. */
  #sentSize = '';
  /** Whether the phone's keyboard was asked for and is up. */
  #keyboardUp = false;
  /** Set while the terminal takes focus again on purpose. */
  #refocusing = false;

  constructor(host: HTMLElement, url: StreamUrl, options: LinkOptions) {
    this.#url = url;
    this.#options = options;
    this.#fontSize = options.fontSize;
    this.term = new Terminal({
      fontSize: this.#drawnSize(),
      fontFamily: FALLBACK_FONT,
      cursorBlink: true,
      // tmux keeps the history; this is only what a swipe scrolls through
      // when the program on screen doesn't take the mouse.
      scrollback: 2000,
      theme: terminalTheme(token),
    });
    this.term.loadAddon(this.#fit);
    this.term.open(host);
    this.#hardenTextarea();
    this.restyle();
    this.term.onData((data) => options.onInput(data));
    this.term.onBinary((data) => this.sendBinary(data));
    // Connects once the screen has its size: what comes first (a laptop
    // tab's whole screen) is drawn at the width it will be shown at, and
    // long lines wrap instead of being cut when it narrows.
    let connected = false;
    const start = () => {
      if (connected) return;
      connected = true;
      clearTimeout(fallback);
      this.#connect();
    };
    const fallback = setTimeout(start, CONNECT_ANYWAY_MS);
    this.#resizeObserver = new ResizeObserver(() => {
      this.fit();
      if (host.clientWidth > 0) start();
    });
    this.#resizeObserver.observe(host);
  }

  /** iOS: no autocorrect, capitals or suggestions in the hidden input. */
  #hardenTextarea(): void {
    const textarea = this.term.textarea;
    if (!textarea) return;
    for (const [name, value] of [
      ['autocorrect', 'off'],
      ['autocapitalize', 'none'],
      ['autocomplete', 'off'],
      ['spellcheck', 'false'],
    ] as const) {
      textarea.setAttribute(name, value);
    }
    // The phone's keyboard comes up only when asked for (the key bar's
    // keyboard button), never because the terminal took focus: opening,
    // a tap on the screen, a key from the key bar. A hardware keyboard
    // types in either way.
    textarea.inputMode = 'none';
    textarea.addEventListener('blur', () => {
      if (this.#refocusing || !this.#keyboardUp) return;
      // Put away, or focus went elsewhere: it stays away until asked for.
      this.#keyboardUp = false;
      textarea.inputMode = 'none';
      this.#options.onKeyboard(false);
    });
  }

  /** Brings the phone's keyboard up or puts it away. Up, it must come from
   * a tap's handler: iOS shows it only for focus a person asked for. */
  setKeyboard(up: boolean): void {
    const textarea = this.term.textarea;
    if (!textarea) return;
    this.#keyboardUp = up;
    textarea.inputMode = up ? 'text' : 'none';
    // iOS reads the input mode as the field takes focus.
    this.#refocusing = true;
    textarea.blur();
    this.#refocusing = false;
    this.term.focus();
    this.#options.onKeyboard(up);
  }

  #connect(): void {
    if (this.#disposed) return;
    this.#options.onStatus('connecting');
    const socket = new WebSocket(this.#url(this.term.cols, this.term.rows));
    socket.binaryType = 'arraybuffer';
    socket.onopen = () => {
      this.#retries = 0;
      this.#options.onStatus('live');
      this.#sentSize = '';
      this.#sendSize();
    };
    socket.onmessage = (event: MessageEvent<ArrayBuffer | string>) => {
      if (typeof event.data === 'string') {
        if (event.data.includes('"pong"')) clearTimeout(this.#probeTimer);
        return;
      }
      this.term.write(new Uint8Array(event.data));
    };
    socket.onclose = (event) => {
      if (this.#socket !== socket || this.#disposed) return;
      this.#socket = null;
      if (event.code === ENDED) {
        this.#options.onStatus('ended');
        return;
      }
      this.#options.onStatus('lost');
      // Opened again elsewhere on this device (another tab): retrying would
      // take it back, and the two would trade it forever. The reconnect
      // button takes it back on purpose.
      if (event.code === REPLACED) return;
      // Locked: the session check puts the lock screen up.
      if (event.code === LOCKED) {
        void checkSession();
        return;
      }
      this.#scheduleRetry();
    };
    this.#socket = socket;
  }

  #scheduleRetry(): void {
    clearTimeout(this.#retryTimer);
    if (this.#disposed || document.hidden) return;
    const wait = RETRY_MS[Math.min(this.#retries, RETRY_MS.length - 1)] ?? 5000;
    this.#retries += 1;
    this.#retryTimer = setTimeout(() => this.reconnect(), wait);
  }

  /** Tells the hub the terminal's size, only when it changed: the page
   * settling (the keyboard, the toolbar) at the same size isn't news, and
   * to a laptop tab it would say the phone wants the tab back. */
  #sendSize(): void {
    const size = `${this.term.cols}x${this.term.rows}`;
    if (size === this.#sentSize || this.#socket?.readyState !== WebSocket.OPEN) return;
    this.#sentSize = size;
    this.#sendControl({ type: 'resize', cols: this.term.cols, rows: this.term.rows });
  }

  #sendControl(message: object): void {
    if (this.#socket?.readyState === WebSocket.OPEN) {
      this.#socket.send(JSON.stringify(message));
    }
  }

  /** Sends typed text (already through Ctrl and Alt). */
  send(data: string): void {
    if (this.#socket?.readyState === WebSocket.OPEN) {
      this.#socket.send(encoder.encode(data));
    }
  }

  /** Sends bytes as they are (mouse reports that aren't UTF-8). */
  sendBinary(data: string): void {
    if (this.#socket?.readyState !== WebSocket.OPEN) return;
    const bytes = new Uint8Array(data.length);
    for (let i = 0; i < data.length; i += 1) bytes[i] = data.charCodeAt(i) & 0xff;
    this.#socket.send(bytes);
  }

  fit(): void {
    if (this.#disposed) return;
    this.#fit.fit();
    this.#sendSize();
  }

  get fontSize(): number {
    return this.#fontSize;
  }

  setFontSize(size: number): void {
    this.#fontSize = size;
    this.term.options.fontSize = this.#drawnSize();
    this.fit();
  }

  /** The chosen size, scaled for a theme font that draws small
   * (`--font-terminal-scale`). */
  #drawnSize(): number {
    const scale = Number(token('--font-terminal-scale')) || 1;
    return Math.round(this.#fontSize * scale);
  }

  /**
   * Takes the colours and font from the tokens again, after the theme or
   * its terminal switch changed. xterm measures the font when it's set, so
   * a web font is set only once it has loaded.
   */
  restyle(): void {
    this.term.options.theme = terminalTheme(token);
    this.term.options.fontSize = this.#drawnSize();
    const family = token('--font-terminal') || FALLBACK_FONT;
    const spec = `${this.term.options.fontSize}px ${family}`;
    const apply = () => {
      if (this.#disposed || this.term.options.fontFamily === family) return;
      this.term.options.fontFamily = family;
      this.fit();
    };
    if (document.fonts.check(spec)) {
      apply();
      return;
    }
    document.fonts.load(spec).then(apply, () => {
      // Not loaded: the fallback stays.
    });
  }

  /**
   * Checks the link after the page comes back: iOS can leave a websocket
   * dead while it still looks open. No pong in time means reconnect.
   */
  probe(): void {
    if (this.#socket?.readyState !== WebSocket.OPEN) {
      this.reconnect();
      return;
    }
    this.#sendControl({ type: 'ping' });
    clearTimeout(this.#probeTimer);
    this.#probeTimer = setTimeout(() => this.reconnect(), PROBE_MS);
  }

  /** Starts a fresh stream; the whole screen comes again on attach (tmux
   * redraws it, and the hub sends a laptop tab's). */
  reconnect(): void {
    clearTimeout(this.#probeTimer);
    clearTimeout(this.#retryTimer);
    const old = this.#socket;
    this.#socket = null;
    old?.close();
    this.term.reset();
    this.#connect();
  }

  /** Everything this terminal holds, its scrollback included. */
  allText(): string {
    const buffer = this.term.buffer.active;
    const lines: string[] = [];
    for (let row = 0; row < buffer.length; row += 1) {
      const line = buffer.getLine(row);
      const text = line?.translateToString(true) ?? '';
      // A line the screen wrapped carries on the one before it.
      if (line?.isWrapped && lines.length > 0) lines[lines.length - 1] += text;
      else lines.push(text);
    }
    return lines.join('\n').trimEnd();
  }

  /** Back to the newest lines, as far as this screen scrolled. */
  scrollToBottom(): void {
    this.term.scrollToBottom();
  }

  visibleText(): string {
    const buffer = this.term.buffer.active;
    const lines: string[] = [];
    for (let row = buffer.viewportY; row < buffer.viewportY + this.term.rows; row += 1) {
      lines.push(buffer.getLine(row)?.translateToString(true) ?? '');
    }
    return lines.join('\n').trimEnd();
  }

  dispose(): void {
    this.#disposed = true;
    clearTimeout(this.#probeTimer);
    clearTimeout(this.#retryTimer);
    this.#resizeObserver.disconnect();
    const socket = this.#socket;
    this.#socket = null;
    socket?.close();
    this.term.dispose();
  }
}
