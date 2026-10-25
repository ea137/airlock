// The atlas: every sprite and tile painted once per theme and chapter into
// one canvas, so drawing a frame is a run of drawImage calls from it.
// Sprites come from art.ts; tiles are painted here, a pattern for each
// chapter (Loopback's moss and cobbles, the Crontab's riveted brass, the
// Stacks' drawers, the Buffer's planks, the Ports' circuit boards, the
// Null's cracked glass). Then the theme's style: teletext's mosaic, a home
// computer's wide pixels, the matrix's scanlines, vector and neon glow.

import { hex, luma, mix, rgb, type Skin } from '../game/skin';
import { ART, type Art, DECOR, FACED, type Paint } from './art';
import type { Palette } from './look';

export type Frame = { x: number; y: number; w: number; h: number };

export type Atlas = { canvas: HTMLCanvasElement; frames: Record<string, Frame>; palette: Palette };

const S = 16;

/** Paints the tile painters use, by code (0 is clear). */
const P: Paint[] = ['void', 'floor', 'floor2', 'line', 'wallTop', 'wallLight', 'wallLine', 'wallFace', 'decor', 'decorLight', 'hue', 'hueLight', 'hueDark', 'ink', 'light', 'dim', 'danger', 'warn', 'ok', 'voidLight'];
const C = Object.fromEntries(P.map((paint, i) => [paint, i + 1])) as Record<Paint, number>;

type Buf = Uint8Array;

function hash(...parts: number[]): number {
  let h = 2166136261;
  for (const part of parts) {
    h ^= part;
    h = Math.imul(h, 16777619);
    h ^= h >>> 13;
  }
  return (h >>> 0) / 4294967296;
}

function buf(fill = 0): Buf {
  return new Uint8Array(S * S).fill(fill);
}

function rect(b: Buf, x: number, y: number, w: number, h: number, code: number): void {
  for (let yy = Math.max(0, y); yy < Math.min(S, y + h); yy += 1) for (let xx = Math.max(0, x); xx < Math.min(S, x + w); xx += 1) b[yy * S + xx] = code;
}

function dot(b: Buf, x: number, y: number, code: number): void {
  if (x >= 0 && y >= 0 && x < S && y < S) b[y * S + x] = code;
}

