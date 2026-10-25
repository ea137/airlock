import { describe, expect, it } from 'vitest';

import { terminalTheme } from './palette';

describe('terminalTheme', () => {
  const plain: Record<string, string> = {
    '--c-terminal': '#000000',
    '--c-terminal-text': '#e6e8ec',
    '--c-terminal-cursor': '#e6e8ec',
    '--c-terminal-selection': 'rgb(157 182 255 / 0.35)',
  };

  it("keeps xterm's ANSI colours when no token sets them", () => {
    const theme = terminalTheme((name) => plain[name] ?? '');
    expect(theme).toEqual({
      background: '#000000',
      foreground: '#e6e8ec',
      cursor: '#e6e8ec',
      cursorAccent: '#000000',
      selectionBackground: 'rgb(157 182 255 / 0.35)',
    });
  });

  it("takes a theme's ANSI colours by their xterm names", () => {
    const tokens: Record<string, string> = { ...plain, '--c-ansi-red': '#ff2e4d', '--c-ansi-bright-cyan': '#7df0f2' };
    const theme = terminalTheme((name) => tokens[name] ?? '');
    expect(theme.red).toBe('#ff2e4d');
    expect(theme.brightCyan).toBe('#7df0f2');
    expect(theme.green).toBeUndefined();
  });
});
