// The sprite atlas: every drawing in art.ts painted once per skin and zone
// into one canvas, facing both ways, restyled for the theme: four LCD
// greens, teletext's chunky mosaic, vector and neon outlines with a glow,
// the matrix's greens, a home computer's wide pixels. Drawing a frame is
// then one drawImage from this canvas.

import { ART, type Art, type Paint } from './art';
import { FONT, GLYPH_H, GLYPH_W } from './font';
import { hex, luma, mix, rgb, type Skin, toShade } from './skin';

export type Frame = { x: number; y: number; w: number; h: number };

export type Atlas = {
  canvas: HTMLCanvasElement;
  /** Each sprite facing right, and mirrored to face left. */
  right: Record<string, Frame>;
  left: Record<string, Frame>;
  /** Font glyphs by character, in the FONT_INKS colours. */
  font: Record<string, Frame>[];
};

/** The font's colours: plain, dim, highlight, and dark (for shadows). */
export const FONT_INKS = 4;

const TELETEXT = ['#000000', '#ff0000', '#00ff00', '#ffff00', '#0000ff', '#ff00ff', '#00ffff', '#ffffff'];

function nearest(colour: [number, number, number], palette: string[]): string {
  let best = palette[0] ?? '#000000';
  let bestDistance = Infinity;
  for (const option of palette) {
    const [r, g, b] = rgb(option);
    const distance = (r - colour[0]) ** 2 + (g - colour[1]) ** 2 + (b - colour[2]) ** 2;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = option;
    }
  }
  return best;
}

function resolve(skin: Skin, hue: number, paint: Paint): string {
  if (paint === 'zone') return skin.hues[hue % skin.hues.length] ?? skin.accent;
  if (paint.length === 2 && paint.startsWith('h')) return skin.hues[Number(paint.slice(1))] ?? skin.accent;
  return skin[paint as Exclude<Paint, 'zone' | 'h1' | 'h2' | 'h3' | 'h5' | 'h6' | 'h7'>];
}

/** A colour as the theme would show it. */
export function styled(skin: Skin, colour: string): string {
  if (skin.style === 'lcd') return toShade(skin, colour);
  if (skin.style === 'mosaic') return nearest(rgb(colour), TELETEXT);
  if (skin.style === 'glyph') {
    // The matrix: everything a shade of its green, by brightness.
    const level = luma(colour) / 255;
    return level < 0.12 ? '#000000' : mix('#003b10', skin.accent, Math.min(1, level * 1.3));
  }
  return colour;
}

/** On an LCD each kind of colour has its shade: outlines darkest, bodies
 * mid, highlights lightest, as pocket consoles drew their sprites. */
const LCD_SHADE: Record<Paint, number> = {
  ink: 0,
  text: 0,
  groundDark: 0,
  dim: 1,
  danger: 1,
  zone: 1,
  ground: 1,
  h1: 1,
  h2: 2,
  h3: 1,
  h5: 1,
  h6: 2,
  h7: 1,
  accent: 2,
  ok: 2,
  warn: 2,
  dangerLight: 2,
  accentLight: 3,
  light: 3,
};

/** The packet and its fan: the art that must stand out in every theme. */
function isHero(name: string): boolean {
  return /^(s|ss|b|bp|bf|bs)_/.test(name) || name === 'fan';
}

/** Tiles, as opposed to things that move. */
const TILE_ART = new Set(['groundTop', 'ground', 'brick', 'qblock1', 'qblock2', 'used', 'hard', 'oneway', 'spike', 'liquid1', 'liquid2', 'ice', 'conv1', 'conv2', 'switchOn', 'switchOff', 'red', 'blue', 'beatA', 'beatB', 'pipeTL', 'pipeTR', 'pipeL', 'pipeR', 'spring1', 'spring2', 'decorA', 'decorB', 'decorC', 'gate']);