function floor(ch: number, variant: number): Buf {
  const b = buf(variant === 1 ? C.floor2 : C.floor);
  const seed = ch * 31 + variant * 7;
  switch (ch) {
    case 1:
      // Riveted brass plates; the second floor has a gear in it, the rug is a brass runner.
      if (variant === 2) {
        rect(b, 0, 0, 16, 16, C.floor2);
        rect(b, 0, 2, 16, 1, C.hueDark);
        rect(b, 0, 13, 16, 1, C.hueDark);
        for (let x = 1; x < S; x += 4) dot(b, x, 7, C.hueDark);
        return b;
      }
      rect(b, 0, 15, 16, 1, C.line);
      rect(b, 15, 0, 1, 16, C.line);
      dot(b, 2, 2, C.hueDark);
      dot(b, 12, 12, C.hueDark);
      if (variant === 1) for (let a = 0; a < 24; a += 1) dot(b, Math.round(7 + Math.cos((a / 24) * Math.PI * 2) * 4), Math.round(7 + Math.sin((a / 24) * Math.PI * 2) * 4), C.hueDark);
      return b;
    case 2:
      // Planks across; tiles; a red runner.
      if (variant === 2) {
        rect(b, 0, 0, 16, 16, C.danger);
        rect(b, 0, 1, 16, 1, C.warn);
        rect(b, 0, 14, 16, 1, C.warn);
        return b;
      }
      if (variant === 1) {
        rect(b, 0, 7, 16, 1, C.line);
        rect(b, 7, 0, 1, 16, C.line);
        rect(b, 0, 15, 16, 1, C.line);
        rect(b, 15, 0, 1, 16, C.line);
        return b;
      }
      for (const y of [3, 7, 11, 15]) rect(b, 0, y, 16, 1, C.line);
      for (let row = 0; row < 4; row += 1) dot(b, (row * 5 + 3) % 16, row * 4 + 1, C.line);
      return b;
    case 3:
      // Dock planks, nailed; wet planks; netting.
      if (variant === 2) {
        for (let y = 0; y < S; y += 1) for (let x = 0; x < S; x += 1) if ((x + y) % 5 === 0 || (x - y + 20) % 5 === 0) b[y * S + x] = C.hueDark;
        return b;
      }
      for (const x of [3, 7, 11, 15]) rect(b, x, 0, 1, 16, C.line);
      for (let k = 0; k < 4; k += 1) dot(b, k * 4 + 1, ((k * 7) % 3) * 5 + 2, C.wallLine);
      if (variant === 1) for (let k = 0; k < 10; k += 1) dot(b, Math.floor(hash(seed, k) * 16), Math.floor(hash(k, seed) * 16), C.hue);
      return b;
    case 4:
      // A circuit board: traces and vias; a grille; a bundle of cables.
      if (variant === 2) {
        for (let x = 0; x < S; x += 1) rect(b, x, 0, 1, 16, [C.hueDark, C.line, C.dim, C.line][x % 4] ?? C.line);
        return b;
      }
      if (variant === 1) {
        for (let y = 1; y < S; y += 3) for (let x = 1; x < S; x += 3) dot(b, x, y, C.line);
        return b;
      }
      rect(b, 0, 5, 9, 1, C.hueDark);
      rect(b, 8, 5, 1, 11, C.hueDark);
      rect(b, 3, 11, 13, 1, C.hueDark);
      dot(b, 8, 5, C.hue);
      dot(b, 3, 11, C.hue);
      dot(b, 12, 2, C.line);
      return b;
    case 5:
      // Cracked glass over the void; darker glass; stars.
      if (variant === 2) {
        for (let k = 0; k < 6; k += 1) dot(b, Math.floor(hash(seed, k, 1) * 16), Math.floor(hash(seed, k, 2) * 16), C.hueLight);
        return b;
      }
      for (let k = 0; k < 9; k += 1) dot(b, 2 + k, 13 - Math.floor(k * 1.2), C.line);
      for (let k = 0; k < 5; k += 1) dot(b, 9 + k, 6 + k, C.line);
      if (variant === 1) rect(b, 0, 0, 16, 1, C.voidLight);
      return b;
    default:
      // Loopback: a soft grid with moss; grass; cobbles.
      if (variant === 2) {
        for (let y = 0; y < S; y += 1) {
          for (let x = 0; x < S; x += 1) {
            const cx = (x % 8) - 3.5;
            const cy = ((y + (x < 8 ? 0 : 4)) % 8) - 3.5;
            b[y * S + x] = cx * cx + cy * cy > 13 ? C.floor : C.floor2;
          }
        }
        return b;
      }
      if (variant === 1) {
        for (let k = 0; k < 14; k += 1) dot(b, Math.floor(hash(seed, k) * 16), Math.floor(hash(k, seed, 3) * 16), k % 3 === 0 ? C.hueLight : C.hue);
        return b;
      }
      rect(b, 0, 15, 16, 1, C.line);
      rect(b, 15, 0, 1, 16, C.line);
      for (let k = 0; k < 4; k += 1) dot(b, Math.floor(hash(seed, k) * 14), Math.floor(hash(k, 9) * 14), C.floor2);
      return b;
  }
}

function wall(ch: number, face: boolean): Buf {
  const b = buf(C.wallTop);
  const top = face ? 10 : 16;
  switch (ch) {
    case 1:
      rect(b, 0, 0, 16, 1, C.wallLight);
      dot(b, 3, 3, C.hueLight);
      dot(b, 12, 3, C.hueLight);
      if (top === 16) {
        dot(b, 3, 12, C.hueLight);
        dot(b, 12, 12, C.hueLight);
      }
      if (face) for (let x = 0; x < S; x += 1) rect(b, x, 10, 1, 6, x % 4 === 1 ? C.hue : x % 4 === 2 ? C.hueDark : C.wallFace);
      break;
    case 2:
      rect(b, 1, 1, 14, Math.min(top, 16) - 2, C.wallLine);
      rect(b, 2, 2, 12, Math.min(top, 16) - 4, C.wallTop);
      if (face) {
        rect(b, 0, 10, 16, 6, C.wallFace);
        rect(b, 6, 12, 4, 1, C.light);
      }
      break;
    case 3:
      for (let k = 0; k < 18; k += 1) dot(b, Math.floor(hash(k, 3) * 16), Math.floor(hash(3, k) * top), k % 2 ? C.wallLight : C.wallLine);
      if (face) {
        rect(b, 0, 10, 16, 6, C.wallFace);
        rect(b, 0, 14, 16, 1, C.hueDark);
      }
      break;
    case 4:
      for (let y = 3; y < top - 2; y += 3) rect(b, 3, y, 10, 1, C.wallLine);
      rect(b, 0, 0, 16, 1, C.wallLight);
      if (face) {
        rect(b, 0, 10, 16, 6, C.wallFace);
        dot(b, 3, 12, C.ok);
        dot(b, 6, 12, C.danger);
        dot(b, 9, 12, C.ok);
        rect(b, 12, 12, 2, 1, C.warn);
      }
      break;
    case 5:
      for (let k = 0; k < 7; k += 1) dot(b, 4 + k, 2 + Math.floor(k * 1.1), C.hueLight);
      if (face) rect(b, 0, 10, 16, 6, C.wallFace);
      break;
    default:
      // Stone blocks.
      for (let y = 0; y < top; y += 1) {
        if (y % 5 === 4) rect(b, 0, y, 16, 1, C.wallLine);
        else dot(b, y % 10 < 5 ? 7 : 15, y, C.wallLine);
      }
      rect(b, 0, 0, 16, 1, C.wallLight);
      if (face) {
        rect(b, 0, 10, 16, 6, C.wallFace);
        for (let x = 0; x < S; x += 4) rect(b, x + 1, 12, 2, 1, C.wallLine);
      }
  }
  if (face) rect(b, 0, 10, 16, 1, C.wallLine);
  return b;
}

