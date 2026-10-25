// The scenery behind each zone, painted once per zone into two layers that
// scroll slower than the level.

import { Rng } from './rng';
import { mix, type Skin } from './skin';
import { styled } from './sprites';
import type { Backdrop } from './zones';

export type Layers = { far: HTMLCanvasElement; near: HTMLCanvasElement };

type Painter = {
  ctx: CanvasRenderingContext2D;
  w: number;
  h: number;
  rng: Rng;
  lines: boolean;
};

function box(p: Painter, x: number, y: number, w: number, h: number, colour: string): void {
  p.ctx.fillStyle = colour;
  p.ctx.strokeStyle = colour;
  if (p.lines) p.ctx.strokeRect(Math.round(x) + 0.5, Math.round(y) + 0.5, Math.round(w) - 1, Math.round(h) - 1);
  else p.ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
}

function disc(p: Painter, x: number, y: number, r: number, colour: string): void {
  p.ctx.fillStyle = colour;
  p.ctx.strokeStyle = colour;
  p.ctx.beginPath();
  p.ctx.arc(Math.round(x), Math.round(y), r, 0, Math.PI * 2);
  if (p.lines) p.ctx.stroke();
  else p.ctx.fill();
}

function line(p: Painter, x1: number, y1: number, x2: number, y2: number, colour: string): void {
  p.ctx.strokeStyle = colour;
  p.ctx.beginPath();
  p.ctx.moveTo(Math.round(x1) + 0.5, Math.round(y1) + 0.5);
  p.ctx.lineTo(Math.round(x2) + 0.5, Math.round(y2) + 0.5);
  p.ctx.stroke();
}

type Paint = (p: Painter, far: boolean, colour: string, detail: string) => void;

