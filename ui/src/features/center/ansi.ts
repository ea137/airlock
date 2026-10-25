// A terminal's screen as tmux captures it (text with colour escapes), turned
// into runs of styled text for a read-only view. Only colour and weight
// escapes (SGR) matter here; anything else is dropped.

export type Style = {
  fg: string | null;
  bg: string | null;
  bold: boolean;
  dim: boolean;
  italic: boolean;
  underline: boolean;
};

export type Run = { text: string; style: Style };

export const PLAIN: Style = { fg: null, bg: null, bold: false, dim: false, italic: false, underline: false };

/** The 16 basic colours, as CSS custom properties the theme can set. */
const BASIC = [
  'black',
  'red',
  'green',
  'yellow',
  'blue',
  'magenta',
  'cyan',
  'white',
  'bright-black',
  'bright-red',
  'bright-green',
  'bright-yellow',
  'bright-blue',
  'bright-magenta',
  'bright-cyan',
  'bright-white',
];
/** What the basic colours look like when the theme sets none (xterm's). */
const FALLBACK = [
  '#2e3436',
  '#cd3131',
  '#0dbc79',
  '#e5e510',
  '#2472c8',
  '#bc3fbc',
  '#11a8cd',
  '#e5e5e5',
  '#666666',
  '#f14c4c',
  '#23d18b',
  '#f5f543',
  '#3b8eea',
  '#d670d6',
  '#29b8db',
  '#ffffff',
];

function basic(index: number): string {
  return `var(--c-ansi-${BASIC[index]}, ${FALLBACK[index]})`;
}

function indexed(index: number): string {
  if (index < 16) return basic(index);
  if (index >= 232) {
    const level = 8 + (index - 232) * 10;
    return `rgb(${level} ${level} ${level})`;
  }
  const cube = index - 16;
  const level = (step: number) => (step === 0 ? 0 : 55 + step * 40);
  return `rgb(${level(Math.floor(cube / 36))} ${level(Math.floor(cube / 6) % 6)} ${level(cube % 6)})`;
}

/** The style after one SGR escape's numbers. */
export function applySgr(style: Style, codes: number[]): Style {
  let next = { ...style };
  for (let i = 0; i < codes.length; i += 1) {
    const code = codes[i] ?? 0;
    if (code === 0) next = { ...PLAIN };
    else if (code === 1) next.bold = true;
    else if (code === 2) next.dim = true;
    else if (code === 3) next.italic = true;
    else if (code === 4) next.underline = true;
    else if (code === 22) next = { ...next, bold: false, dim: false };
    else if (code === 23) next.italic = false;
    else if (code === 24) next.underline = false;
    else if (code >= 30 && code <= 37) next.fg = basic(code - 30);
    else if (code >= 90 && code <= 97) next.fg = basic(code - 90 + 8);
    else if (code >= 40 && code <= 47) next.bg = basic(code - 40);
    else if (code >= 100 && code <= 107) next.bg = basic(code - 100 + 8);
    else if (code === 39) next.fg = null;
    else if (code === 49) next.bg = null;
    else if (code === 38 || code === 48) {
      const mode = codes[i + 1];
      let colour: string | null = null;
      if (mode === 5) {
        colour = indexed(codes[i + 2] ?? 0);
        i += 2;
      } else if (mode === 2) {
        colour = `rgb(${codes[i + 2] ?? 0} ${codes[i + 3] ?? 0} ${codes[i + 4] ?? 0})`;
        i += 4;
      }
      if (code === 38) next.fg = colour;
      else next.bg = colour;
    }
  }
  return next;
}

const same = (a: Style, b: Style) =>
  a.fg === b.fg && a.bg === b.bg && a.bold === b.bold && a.dim === b.dim && a.italic === b.italic && a.underline === b.underline;

export function parseAnsi(text: string): Run[] {
  const runs: Run[] = [];
  let style = { ...PLAIN };
  const add = (piece: string) => {
    if (!piece) return;
    const last = runs.at(-1);
    if (last && same(last.style, style)) last.text += piece;
    else runs.push({ text: piece, style });
  };
  // ESC [ … letter: colours when the letter is m, anything else is dropped.
  const escape = /\x1b\[([0-9;:?<>=]*)([A-Za-z])|\x1b[()][A-Z0-9]|\x1b[=>]/g;
  let at = 0;
  for (const match of text.matchAll(escape)) {
    add(text.slice(at, match.index));
    if (match[2] === 'm' && !match[1]?.match(/[?<>=]/)) {
      const codes = (match[1] || '0').split(/[;:]/).map((part) => Number(part || 0));
      style = applySgr(style, codes);
    }
    at = (match.index ?? 0) + match[0].length;
  }
  add(text.slice(at));
  return runs;
}

export function css(style: Style): string {
  const parts: string[] = [];
  if (style.fg) parts.push(`color:${style.fg}`);
  if (style.bg) parts.push(`background:${style.bg}`);
  if (style.bold) parts.push('font-weight:700');
  if (style.dim) parts.push('opacity:0.7');
  if (style.italic) parts.push('font-style:italic');
  if (style.underline) parts.push('text-decoration:underline');
  return parts.join(';');
}