function cracked(ch: number, face: boolean): Buf {
  const b = wall(ch, face);
  const path = [
    [8, 1],
    [7, 3],
    [9, 5],
    [8, 7],
    [6, 8],
    [10, 9],
  ] as const;
  for (const [x, y] of path) {
    dot(b, x, y, C.ink);
    dot(b, x + 1, y, C.ink);
  }
  dot(b, 5, 4, C.ink);
  dot(b, 11, 6, C.ink);
  return b;
}

function rubble(ch: number): Buf {
  const b = floor(ch, 0);
  for (let k = 0; k < 7; k += 1) {
    const x = 2 + Math.floor(hash(k, 77) * 11);
    const y = 3 + Math.floor(hash(77, k) * 10);
    rect(b, x, y, 2, 2, C.wallTop);
    dot(b, x + 1, y + 1, C.wallLine);
  }
  return b;
}

/** The edge of the floor, falling away into the void (the top of a void tile). */
function cliff(): Buf {
  const b = buf();
  rect(b, 0, 0, 16, 3, C.wallFace);
  rect(b, 0, 3, 16, 1, C.wallLine);
  return b;
}

function vent(frame: number): Buf {
  const b = buf();
  for (let x = 2; x < 14; x += 4) for (let y = 0; y < S; y += 1) if ((y + frame * 3 + x) % 6 < 2) dot(b, x + ((y >> 2) & 1), y, C.hueLight);
  rect(b, 1, 14, 14, 1, C.voidLight);
  return b;
}

function hazard(ch: number, frame: number): Buf {
  const b = floor(ch, 0);
  for (let x = 0; x < S; x += 1) {
    const y = 8 + Math.round(Math.sin((x + frame * 4) * 0.9) * 3);
    dot(b, x, y, frame ? C.warn : C.danger);
    dot(b, x, y + 1, C.danger);
  }
  return b;
}

function door(): Buf {
  const b = buf(C.wallFace);
  rect(b, 0, 0, 16, 1, C.wallLight);
  for (let x = 2; x < 15; x += 4) rect(b, x, 1, 2, 15, C.wallTop);
  rect(b, 0, 7, 16, 2, C.wallLine);
  rect(b, 6, 6, 4, 4, C.hue);
  dot(b, 7, 7, C.ink);
  dot(b, 8, 8, C.ink);
  return b;
}

function gate(): Buf {
  const b = buf();
  for (let x = 1; x < 16; x += 3) rect(b, x, 0, 2, 16, C.hueDark);
  rect(b, 0, 4, 16, 1, C.hue);
  rect(b, 0, 11, 16, 1, C.hue);
  for (let x = 1; x < 16; x += 3) dot(b, x, 15, C.hueLight);
  return b;
}

function bridge(on: boolean): Buf {
  const b = buf();
  if (on) {
    rect(b, 0, 0, 16, 16, C.decor);
    for (const y of [0, 5, 10, 15]) rect(b, 0, y, 16, 1, C.hueDark);
    rect(b, 1, 0, 1, 16, C.decorLight);
    rect(b, 14, 0, 1, 16, C.decorLight);
    return b;
  }
  for (let k = 0; k < 16; k += 4) {
    rect(b, k, 0, 2, 1, C.voidLight);
    rect(b, k, 15, 2, 1, C.voidLight);
    rect(b, 0, k, 1, 2, C.voidLight);
    rect(b, 15, k, 1, 2, C.voidLight);
  }
  return b;
}

