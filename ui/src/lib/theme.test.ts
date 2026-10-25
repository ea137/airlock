import { describe, expect, it } from 'vitest';

import { parseLook } from './theme.svelte';
import { isThemeId, THEMES } from './themes';

describe('parseLook', () => {
  it('reads a saved look', () => {
    expect(parseLook('{"theme":"matrix","terminalColours":false,"motion":false}')).toEqual({
      theme: 'matrix',
      terminalColours: false,
      motion: false,
    });
  });

  it('falls back to the default for anything missing or unknown', () => {
    const fallback = { theme: 'current', terminalColours: true, motion: true };
    expect(parseLook(null)).toEqual(fallback);
    expect(parseLook('not json')).toEqual(fallback);
    expect(parseLook('{"theme":"neon","motion":"yes"}')).toEqual(fallback);
  });
});

describe('themes', () => {
  it('has the nine chosen themes, each once', () => {
    expect(THEMES.map((theme) => theme.name)).toEqual([
      'Current',
      'Matrix',
      '8-bit',
      'Teletext',
      'Handheld console',
      'Game Boy',
      '90s workstation',
      'Vector display',
      'Hacker',
    ]);
    expect(new Set(THEMES.map((theme) => theme.id)).size).toBe(THEMES.length);
    expect(isThemeId('hacker')).toBe(true);
    expect(isThemeId('neon')).toBe(false);
  });
});