const PAINTERS: Record<Backdrop, Paint> = {
  board(p, far, colour, detail) {
    for (let i = 0; i < (far ? 7 : 5); i += 1) {
      const x = p.rng.int(p.w);
      const y = p.h * (far ? 0.2 : 0.45) + p.rng.int(p.h * 0.35);
      const w = 14 + p.rng.int(far ? 22 : 16);
      const h = 8 + p.rng.int(10);
      box(p, x, y, w, h, colour);
      for (let leg = 2; leg < w - 1; leg += 3) {
        box(p, x + leg, y - 2, 1, 2, colour);
        box(p, x + leg, y + h, 1, 2, colour);
      }
      if (!far) line(p, x + w, y + h / 2, x + w + 20 + p.rng.int(30), y + h / 2, detail);
    }
  },
  cables(p, far, colour, detail) {
    const gap = far ? 48 : 64;
    for (let x = 0; x < p.w; x += gap) {
      box(p, x, p.h * (far ? 0.3 : 0.4), 2, p.h, colour);
      p.ctx.strokeStyle = detail;
      for (let k = 0; k < 3; k += 1) {
        const y = p.h * (far ? 0.32 : 0.42) + k * 6;
        p.ctx.beginPath();
        p.ctx.moveTo(x + 1, y);
        p.ctx.quadraticCurveTo(x + gap / 2, y + 14 + k * 4, x + gap + 1, y);
        p.ctx.stroke();
      }
    }
  },
  waves(p, far, colour, detail) {
    for (let i = 0; i < (far ? 3 : 2); i += 1) {
      const x = p.rng.int(p.w);
      const top = p.h * (far ? 0.35 : 0.5);
      line(p, x, top, x - 8, p.h, colour);
      line(p, x, top, x + 8, p.h, colour);
      for (let y = top + 8; y < p.h; y += 10) line(p, x - (8 * (y - top)) / (p.h - top), y, x + (8 * (y - top)) / (p.h - top), y, colour);
      if (far) {
        p.ctx.strokeStyle = detail;
        for (let r = 8; r < 60; r += 10) {
          p.ctx.beginPath();
          p.ctx.arc(x, top, r, Math.PI * 1.15, Math.PI * 1.85);
          p.ctx.stroke();
        }
      }
    }
  },
  tunnel(p, far, colour) {
    const gap = far ? 40 : 72;
    for (let x = 0; x < p.w; x += gap) {
      box(p, x, p.h * 0.25, far ? 6 : 10, p.h, colour);
      p.ctx.strokeStyle = colour;
      p.ctx.lineWidth = far ? 2 : 4;
      p.ctx.beginPath();
      p.ctx.arc(x + gap / 2, p.h * 0.3, gap / 2, Math.PI, 0);
      p.ctx.stroke();
      p.ctx.lineWidth = 1;
    }
  },
  clouds(p, far, colour) {
    for (let i = 0; i < (far ? 6 : 4); i += 1) {
      const x = p.rng.int(p.w);
      const y = p.h * (far ? 0.15 : 0.3) + p.rng.int(p.h * 0.4);
      const r = far ? 7 + p.rng.int(6) : 9 + p.rng.int(8);
      disc(p, x, y, r, colour);
      disc(p, x + r, y + 3, r * 0.8, colour);
      disc(p, x - r, y + 3, r * 0.7, colour);
      box(p, x - r * 1.6, y + 3, r * 3.4, r * 0.7, colour);
    }
  },
  racks(p, far, colour, detail) {
    const width = far ? 18 : 26;
    for (let x = 2; x < p.w; x += width + (far ? 6 : 14)) {
      const top = p.h * (far ? 0.25 : 0.38) + p.rng.int(10);
      box(p, x, top, width, p.h - top, colour);
      for (let y = top + 4; y < p.h - 4; y += 6) {
        box(p, x + 2, y, width - 4, 1, detail);
        if (!far && p.rng.chance(0.5)) box(p, x + width - 5, y + 2, 2, 1, detail);
      }
    }
  },
  fiber(p, far, colour, detail) {
    for (let i = 0; i < (far ? 14 : 6); i += 1) {
      const y = p.rng.int(p.h * 0.8);
      const x = p.rng.int(p.w);
      const length = 20 + p.rng.int(far ? 60 : 30);
      line(p, x, y, x + length, y, i % 3 === 0 ? detail : colour);
    }
    if (!far) for (let x = 0; x < p.w; x += 90) box(p, x, p.h * 0.45, 3, p.h, colour);
  },
  tapes(p, far, colour, detail) {
    for (let i = 0; i < (far ? 6 : 3); i += 1) {
      const x = p.rng.int(p.w);
      const y = p.h * (far ? 0.25 : 0.45) + p.rng.int(p.h * 0.3);
      const r = far ? 6 : 10;
      disc(p, x, y, r, colour);
      disc(p, x + r * 2.4, y, r, colour);
      disc(p, x, y, r * 0.35, detail);
      disc(p, x + r * 2.4, y, r * 0.35, detail);
      box(p, x - r, y + r, r * 4.4, 2, colour);
    }
  },
  flames(p, far, colour, detail) {
    if (far) {
      const row = p.lines ? 12 : 6;
      for (let y = Math.floor(p.h * 0.3); y < p.h; y += row) {
        for (let x = (y / row) % 2 === 0 ? 0 : -row; x < p.w; x += row * 2) box(p, x, y, row * 2 - 1, row - 1, colour);
      }
      return;
    }
    for (let i = 0; i < 8; i += 1) {
      const x = p.rng.int(p.w);
      const h = 14 + p.rng.int(18);
      p.ctx.fillStyle = i % 2 === 0 ? colour : detail;
      p.ctx.beginPath();
      p.ctx.moveTo(x - 6, p.h);
      p.ctx.quadraticCurveTo(x - 4, p.h - h * 0.6, x, p.h - h);
      p.ctx.quadraticCurveTo(x + 4, p.h - h * 0.6, x + 6, p.h);
      p.ctx.fill();
    }
  },
  stars(p, far, colour, detail) {
    for (let i = 0; i < (far ? 70 : 24); i += 1) box(p, p.rng.int(p.w), p.rng.int(p.h), 1, 1, i % 5 === 0 ? detail : colour);
    if (!far) {
      disc(p, p.rng.int(p.w), p.h * 0.3, 12, colour);
      const x = p.rng.int(p.w);
      box(p, x, p.h * 0.6, 10, 4, detail);
      line(p, x + 5, p.h * 0.6, x + 5, p.h * 0.5, detail);
    }
  },
};

function layer(skin: Skin, backdrop: Backdrop, seed: number, w: number, h: number, far: boolean): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  ctx.imageSmoothingEnabled = false;
  const lines = skin.style === 'outline' || skin.style === 'neon';
  const base = far ? mix(skin.sky, skin.far, 0.7) : mix(skin.sky, skin.near, 0.85);
  const detail = far ? mix(skin.sky, skin.dim, 0.35) : mix(skin.sky, skin.dim, 0.5);
  ctx.lineWidth = 1;
  // The same scene three times, a layer apart, so it wraps without a seam.
  for (const shift of [-w, 0, w]) {
    ctx.setTransform(1, 0, 0, 1, shift, 0);
    const painter: Painter = { ctx, w, h, rng: new Rng(seed + (far ? 1 : 2)), lines };
    PAINTERS[backdrop](painter, far, styled(skin, lines ? mix(skin.sky, skin.accentLight, far ? 0.25 : 0.45) : base), styled(skin, detail));
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  return canvas;
}

export function paintBackdrop(skin: Skin, backdrop: Backdrop, seed: number, w: number, h: number): Layers {
  return { far: layer(skin, backdrop, seed, w, h, true), near: layer(skin, backdrop, seed, w, h, false) };
}