/** A sprite's pixels as RGBA, restyled for the skin. */
function pixels(name: string, art: Art, skin: Skin, hue: number): Uint8ClampedArray {
  const { w, h } = art;
  const out = new Uint8ClampedArray(w * h * 4);
  const colours = art.paint.map((paint) =>
    rgb(skin.style === 'lcd' ? (skin.shades[LCD_SHADE[paint]] ?? skin.text) : styled(skin, resolve(skin, hue, paint))),
  );
  for (let y = 0; y < h; y += 1) {
    const row = art.rows[y] ?? '';
    for (let x = 0; x < w; x += 1) {
      const ch = row[x] ?? '.';
      if (ch === '.') continue;
      const colour = colours[Number(ch) - 1] ?? colours[0];
      if (!colour) continue;
      const at = (y * w + x) * 4;
      out[at] = colour[0];
      out[at + 1] = colour[1];
      out[at + 2] = colour[2];
      out[at + 3] = 255;
    }
  }
  const opaque = (x: number, y: number, from: Uint8ClampedArray) => x >= 0 && y >= 0 && x < w && y < h && (from[(y * w + x) * 4 + 3] ?? 0) > 0;
  // Chunky pixels: teletext's 2x2 mosaic blocks for its scenery (its
  // characters stay sharp), a home computer's wide pixels for everything.
  if ((skin.style === 'mosaic' && TILE_ART.has(name)) || skin.style === 'chunky') {
    const tall = skin.style === 'mosaic' ? 2 : 1;
    const copy = out.slice();
    for (let y = 0; y < h; y += tall) {
      for (let x = 0; x < w; x += 2) {
        let count = 0;
        let pick = -1;
        for (let dy = 0; dy < tall; dy += 1) {
          for (let dx = 0; dx < 2; dx += 1) {
            if (!opaque(x + dx, y + dy, copy)) continue;
            count += 1;
            if (pick < 0) pick = ((y + dy) * w + x + dx) * 4;
          }
        }
        const keep = pick >= 0 && count * 2 >= tall * 2;
        for (let dy = 0; dy < tall; dy += 1) {
          for (let dx = 0; dx < 2; dx += 1) {
            if (x + dx >= w || y + dy >= h) continue;
            const at = ((y + dy) * w + x + dx) * 4;
            out[at] = keep ? (copy[pick] ?? 0) : 0;
            out[at + 1] = keep ? (copy[pick + 1] ?? 0) : 0;
            out[at + 2] = keep ? (copy[pick + 2] ?? 0) : 0;
            out[at + 3] = keep ? 255 : 0;
          }
        }
      }
    }
  }
  if (skin.style === 'outline' || skin.style === 'neon') {
    // Lines of light: bright edges, the inside a dim version of itself, and
    // a faint glow around.
    const copy = out.slice();
    const glow = rgb(skin.style === 'neon' ? skin.accent : skin.accentLight);
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        const at = (y * w + x) * 4;
        if (opaque(x, y, copy)) {
          const own = hex([copy[at] ?? 0, copy[at + 1] ?? 0, copy[at + 2] ?? 0]);
          const edge = !opaque(x - 1, y, copy) || !opaque(x + 1, y, copy) || !opaque(x, y - 1, copy) || !opaque(x, y + 1, copy);
          // The packet keeps its own colours inside, so it's easy to find.
          const inside = isHero(name) ? own : mix(own, '#000000', skin.style === 'outline' ? 0.7 : 0.6);
          const colour = rgb(edge ? mix(luma(own) < 60 ? hex(glow) : own, '#ffffff', skin.style === 'outline' ? 0.4 : 0.2) : inside);
          out[at] = colour[0];
          out[at + 1] = colour[1];
          out[at + 2] = colour[2];
          out[at + 3] = 255;
          continue;
        }
        let near = false;
        for (let dy = -1; dy <= 1 && !near; dy += 1) for (let dx = -1; dx <= 1 && !near; dx += 1) if (opaque(x + dx, y + dy, copy)) near = true;
        if (!near) continue;
        out[at] = glow[0];
        out[at + 1] = glow[1];
        out[at + 2] = glow[2];
        out[at + 3] = 70;
      }
    }
  }
  if (skin.style === 'glyph' && !isHero(name)) {
    // Every other row a little darker, like characters on a green screen.
    for (let y = 1; y < h; y += 2) {
      for (let x = 0; x < w; x += 1) {
        const at = (y * w + x) * 4;
        out[at] = (out[at] ?? 0) * 0.7;
        out[at + 1] = (out[at + 1] ?? 0) * 0.7;
        out[at + 2] = (out[at + 2] ?? 0) * 0.7;
      }
    }
  }
  return out;
}

