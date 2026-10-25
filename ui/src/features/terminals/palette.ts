// The terminal's colours, from the design tokens (tokens.css, and
// themes.css while the terminal follows the theme).

import type { ITheme } from '@xterm/xterm';

/** xterm's names for the 16 ANSI colours, and the tokens a theme sets them with. */
const ANSI: [keyof ITheme, string][] = [
  ['black', 'black'],
  ['red', 'red'],
  ['green', 'green'],
  ['yellow', 'yellow'],
  ['blue', 'blue'],
  ['magenta', 'magenta'],
  ['cyan', 'cyan'],
  ['white', 'white'],
  ['brightBlack', 'bright-black'],
  ['brightRed', 'bright-red'],
  ['brightGreen', 'bright-green'],
  ['brightYellow', 'bright-yellow'],
  ['brightBlue', 'bright-blue'],
  ['brightMagenta', 'bright-magenta'],
  ['brightCyan', 'bright-cyan'],
  ['brightWhite', 'bright-white'],
];

/**
 * xterm's theme from the tokens `read` returns ('' for unset). An ANSI
 * colour no token sets is left out, so xterm keeps its own.
 */
export function terminalTheme(read: (name: string) => string): ITheme {
  const theme: ITheme = {
    background: read('--c-terminal'),
    foreground: read('--c-terminal-text'),
    cursor: read('--c-terminal-cursor'),
    cursorAccent: read('--c-terminal'),
    selectionBackground: read('--c-terminal-selection'),
  };
  for (const [key, name] of ANSI) {
    const colour = read(`--c-ansi-${name}`);
    if (colour) Object.assign(theme, { [key]: colour });
  }
  return theme;
}