/** A ghost floor while its relay is lit: a faint lattice of light over the void. */
function ghostOn(): Buf {
  const b = buf();
  for (let y = 0; y < S; y += 1) for (let x = 0; x < S; x += 1) if (x % 8 === 0 || y % 8 === 0) b[y * S + x] = x % 8 === 0 && y % 8 === 0 ? C.hueLight : C.hueDark;
  return b;
}

function conveyor(dir: number, frame: number): Buf {
  const b = buf(C.wallFace);
  // The belt's edges, along the way it runs.
  if (dir === 0 || dir === 2) {
    rect(b, 0, 0, 1, 16, C.wallLine);
    rect(b, 15, 0, 1, 16, C.wallLine);
  } else {
    rect(b, 0, 0, 16, 1, C.wallLine);
    rect(b, 0, 15, 16, 1, C.wallLine);
  }
  // Chevrons pointing up, turned to the conveyor's way.
  const up = buf();
  for (let k = 0; k < 2; k += 1) {
    const y0 = ((k * 8 + 16 - frame * 4) % 16) + 2;
    for (let i = 0; i < 5; i += 1) {
      dot(up, 7 - i, y0 + i, C.hue);
      dot(up, 8 + i, y0 + i, C.hue);
    }
  }
  for (let y = 0; y < S; y += 1) {
    for (let x = 0; x < S; x += 1) {
      // Turn (x, y) back to the upward drawing.
      const [ux, uy] = dir === 0 ? [x, y] : dir === 1 ? [15 - y, x] : dir === 2 ? [15 - x, 15 - y] : [y, 15 - x];
      const code = up[uy * S + ux] ?? 0;
      if (code) b[y * S + x] = code;
    }
  }
  return b;
}

function plate(down: boolean): Buf {
  const b = buf(C.floor);
  rect(b, 2, 2, 12, 12, C.wallLine);
  rect(b, 3, down ? 4 : 3, 10, down ? 9 : 9, down ? C.hueDark : C.hue);
  if (!down) rect(b, 3, 12, 10, 1, C.wallFace);
  rect(b, 4, down ? 5 : 4, 8, 1, down ? C.hue : C.hueLight);
  return b;
}

function filled(): Buf {
  const b = buf(C.decor);
  rect(b, 0, 0, 16, 1, C.decorLight);
  rect(b, 0, 15, 16, 1, C.hueDark);
  for (let k = 3; k < 16; k += 5) rect(b, k, 3, 1, 10, C.hueDark);
  return b;
}

function ledge(ch: number): Buf {
  const b = floor(ch, 0);
  rect(b, 0, 9, 16, 3, C.wallTop);
  rect(b, 0, 9, 16, 1, C.wallLight);
  rect(b, 0, 12, 16, 2, C.wallFace);
  rect(b, 2, 5, 2, 4, C.wallTop);
  rect(b, 12, 5, 2, 4, C.wallTop);
  return b;
}

const TELETEXT_TILES = true;

/** A tile's pixels from its codes, in the palette; teletext and the 8-bit theme chunk them. */
function tilePixels(b: Buf, pal: Palette, skin: Skin): Uint8ClampedArray {
  const out = new Uint8ClampedArray(S * S * 4);
  const colours = P.map((paint) => rgb(pal[paint]));
  for (let i = 0; i < S * S; i += 1) {
    const code = b[i] ?? 0;
    if (!code) continue;
    const c = colours[code - 1];
    if (!c) continue;
    out[i * 4] = c[0];
    out[i * 4 + 1] = c[1];
    out[i * 4 + 2] = c[2];
    out[i * 4 + 3] = 255;
  }
  if ((skin.style === 'mosaic' && TELETEXT_TILES) || skin.style === 'chunky') chunk(out, S, S, skin.style === 'mosaic' ? 2 : 1);
  if (skin.style === 'glyph') scanlines(out, S, S);
  return out;
}