export function buildAtlas(skin: Skin, hue: number): Atlas {
  const names = Object.keys(ART);
  // Shelf packing: rows 16 high, 256 wide.
  const width = 256;
  const shelf = 16;
  let x = 0;
  let y = 0;
  const right: Record<string, Frame> = {};
  const left: Record<string, Frame> = {};
  const place = (w: number, h: number): Frame => {
    if (x + w > width) {
      x = 0;
      y += shelf;
    }
    const frame = { x, y, w, h };
    x += w;
    return frame;
  };
  for (const name of names) {
    const art = ART[name];
    if (!art) continue;
    right[name] = place(art.w, art.h);
    left[name] = place(art.w, art.h);
  }
  const font: Record<string, Frame>[] = [];
  for (let ink = 0; ink < FONT_INKS; ink += 1) {
    const frames: Record<string, Frame> = {};
    for (const ch of Object.keys(FONT)) frames[ch] = place(GLYPH_W, GLYPH_H);
    font.push(frames);
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = y + shelf;
  const ctx = canvas.getContext('2d');
  if (!ctx) return { canvas, right, left, font };
  const image = ctx.createImageData(width, canvas.height);
  const blit = (data: Uint8ClampedArray, frame: Frame, flip: boolean) => {
    for (let py = 0; py < frame.h; py += 1) {
      for (let px = 0; px < frame.w; px += 1) {
        const from = (py * frame.w + (flip ? frame.w - 1 - px : px)) * 4;
        const to = ((frame.y + py) * width + frame.x + px) * 4;
        image.data[to] = data[from] ?? 0;
        image.data[to + 1] = data[from + 1] ?? 0;
        image.data[to + 2] = data[from + 2] ?? 0;
        image.data[to + 3] = data[from + 3] ?? 0;
      }
    }
  };
  for (const name of names) {
    const art = ART[name];
    const r = right[name];
    const l = left[name];
    if (!art || !r || !l) continue;
    const data = pixels(name, art, skin, hue);
    blit(data, r, false);
    blit(data, l, true);
  }
  // Text and its shadow: dark text on a light screen gets a light shadow.
  const text = skin.style === 'lcd' ? (skin.shades[0] ?? skin.text) : skin.text;
  const shadow = luma(text) < luma(skin.sky) ? skin.sky : skin.ink;
  const inks = [text, skin.style === 'lcd' ? (skin.shades[1] ?? skin.dim) : skin.dim, skin.style === 'lcd' ? (skin.shades[1] ?? skin.warn) : skin.warn, shadow].map(
    (colour) => rgb(styled(skin, colour)),
  );
  font.forEach((frames, ink) => {
    const [r, g, b] = inks[ink] ?? [255, 255, 255];
    for (const [ch, rows] of Object.entries(FONT)) {
      const frame = frames[ch];
      if (!frame) continue;
      const data = new Uint8ClampedArray(GLYPH_W * GLYPH_H * 4);
      for (let i = 0; i < GLYPH_W * GLYPH_H; i += 1) {
        if (rows[i] !== '#') continue;
        data[i * 4] = r;
        data[i * 4 + 1] = g;
        data[i * 4 + 2] = b;
        data[i * 4 + 3] = 255;
      }
      blit(data, frame, false);
    }
  });
  ctx.putImageData(image, 0, 0);
  return { canvas, right, left, font };
}
