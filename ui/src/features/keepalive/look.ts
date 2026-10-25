// How Keepalive looks in each Airlock theme and chapter. The colours come
// from the theme's tokens (read by Hop Count's skin.ts, which both games
// share) and the chapter's own hue: the clockwork's brass, the stacks' rust,
// the buffer's sea, the old ports' phosphor, the null's violet. The theme's
// style then has its say: four LCD greens, teletext's eight colours,
// vector and neon lines on black, the workstation's greys, the matrix's
// greens.

import { type Skin, luma, mix, rgb, toShade } from '../game/skin';
import type { Paint } from './art';

export type Palette = Record<Paint, string>;

/** Which of the skin's hues each chapter takes: Loopback, Crontab, Stacks, Buffer, Ports, Null, home again. */
export const CHAPTER_HUE = [0, 7, 6, 2, 1, 3, 0] as const;

const TELETEXT = ['#000000', '#ff0000', '#00ff00', '#ffff00', '#0000ff', '#ff00ff', '#00ffff', '#ffffff'];
const TELETEXT_WALL = ['#00ff00', '#ffff00', '#ff0000', '#00ffff', '#00ff00', '#ff00ff', '#00ff00'];

function nearest(colour: string, options: readonly string[]): string {
  const [r, g, b] = rgb(colour);
  let best = options[0] ?? '#000000';
  let bestDistance = Infinity;
  for (const option of options) {
    const [or, og, ob] = rgb(option);
    const distance = (or - r) ** 2 + (og - g) ** 2 + (ob - b) ** 2;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = option;
    }
  }
  return best;
}

/** A colour as the theme shows it. */
export function styled(skin: Skin, colour: string): string {
  if (skin.style === 'lcd') return toShade(skin, colour);
  if (skin.style === 'mosaic') return nearest(colour, TELETEXT);
  if (skin.style === 'glyph') {
    const level = luma(colour) / 255;
    return level < 0.06 ? '#000000' : mix('#002b0c', skin.accent, Math.min(1, level * 1.25));
  }
  return colour;
}

/** On an LCD each paint has its shade, darkest (0) to lightest (3). */
const LCD: Record<Paint, number> = {
  ink: 0,
  text: 0,
  dim: 1,
  light: 3,
  accent: 1,
  accentLight: 2,
  ok: 1,
  warn: 1,
  danger: 1,
  dangerLight: 2,
  hue: 1,
  hueLight: 2,
  hueDark: 0,
  skin: 2,
  cron: 2,
  cronLight: 3,
  sudo: 1,
  sudoLight: 2,
  float: 2,
  floatLight: 3,
  tel: 1,
  telLight: 3,
  void: 0,
  voidLight: 1,
  decor: 1,
  decorLight: 2,
  wallTop: 1,
  wallLight: 2,
  wallLine: 0,
  wallFace: 0,
  floor: 3,
  floor2: 2,
  line: 2,
};

export function chapterHue(skin: Skin, chapter: number): string {
  return skin.hues[CHAPTER_HUE[chapter] ?? 0] ?? skin.accent;
}

/** Every paint's colour for a theme and chapter. */
export function palette(skin: Skin, chapter: number): Palette {
  const hue = chapterHue(skin, chapter);
  const white = '#ffffff';
  const black = '#000000';
  const lighter = (c: string, k = 0.45) => mix(c, white, k);
  const darker = (c: string, k = 0.45) => mix(c, black, k);
  const floor = mix(skin.near, hue, 0.14);
  const wallTop = mix(skin.ground, hue, 0.38);
  const p: Palette = {
    ink: skin.ink,
    text: skin.text,
    dim: skin.dim,
    light: skin.light,
    accent: skin.accent,
    accentLight: skin.accentLight,
    ok: skin.ok,
    warn: skin.warn,
    danger: skin.danger,
    dangerLight: skin.dangerLight,
    hue,
    hueLight: lighter(hue),
    hueDark: darker(hue, 0.5),
    skin: mix(skin.text, skin.ground, 0.3),
    cron: skin.hues[7] ?? skin.warn,
    cronLight: lighter(skin.hues[7] ?? skin.warn, 0.55),
    sudo: skin.danger,
    sudoLight: lighter(skin.danger, 0.35),
    float: skin.hues[3] ?? skin.accent,
    floatLight: lighter(skin.hues[3] ?? skin.accent, 0.5),
    tel: darker(skin.hues[1] ?? skin.ok, 0.35),
    telLight: lighter(skin.hues[1] ?? skin.ok, 0.4),
    void: mix(skin.bg, black, 0.5),
    voidLight: mix(mix(skin.bg, black, 0.5), hue, 0.3),
    decor: mix(hue, skin.ground, 0.45),
    decorLight: lighter(hue, 0.25),
    wallTop,
    wallLight: lighter(wallTop, 0.22),
    wallLine: darker(wallTop, 0.25),
    wallFace: darker(wallTop, 0.42),
    floor,
    floor2: mix(skin.near, hue, 0.26),
    line: darker(floor, 0.28),
  };
  switch (skin.style) {
    case 'lcd':
      for (const key of Object.keys(LCD) as Paint[]) p[key] = skin.shades[LCD[key]] ?? skin.text;
      return p;
    case 'mosaic': {
      const wall = TELETEXT_WALL[chapter] ?? '#00ffff';
      Object.assign(p, {
        void: black,
        voidLight: '#0000ff',
        floor: '#0000ff',
        floor2: '#0000ff',
        line: black,
        wallTop: wall,
        wallLight: white,
        wallLine: black,
        wallFace: black,
        decor: wall,
        decorLight: white,
        hue: wall,
        hueLight: white,
        hueDark: black,
        skin: white,
        ink: black,
      });
      break;
    }
    case 'bevel':
      // The workstation: a teal desktop, grey floors, bevelled walls.
      Object.assign(p, {
        void: '#008080',
        voidLight: '#00a8a8',
        floor: '#c0c0c0',
        floor2: '#b4b4b4',
        line: '#a0a0a0',
        wallTop: '#d4d4d4',
        wallLight: '#ffffff',
        wallLine: '#404040',
        wallFace: '#808080',
        decor: mix('#c0c0c0', hue, 0.5),
        decorLight: '#ffffff',
        ink: '#000000',
        skin: '#e8e8e8',
      });
      break;
    case 'outline':
    case 'neon': {
      // Lines of light on black: fills dark, edges and patterns bright.
      const glow = skin.style === 'neon' ? hue : skin.accentLight;
      Object.assign(p, {
        void: black,
        voidLight: mix(black, glow, 0.25),
        floor: mix(black, hue, 0.08),
        floor2: mix(black, hue, 0.16),
        line: mix(glow, black, 0.45),
        wallTop: mix(black, glow, 0.22),
        wallLight: glow,
        wallLine: glow,
        wallFace: mix(black, glow, 0.1),
        decor: mix(black, hue, 0.3),
        decorLight: glow,
        hueDark: mix(black, hue, 0.25),
        ink: black,
      });
      break;
    }
    case 'chunky':
      p.void = darker(skin.bg, 0.3);
      break;
  }
  for (const key of Object.keys(p) as Paint[]) p[key] = styled(skin, p[key]);
  return p;
}