/** Blocks of 2 by `tall`, each the colour most of it was. */
function chunk(out: Uint8ClampedArray, w: number, h: number, tall: number): void {
  const copy = out.slice();
  for (let y = 0; y < h; y += tall) {
    for (let x = 0; x < w; x += 2) {
      let count = 0;
      let pick = -1;
      for (let dy = 0; dy < tall; dy += 1) {
        for (let dx = 0; dx < 2; dx += 1) {
          const at = ((y + dy) * w + x + dx) * 4;
          if (x + dx >= w || y + dy >= h || (copy[at + 3] ?? 0) === 0) continue;
          count += 1;
          if (pick < 0) pick = at;
        }
      }
      const keep = pick >= 0 && count * 2 >= tall * 2;
      for (let dy = 0; dy < tall; dy += 1) {
        for (let dx = 0; dx < 2; dx += 1) {
          if (x + dx >= w || y + dy >= h) continue;
          const at = ((y + dy) * w + x + dx) * 4;
          for (let k = 0; k < 4; k += 1) out[at + k] = keep ? (copy[pick + k] ?? 0) : 0;
        }
      }
    }
  }
}

function scanlines(out: Uint8ClampedArray, w: number, h: number): void {
  for (let y = 1; y < h; y += 2) {
    for (let x = 0; x < w; x += 1) {
      const at = (y * w + x) * 4;
      out[at] = (out[at] ?? 0) * 0.7;
      out[at + 1] = (out[at + 1] ?? 0) * 0.7;
      out[at + 2] = (out[at + 2] ?? 0) * 0.7;
    }
  }
}

/** A sprite's pixels; `back` paints the face over (a back view). */
function spritePixels(name: string, a: Art, pal: Palette, skin: Skin, back: boolean, swap: Partial<Record<Paint, Paint>>): Uint8ClampedArray {
  const { w, h } = a;
  const out = new Uint8ClampedArray(w * h * 4);
  const colours = a.paint.map((paint) => rgb(pal[swap[paint] ?? paint]));
  for (let y = 0; y < h; y += 1) {
    const row = a.rows[y] ?? '';
    for (let x = 0; x < w; x += 1) {
      let slot = row.charCodeAt(x) - 48;
      if (slot < 1 || slot > 9) continue;
      if (back && (slot === 3 || slot === 4 || slot === 6)) slot = 2;
      const c = colours[slot - 1] ?? colours[0];
      if (!c) continue;
      const at = (y * w + x) * 4;
      out[at] = c[0];
      out[at + 1] = c[1];
      out[at + 2] = c[2];
      out[at + 3] = 255;
    }
  }
  const opaque = (x: number, y: number, from: Uint8ClampedArray) => x >= 0 && y >= 0 && x < w && y < h && (from[(y * w + x) * 4 + 3] ?? 0) > 0;
  if (skin.style === 'chunky') chunk(out, w, h, 1);
  if (skin.style === 'outline' || skin.style === 'neon') {
    // Lines of light: bright edges, a dim inside, a faint glow round it.
    const copy = out.slice();
    const glow = rgb(skin.style === 'neon' ? skin.accent : skin.accentLight);
    const hero = name === 'echo' || name === 'echoSide';
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        const at = (y * w + x) * 4;
        if (opaque(x, y, copy)) {
          const own = hex([copy[at] ?? 0, copy[at + 1] ?? 0, copy[at + 2] ?? 0]);
          const edge = !opaque(x - 1, y, copy) || !opaque(x + 1, y, copy) || !opaque(x, y - 1, copy) || !opaque(x, y + 1, copy);
          const inside = hero ? own : mix(own, '#000000', skin.style === 'outline' ? 0.6 : 0.5);
          const c = rgb(edge ? mix(luma(own) < 60 ? hex(glow) : own, '#ffffff', 0.3) : inside);
          out[at] = c[0];
          out[at + 1] = c[1];
          out[at + 2] = c[2];
          continue;
        }
        let close = false;
        for (let dy = -1; dy <= 1 && !close; dy += 1) for (let dx = -1; dx <= 1 && !close; dx += 1) if (opaque(x + dx, y + dy, copy)) close = true;
        if (!close) continue;
        out[at] = glow[0];
        out[at + 1] = glow[1];
        out[at + 2] = glow[2];
        out[at + 3] = 70;
      }
    }
  }
  if (skin.style === 'glyph' && name !== 'echo' && name !== 'echoSide') scanlines(out, w, h);
  return out;
}

