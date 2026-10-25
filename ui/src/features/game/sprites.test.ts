import { describe, expect, it } from 'vitest';

import { ART } from './art';
import { FONT_ROWS, GLYPH_H, GLYPH_W } from './font';
import { skinFrom, toShade } from './skin';

describe('the art', () => {
  it('draws every row of a sprite the same width', () => {
    const wrong = Object.entries(ART).flatMap(([name, art]) =>
      art.rows.map((row, y) => [name, y, row.length] as const).filter(([, , length]) => length !== art.w),
    );
    expect(wrong).toEqual([]);
  });

  it('uses only the five colour slots and clear', () => {
    for (const [name, art] of Object.entries(ART)) expect(art.rows.every((row) => /^[.1-5]+$/.test(row)), name).toBe(true);
  });

  it('draws the player and bosses at their sizes', () => {
    expect([ART.s_idle?.w, ART.s_idle?.h]).toEqual([8, 8]);
    expect([ART.b_idle?.w, ART.b_idle?.h]).toEqual([8, 16]);
    for (const boss of ['hopper', 'swooper', 'charger', 'burrower', 'swarm']) {
      for (const frame of [1, 2]) expect([ART[`${boss}${frame}`]?.w, ART[`${boss}${frame}`]?.h], `${boss}${frame}`).toEqual([16, 16]);
    }
  });

  it('draws every glyph three wide and five tall', () => {
    for (const [ch, rows] of Object.entries(FONT_ROWS)) {
      const lines = rows.split('|');
      expect(lines.length, ch).toBe(GLYPH_H);
      for (const line of lines) expect(line.length, ch).toBe(GLYPH_W);
    }
  });
});

describe('skins', () => {
  const tokens: Record<string, string> = { '--c-bg': '#9bbc0f', '--c-text': '#0f380f', '--c-accent': '#306230', '--c-surface': '#8bac0f' };
  const lookup = (name: string, fallback: string) => tokens[name] ?? fallback;

  it('keeps the Game Boy to its four greens', () => {
    const skin = skinFrom('gameboy', lookup);
    expect(skin.style).toBe('lcd');
    expect(skin.shades).toEqual(['#0f380f', '#306230', '#8bac0f', '#9bbc0f']);
    for (const colour of ['#ff0000', '#ffffff', '#000000', '#3b63e6']) expect(skin.shades).toContain(toShade(skin, colour));
  });

  it('draws outlines dark on a light screen and light on a dark one', () => {
    expect(skinFrom('gameboy', lookup).ink).toBe('#0f380f');
    const dark = skinFrom('current', (name, fallback) => (name === '--c-bg' ? '#111317' : fallback));
    expect(dark.ink).not.toBe(dark.text);
  });

  it('has a style for every theme', () => {
    const styles = ['current', 'matrix', 'boot', 'teletext', 'handheld', 'gameboy', 'workstation', 'vector', 'hacker'].map((theme) => skinFrom(theme, lookup).style);
    expect(new Set(styles).size).toBe(8);
  });
});
