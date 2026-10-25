// The phone's key bar, and how Ctrl and Alt combine with what you type.

export type Modifier = 'ctrl' | 'alt';
/** Off, on for the next key only, or locked on. */
export type ModState = 'off' | 'once' | 'locked';
export type Mods = Record<Modifier, ModState>;
export type Arrow = 'up' | 'down' | 'left' | 'right';
export type Action = 'paste' | 'copy' | 'font-smaller' | 'font-larger' | 'go-to';

export type Key =
  | { label: string; send: string }
  | { label: string; modifier: Modifier }
  | { label: string; arrow: Arrow }
  | { label: string; action: Action };

export const NO_MODS: Mods = { ctrl: 'off', alt: 'off' };

/** A second tap within this many milliseconds locks a modifier. */
export const DOUBLE_TAP_MS = 350;

export const KEYS: Key[] = [
  { label: 'Esc', send: '\x1b' },
  { label: 'Tab', send: '\t' },
  { label: 'Ctrl', modifier: 'ctrl' },
  { label: 'Alt', modifier: 'alt' },
  { label: '←', arrow: 'left' },
  { label: '↓', arrow: 'down' },
  { label: '↑', arrow: 'up' },
  { label: '→', arrow: 'right' },
  { label: '|', send: '|' },
  { label: '~', send: '~' },
  { label: '/', send: '/' },
  { label: '-', send: '-' },
  { label: '^C', send: '\x03' },
];

export const COMMANDS: Key[] = [
  { label: 'Paste', action: 'paste' },
  { label: 'Copy', action: 'copy' },
  { label: 'PgUp', send: '\x1b[5~' },
  { label: 'PgDn', send: '\x1b[6~' },
  { label: 'Home', send: '\x1b[H' },
  { label: 'End', send: '\x1b[F' },
  { label: 'A−', action: 'font-smaller' },
  { label: 'A+', action: 'font-larger' },
  // Your project folders come from the laptop, not from this file.
  { label: 'Go to…', action: 'go-to' },
];

/** A `cd` into `path`, quoted for the shell whatever the folder is called. */
export function cdInto(path: string): string {
  return `cd '${path.replace(/'/g, "'\\''")}'\r`;
}

const isOn = (state: ModState) => state !== 'off';

/** A tap turns a modifier on for one key, or off again; a double tap locks it. */
export function tapModifier(mods: Mods, which: Modifier, double: boolean): Mods {
  const next: ModState = double ? 'locked' : mods[which] === 'off' ? 'once' : 'off';
  return { ...mods, [which]: next };
}

/** Drops the one-key modifiers once a key has used them. */
function consume(mods: Mods): Mods {
  return {
    ctrl: mods.ctrl === 'once' ? 'off' : mods.ctrl,
    alt: mods.alt === 'once' ? 'off' : mods.alt,
  };
}

/**
 * Applies Ctrl and Alt to typed data. Only a single character combines;
 * anything longer (a paste, a sequence) passes through untouched.
 */
export function applyModifiers(data: string, mods: Mods): { data: string; mods: Mods } {
  if (data.length !== 1 || (!isOn(mods.ctrl) && !isOn(mods.alt))) {
    return { data, mods };
  }
  let out = data;
  if (isOn(mods.ctrl) && /[a-z@[\\\]^_ ?]/i.test(data)) {
    out = data === '?' ? '\x7f' : String.fromCharCode(data.toUpperCase().charCodeAt(0) & 31);
  }
  if (isOn(mods.alt)) {
    out = `\x1b${out}`;
  }
  return { data: out, mods: consume(mods) };
}

/**
 * The bytes an arrow sends: the xterm modifier form with Ctrl or Alt,
 * otherwise normal or application cursor mode, as the program asked.
 */
export function arrowSequence(arrow: Arrow, mods: Mods, applicationCursor: boolean): { data: string; mods: Mods } {
  const letter = { up: 'A', down: 'B', right: 'C', left: 'D' }[arrow];
  const ctrl = isOn(mods.ctrl);
  const alt = isOn(mods.alt);
  if (ctrl || alt) {
    return { data: `\x1b[1;${1 + (alt ? 2 : 0) + (ctrl ? 4 : 0)}${letter}`, mods: consume(mods) };
  }
  return { data: `${applicationCursor ? '\x1bO' : '\x1b['}${letter}`, mods };
}