function tiles(ch: number): Record<string, Buf> {
  const out: Record<string, Buf> = {
    floor: floor(ch, 0),
    floor2: floor(ch, 1),
    rug: floor(ch, 2),
    wall: wall(ch, false),
    wallFace: wall(ch, true),
    cracked: cracked(ch, false),
    crackedFace: cracked(ch, true),
    rubble: rubble(ch),
    cliff: cliff(),
    vent0: vent(0),
    vent1: vent(1),
    hazard0: hazard(ch, 0),
    hazard1: hazard(ch, 1),
    door: door(),
    gate: gate(),
    bridgeOn: bridge(true),
    bridgeOff: bridge(false),
    ghostOn: ghostOn(),
    plateUp: plate(false),
    plateDown: plate(true),
    filled: filled(),
    ledge: ledge(ch),
  };
  for (let dir = 0; dir < 4; dir += 1) for (let frame = 0; frame < 4; frame += 1) out[`conv${dir}${frame}`] = conveyor(dir, frame);
  return out;
}

/** Sprites painted again with other paints: relays and lamps lit, the Spoofer's copies. */
const VARIANTS: [string, string, Partial<Record<Paint, Paint>>][] = [
  ['relayOn', 'relay', { hueDark: 'hue', hue: 'hueLight', light: 'light' }],
  ['lanternOn', 'lantern', { hueDark: 'warn', hueLight: 'light' }],
  ['beaconLit', 'beacon', { hue: 'hueLight', light: 'light' }],
  ['heavyLit', 'heavy', { sudo: 'sudoLight' }],
];

export function buildAtlas(skin: Skin, chapter: number, pal: Palette): Atlas {
  const ch = chapter >= 6 ? 0 : chapter;
  type Job = { name: string; w: number; h: number; data: () => Uint8ClampedArray };
  const jobs: Job[] = [];
  for (const [name, a] of Object.entries(ART)) {
    jobs.push({ name, w: a.w, h: a.h, data: () => spritePixels(name, a, pal, skin, false, {}) });
    if (FACED.has(name)) jobs.push({ name: `${name}Up`, w: a.w, h: a.h, data: () => spritePixels(name, a, pal, skin, true, {}) });
  }
  const side = ART.echoSide;
  if (side) jobs.push({ name: 'echoSideL', w: side.w, h: side.h, data: () => mirror(spritePixels('echoSide', side, pal, skin, false, {}), side.w, side.h) });
  for (const [name, from, swap] of VARIANTS) {
    const a = ART[from];
    if (a) jobs.push({ name, w: a.w, h: a.h, data: () => spritePixels(from, a, pal, skin, false, swap) });
  }
  const [decorA, decorB] = DECOR[ch] ?? DECOR[0] ?? [];
  if (decorA) jobs.push({ name: 'decor', w: decorA.w, h: decorA.h, data: () => spritePixels('decor', decorA, pal, skin, false, {}) });
  if (decorB) jobs.push({ name: 'decor2', w: decorB.w, h: decorB.h, data: () => spritePixels('decor2', decorB, pal, skin, false, {}) });
  for (const [name, b] of Object.entries(tiles(ch))) jobs.push({ name, w: S, h: S, data: () => tilePixels(b, pal, skin) });

  // Shelf packing, 256 wide.
  const width = 256;
  let x = 0;
  let y = 0;
  let shelf = 0;
  const frames: Record<string, Frame> = {};
  for (const job of jobs) {
    if (x + job.w > width) {
      x = 0;
      y += shelf;
      shelf = 0;
    }
    frames[job.name] = { x, y, w: job.w, h: job.h };
    x += job.w;
    shelf = Math.max(shelf, job.h);
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = y + shelf;
  const ctx = canvas.getContext('2d');
  if (!ctx) return { canvas, frames, palette: pal };
  const image = ctx.createImageData(width, canvas.height);
  for (const job of jobs) {
    const frame = frames[job.name];
    if (!frame) continue;
    const data = job.data();
    for (let py = 0; py < frame.h; py += 1) {
      const from = py * frame.w * 4;
      image.data.set(data.subarray(from, from + frame.w * 4), ((frame.y + py) * width + frame.x) * 4);
    }
  }
  ctx.putImageData(image, 0, 0);
  return { canvas, frames, palette: pal };
}

function mirror(data: Uint8ClampedArray, w: number, h: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(data.length);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const from = (y * w + x) * 4;
      const to = (y * w + (w - 1 - x)) * 4;
      for (let k = 0; k < 4; k += 1) out[to + k] = data[from + k] ?? 0;
    }
  }
  return out;
}
