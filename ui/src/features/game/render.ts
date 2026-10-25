// Draws the game on a small canvas (160 or so pixels wide, 144 tall) that
// the page scales up in whole steps. The room's still tiles are painted
// once into a few wide canvases and patched where a tile changes; each
// frame then draws the backdrop, those canvases, the moving tiles, the
// entities, the sparkle, the zone's twists (darkness, water, the purge)
// and the score along the top.

import { type Layers, paintBackdrop } from './backdrops';
import { BOSS_NAME, maxBossHp } from './boss';
import { EV, EVENT_STRIDE } from './events';
import { ADVANCE } from './font';
import { K } from './kinds';
import { Rng } from './rng';
import type { Ent, Play } from './sim';
import { POWER } from './sim';
import { mix, type Skin } from './skin';
import { type Atlas, buildAtlas, type Frame, styled } from './sprites';
import * as tiles from './tiles';
import { clock, type HopRecord, type MapNode, PANEL_Y, type WorldMap, ZONE_W } from './world';
import type { Zone } from './zones';

const { T, TILE } = tiles;

const SEGMENT = 64;
const PARTICLES = 180;
/** Particle fields: x, y, vx, vy, life left, kind, colour, value. */
const PF = 8;

const P_DUST = 0;
const P_CHUNK = 1;
const P_SPARK = 2;
const P_TEXT = 3;
const P_BUBBLE = 4;
const P_STREAK = 5;
const P_CONFETTI = 6;
const P_SMOKE = 7;

/** What the canvas shows besides the level (the map shows no level). */
export type Screen = 'title' | 'card' | 'play' | 'paused' | 'over' | 'map';

/** The title's line about the world map, which a tap opens. */
export const TITLE_MAP_Y = 98;

// Sprite names worked out once, so drawing a frame makes no new strings.
const BIT_FRAMES = ['bit1', 'bit3', 'bit2', 'bit3'];
const POSES = ['idle', 'run1', 'run2', 'jump', 'skid', 'dead'] as const;
type Pose = (typeof POSES)[number];
const PLAYER_NAMES: Record<string, Record<Pose, string>> = {};
for (const prefix of ['s_', 'ss_', 'b_', 'bp_', 'bf_', 'bs_']) {
  PLAYER_NAMES[prefix] = Object.fromEntries(POSES.map((pose) => [pose, `${prefix}${pose}`])) as Record<Pose, string>;
}
const BOSS_FRAMES: Record<string, string[]> = Object.fromEntries(
  ['hopper', 'swooper', 'charger', 'burrower', 'swarm'].map((kind) => [kind, [`${kind}1`, `${kind}2`]]),
);

/** Tiles that animate or change look with the switch and the beat, drawn each frame. */
function animated(id: number): boolean {
  return (
    id === T.QBIT ||
    id === T.QPOWER ||
    id === T.QKEY ||
    id === T.LIQUID ||
    id === T.CONV_R ||
    id === T.CONV_L ||
    id === T.SWITCH ||
    id === T.RED ||
    id === T.BLUE ||
    id === T.BEAT_A ||
    id === T.BEAT_B ||
    id === T.FLIP ||
    id === T.BIT ||
    id === T.KEY ||
    id === T.SPRING ||
    id === T.WATER
  );
}

function terrain(id: number): boolean {
  return id === T.GROUND || id === T.FAKE || id === T.ICE || id === T.HARD;
}

export class Renderer {
  readonly ctx: CanvasRenderingContext2D;
  w = 160;
  h = 144;
  skin: Skin | null = null;
  private atlas: Atlas | null = null;
  private hue = -1;
  motion = true;
  private frame = 0;

  private segments: HTMLCanvasElement[] = [];
  private cacheTiles: Uint8Array | null = null;
  private drawn = new Uint8Array(0);
  private moving: number[] = [];
  private layers: Layers | null = null;
  private layersKey = '';
  private darkness: HTMLCanvasElement | null = null;
  private light: HTMLCanvasElement | null = null;
  private lightRadius = 0;
  private readonly parts = new Float32Array(PARTICLES * PF);
  /** The words a floating-text particle shows, by slot. */
  private readonly words: string[] = new Array<string>(PARTICLES).fill('');
  private nextPart = 0;
  private flash = 0;
  private readonly fx = new Rng(7);
  private palette: string[] = [];

  constructor(readonly canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('The game needs a 2D canvas, and this browser gave none.');
    this.ctx = ctx;
  }

  resize(w: number, h: number): void {
    if (w === this.w && h === this.h && this.canvas.width === w) return;
    this.w = w;
    this.h = h;
    this.canvas.width = w;
    this.canvas.height = h;
    this.ctx.imageSmoothingEnabled = false;
    this.layersKey = '';
    this.darkness = null;
  }

  setSkin(skin: Skin, motion: boolean): void {
    this.skin = skin;
    this.motion = motion;
    this.atlas = null;
    this.hue = -1;
    this.cacheTiles = null;
    this.layersKey = '';
    this.light = null;
    this.palette = [skin.dim, skin.light, skin.warn, skin.accentLight, skin.dangerLight, skin.ok, skin.hues[3] ?? skin.accent, skin.hues[6] ?? skin.warn].map((colour) => styled(skin, colour));
  }

  private ensure(play: Play): Atlas | null {
    const skin = this.skin;
    if (!skin) return null;
    const zone = play.level.zone;
    if (!this.atlas || this.hue !== zone.hue) {
      this.atlas = buildAtlas(skin, zone.hue);
      this.hue = zone.hue;
      this.cacheTiles = null;
    }
    const key = `${zone.index}:${zone.backdrop}:${this.w}:${this.h}`;
    if (key !== this.layersKey) {
      this.layers = paintBackdrop(skin, zone.backdrop, zone.index * 31 + play.seed, Math.max(256, this.w * 2), this.h);
      this.layersKey = key;
    }
    if (this.cacheTiles !== play.grid.tiles) this.buildCache(play);
    return this.atlas;
  }

  private buildCache(play: Play): void {
    const g = play.grid;
    this.cacheTiles = g.tiles;
    this.drawn = new Uint8Array(g.tiles.length);
    this.segments = [];
    const count = Math.ceil(g.w / SEGMENT);
    for (let s = 0; s < count; s += 1) {
      const canvas = document.createElement('canvas');
      canvas.width = Math.min(SEGMENT, g.w - s * SEGMENT) * TILE;
      canvas.height = g.h * TILE;
      const ctx = canvas.getContext('2d');
      if (ctx) ctx.imageSmoothingEnabled = false;
      this.segments.push(canvas);
    }
    for (let ty = 0; ty < g.h; ty += 1) for (let tx = 0; tx < g.w; tx += 1) this.paintTile(play, tx, ty);
    this.drawn.set(g.tiles);
    this.listMoving(play);
  }

  private listMoving(play: Play): void {
    this.moving = [];
    play.grid.tiles.forEach((id, i) => {
      if (animated(id)) this.moving.push(i);
    });
  }

  /** Repaints the still tiles that changed since the last frame (a broken brick, a used block). */
  private patchCache(play: Play): void {
    const g = play.grid;
    let changed = false;
    for (let i = 0; i < g.tiles.length; i += 1) {
      if (g.tiles[i] === this.drawn[i]) continue;
      changed = true;
      const tx = i % g.w;
      const ty = Math.floor(i / g.w);
      for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) this.paintTile(play, tx + dx, ty + dy);
    }
    if (!changed) return;
    this.drawn.set(g.tiles);
    this.listMoving(play);
  }

  private paintTile(play: Play, tx: number, ty: number): void {
    const g = play.grid;
    if (tx < 0 || ty < 0 || tx >= g.w || ty >= g.h) return;
    const canvas = this.segments[Math.floor(tx / SEGMENT)];
    const ctx = canvas?.getContext('2d');
    const skin = this.skin;
    const atlas = this.atlas;
    if (!ctx || !skin || !atlas) return;
    const x = (tx % SEGMENT) * TILE;
    const y = ty * TILE;
    ctx.clearRect(x, y, TILE, TILE);
    const id = g.tiles[ty * g.w + tx] ?? T.EMPTY;
    const at = (dx: number, dy: number) => {
      const nx = tx + dx;
      const ny = ty + dy;
      if (nx < 0 || nx >= g.w) return T.HARD;
      if (ny < 0 || ny >= g.h) return ny < 0 ? T.EMPTY : T.GROUND;
      return g.tiles[ny * g.w + nx] ?? T.EMPTY;
    };
    if (terrain(id) && skin.style !== 'pixel' && skin.style !== 'lcd' && skin.style !== 'mosaic' && skin.style !== 'chunky') {
      this.paintTerrain(ctx, x, y, id, at, tx, ty);
      return;
    }
    let name: string | null = null;
    switch (id) {
      case T.GROUND:
      case T.FAKE:
        name = terrain(at(0, -1)) ? 'ground' : 'groundTop';
        break;
      case T.BRICK:
      case T.MULTI:
        name = 'brick';
        break;
      case T.USED:
        name = 'used';
        break;
      case T.HARD:
        name = 'hard';
        break;
      case T.ONEWAY:
        name = 'oneway';
        break;
      case T.SPIKE:
        name = 'spike';
        break;
      case T.ICE:
        name = 'ice';
        break;
      case T.PIPE_TL:
      case T.WARP:
        name = 'pipeTL';
        break;
      case T.PIPE_TR:
        name = 'pipeTR';
        break;
      case T.PIPE_L:
        name = 'pipeL';
        break;
      case T.PIPE_R:
        name = 'pipeR';
        break;
      case T.DECOR_A:
        name = 'decorA';
        break;
      case T.DECOR_B:
        name = 'decorB';
        break;
      case T.DECOR_C:
        name = 'decorC';
        break;
      case T.GATE_SHUT:
        name = 'gate';
        break;
      case T.LIQUID:
        if (at(0, -1) === T.LIQUID) {
          ctx.fillStyle = styled(skin, skin.danger);
          ctx.fillRect(x, y, TILE, TILE);
        }
        return;
      default:
        return;
    }
    const frame = atlas.right[name];
    if (frame) ctx.drawImage(atlas.canvas, frame.x, frame.y, frame.w, frame.h, x, y, frame.w, frame.h);
  }

  /** Ground in the line-drawn, bevelled and matrix themes: shaped by its neighbours. */
  private paintTerrain(ctx: CanvasRenderingContext2D, x: number, y: number, id: number, at: (dx: number, dy: number) => number, tx: number, ty: number): void {
    const skin = this.skin;
    if (!skin) return;
    const hue = skin.hues[this.hue % skin.hues.length] ?? skin.accent;
    const open = (dx: number, dy: number) => !terrain(at(dx, dy));
    if (skin.style === 'bevel') {
      ctx.fillStyle = id === T.HARD ? '#888888' : skin.ground;
      ctx.fillRect(x, y, TILE, TILE);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(x, y, TILE, 1);
      ctx.fillRect(x, y, 1, TILE);
      ctx.fillStyle = skin.groundDark;
      ctx.fillRect(x, y + TILE - 1, TILE, 1);
      ctx.fillRect(x + TILE - 1, y, 1, TILE);
      if (open(0, -1) && id !== T.HARD) {
        ctx.fillStyle = hue;
        ctx.fillRect(x + 1, y + 1, TILE - 2, 2);
      }
      return;
    }
    if (skin.style === 'glyph') {
      ctx.fillStyle = '#001a08';
      ctx.fillRect(x, y, TILE, TILE);
      const glyphs = '01234567892ABZ7';
      const ch = glyphs[(tx * 7 + ty * 13) % glyphs.length] ?? '0';
      this.glyph(ctx, ch, x + 2, y + 1, '#0a6b25');
      if (open(0, -1)) {
        ctx.fillStyle = skin.accent;
        ctx.fillRect(x, y, TILE, 1);
      }
      return;
    }
    // Vector and neon: dark inside, a bright line along every open side.
    const line = skin.style === 'neon' ? (id === T.HARD ? skin.accentLight : skin.accent) : id === T.HARD ? skin.dim : skin.accentLight;
    ctx.fillStyle = skin.style === 'neon' ? mix(skin.bg, skin.accent, 0.08) : '#000000';
    ctx.fillRect(x, y, TILE, TILE);
    ctx.fillStyle = line;
    if (open(0, -1)) ctx.fillRect(x, y, TILE, 1);
    if (open(0, 1)) ctx.fillRect(x, y + TILE - 1, TILE, 1);
    if (open(-1, 0)) ctx.fillRect(x, y, 1, TILE);
    if (open(1, 0)) ctx.fillRect(x + TILE - 1, y, 1, TILE);
    ctx.fillStyle = mix(skin.bg, line, 0.3);
    if (open(0, -1)) ctx.fillRect(x, y + 1, TILE, 1);
    if (skin.style === 'outline' && (tx + ty) % 3 === 0 && !open(0, -1)) ctx.fillRect(x + 3, y + 3, 1, 1);
  }

  /** One glyph of the font straight onto a canvas (for scenery). */
  private glyph(ctx: CanvasRenderingContext2D, ch: string, x: number, y: number, colour: string): void {
    const atlas = this.atlas;
    const frame = atlas?.font[0]?.[ch];
    if (!atlas || !frame) return;
    ctx.globalAlpha = 0.9;
    ctx.drawImage(atlas.canvas, frame.x, frame.y, frame.w, frame.h, x, y, frame.w, frame.h);
    ctx.globalAlpha = 1;
    ctx.fillStyle = colour;
    ctx.globalCompositeOperation = 'source-atop';
    ctx.fillRect(x, y, frame.w, frame.h);
    ctx.globalCompositeOperation = 'source-over';
  }

  private emit(kind: number, x: number, y: number, vx: number, vy: number, life: number, colour: number, value = 0): void {
    const at = this.nextPart * PF;
    this.parts[at] = x;
    this.parts[at + 1] = y;
    this.parts[at + 2] = vx;
    this.parts[at + 3] = vy;
    this.parts[at + 4] = life;
    this.parts[at + 5] = kind;
    this.parts[at + 6] = colour;
    this.parts[at + 7] = value;
    if (kind === P_TEXT) this.words[this.nextPart] = value === -1 ? '1UP' : value === -2 ? 'KEY!' : String(value);
    this.nextPart = (this.nextPart + 1) % PARTICLES;
  }

  private burst(kind: number, x: number, y: number, count: number, speed: number, life: number, colour: number): void {
    for (let i = 0; i < count; i += 1) {
      const angle = this.fx.next() * Math.PI * 2;
      const pace = speed * (0.4 + this.fx.next() * 0.6);
      this.emit(kind, x, y, Math.cos(angle) * pace, Math.sin(angle) * pace - (kind === P_CHUNK ? 1.6 : 0), life, colour);
    }
  }

  /** Turns a tick's events into sparkle. */
  effects(play: Play): void {
    const ev = play.events;
    for (let i = 0; i < ev.count; i += 1) {
      const at = i * EVENT_STRIDE;
      const what = ev.data[at] ?? 0;
      const x = ev.data[at + 1] ?? 0;
      const y = ev.data[at + 2] ?? 0;
      const value = ev.data[at + 3] ?? 0;
      switch (what) {
        case EV.JUMP:
        case EV.FLAP:
          this.burst(P_DUST, x + 3, y + play.body.h, 3, 0.6, 14, 0);
          break;
        case EV.LAND:
        case EV.SKID:
          this.burst(P_DUST, x, y, what === EV.LAND ? 4 : 1, 0.7, 12, 0);
          break;
        case EV.BOSS_LAND:
          this.burst(P_DUST, x, y, 14, 1.6, 22, 0);
          break;
        case EV.STOMP:
        case EV.KILL:
          this.burst(P_SPARK, x, y, 5, 1.4, 16, 1);
          break;
        case EV.BIT:
          this.burst(P_SPARK, x, y, 3, 0.9, 12, 2);
          break;
        case EV.KEY:
          this.burst(P_SPARK, x, y, 12, 1.6, 26, 2);
          this.emit(P_TEXT, x - 6, y - 6, 0, -0.4, 50, 2, -2);
          break;
        case EV.LIFE:
          this.emit(P_TEXT, x - 6, y - 6, 0, -0.4, 60, 5, -1);
          break;
        case EV.BREAK:
          for (let k = 0; k < 4; k += 1) this.emit(P_CHUNK, x, y, (k % 2 === 0 ? -1 : 1) * (0.6 + k * 0.2), -2.4 - (k > 1 ? 0.8 : 0), 50, 7);
          break;
        case EV.SCORE:
          if (value >= 100) this.emit(P_TEXT, x, y - 4, 0, -0.5, 40, 1, value);
          break;
        case EV.SPLASH:
          this.burst(P_SPARK, x, y, 3, 0.8, 10, 3);
          break;
        case EV.SWIM:
          this.emit(P_BUBBLE, x + 3, y, 0, -0.4, 50, 3);
          break;
        case EV.SPRING:
          this.burst(P_DUST, x + 3, y, 5, 1.2, 14, 1);
          break;
        case EV.BOSS_HIT:
          this.burst(P_SMOKE, x, y, 10, 1.4, 26, 4);
          this.flash = this.motion ? 4 : 0;
          break;
        case EV.BOSS_DIE:
          this.burst(P_SMOKE, x, y, 26, 2.4, 40, 4);
          this.burst(P_CONFETTI, x, y, 24, 2.6, 80, 6);
          this.flash = this.motion ? 6 : 0;
          break;
        case EV.CLEAR:
        case EV.SECRET:
          this.burst(P_CONFETTI, x, y - 20, 30, 2.2, 90, 6);
          break;
        case EV.POWER:
        case EV.GROW:
        case EV.LOCK:
          this.burst(P_SPARK, x + 3, y + 4, 10, 1.8, 20, 5);
          break;
        case EV.CHECK:
          this.burst(P_SPARK, x + 4, y, 10, 1.4, 24, 5);
          break;
        default:
          break;
      }
    }
    // Wind streaks while a gust blows.
    const gust = play.gust();
    if (gust !== 0 && this.fx.next() < 0.5) {
      this.emit(P_STREAK, gust > 0 ? play.camX - 4 : play.camX + this.w + 4, play.camY + this.fx.next() * this.h, gust * (3 + this.fx.next() * 2), 0, 70, 0);
    }
    if (play.grid.waterLine >= 0 && this.fx.next() < 0.03) {
      this.emit(P_BUBBLE, play.camX + this.fx.next() * this.w, play.camY + this.h, 0, -0.3, 160, 3);
    }
  }

  private spr(name: string, x: number, y: number, left = false, w = 0, h = 0): Frame | null {
    const atlas = this.atlas;
    const frame = atlas ? (left ? atlas.left : atlas.right)[name] : undefined;
    if (!atlas || !frame) return null;
    const dw = w || frame.w;
    const dh = h || frame.h;
    this.ctx.drawImage(atlas.canvas, frame.x, frame.y, frame.w, frame.h, Math.round(x), Math.round(y), dw, dh);
    return frame;
  }

  /** Text in the game's font (capitals); ink 0 plain, 1 dim, 2 highlight, 3 dark. */
  text(text: string, x: number, y: number, ink = 0, shadow = true): void {
    const atlas = this.atlas;
    if (!atlas) return;
    const glyphs = atlas.font[ink];
    const dark = atlas.font[3];
    for (let i = 0; i < text.length; i += 1) {
      const ch = text[i] ?? ' ';
      const gx = Math.round(x + i * ADVANCE);
      if (shadow && ink !== 3) {
        const back = dark?.[ch];
        if (back) this.ctx.drawImage(atlas.canvas, back.x, back.y, back.w, back.h, gx + 1, Math.round(y) + 1, back.w, back.h);
      }
      const frame = glyphs?.[ch];
      if (frame) this.ctx.drawImage(atlas.canvas, frame.x, frame.y, frame.w, frame.h, gx, Math.round(y), frame.w, frame.h);
    }
  }

  centered(text: string, y: number, ink = 0, scale = 1): void {
    if (scale === 1) {
      this.text(text, Math.round((this.w - (text.length * ADVANCE - 1)) / 2), y, ink);
      return;
    }
    // Big type: draw small, then scale it up from a scratch strip.
    const ctx = this.ctx;
    const width = text.length * ADVANCE;
    const x = Math.round((this.w - width * scale) / 2);
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(scale, scale);
    this.text(text, 0, 0, ink);
    ctx.restore();
  }

  draw(play: Play, screen: Screen, info: { best: number; muted: boolean; title: string; card: number }): void {
    const atlas = this.ensure(play);
    const skin = this.skin;
    if (!atlas || !skin) return;
    this.frame += 1;
    this.patchCache(play);
    const ctx = this.ctx;
    const shake = this.motion && play.shake > 0 ? Math.min(3, play.shake * 0.4) : 0;
    const camX = Math.round(play.camX + (shake ? (this.fx.next() - 0.5) * shake * 2 : 0));
    const camY = Math.round(play.camY + (shake ? (this.fx.next() - 0.5) * shake * 2 : 0));

    // Sky and scenery.
    ctx.fillStyle = styled(skin, skin.sky);
    ctx.fillRect(0, 0, this.w, this.h);
    if (skin.style === 'glyph') this.rain();
    const layers = this.layers;
    if (layers) {
      this.scenery(layers.far, camX * 0.25, camY * 0.1);
      this.scenery(layers.near, camX * 0.5, camY * 0.25);
    }

    // The room: outside a narrow climb, walls.
    const g = play.grid;
    if (-camX > 0 || g.w * TILE - camX < this.w) {
      ctx.fillStyle = styled(skin, skin.groundDark);
      if (-camX > 0) ctx.fillRect(0, 0, -camX, this.h);
      if (g.w * TILE - camX < this.w) ctx.fillRect(g.w * TILE - camX, 0, this.w, this.h);
    }
    const first = Math.max(0, Math.floor(camX / (SEGMENT * TILE)));
    const last = Math.min(this.segments.length - 1, Math.floor((camX + this.w) / (SEGMENT * TILE)));
    for (let s = first; s <= last; s += 1) {
      const segment = this.segments[s];
      if (segment) ctx.drawImage(segment, s * SEGMENT * TILE - camX, -camY);
    }
    this.movingTiles(play, camX, camY);

    for (const e of play.ents) if (e.k !== 0) this.ent(play, e, camX, camY);
    if (play.mode !== 'over') this.player(play, camX, camY);
    this.particles(camX, camY);

    // Twists drawn over everything.
    if (g.waterLine >= 0) {
      const top = g.waterLine * TILE - camY;
      ctx.fillStyle = styled(skin, skin.hues[2] ?? skin.accent);
      ctx.globalAlpha = 0.16;
      ctx.fillRect(0, Math.max(0, top), this.w, this.h);
      ctx.globalAlpha = 0.6;
      for (let x = 0; x < this.w; x += 4) ctx.fillRect(x, top + Math.round(Math.sin((x + this.frame) * 0.15)), 2, 1);
      ctx.globalAlpha = 1;
    }
    this.purge(play, camX, camY);
    if (play.level.dark > 0 && play.main) this.dark(play, camX, camY);
    if (this.flash > 0) {
      this.flash -= 1;
      ctx.fillStyle = '#ffffff';
      ctx.globalAlpha = 0.25;
      ctx.fillRect(0, 0, this.w, this.h);
      ctx.globalAlpha = 1;
    }
    this.hud(play);
    this.screens(play, screen, info);
  }

  private scenery(layer: HTMLCanvasElement, x: number, y: number): void {
    const w = layer.width;
    const h = layer.height;
    const ox = -(((x % w) + w) % w);
    const oy = -(((y % h) + h) % h);
    for (let dx = ox; dx < this.w; dx += w) {
      this.ctx.drawImage(layer, dx, oy);
      if (oy + h < this.h) this.ctx.drawImage(layer, dx, oy + h);
    }
  }

  /** The matrix's code rain behind the level. */
  private rain(): void {
    const atlas = this.atlas;
    const font = atlas?.font[1];
    if (!atlas || !font) return;
    const glyphs = 'ABZ0123456789@#*';
    const speed = this.motion ? this.frame : 0;
    this.ctx.globalAlpha = 0.35;
    for (let column = 0; column < this.w / 6; column += 1) {
      const fall = (column * 37 + Math.floor(speed * (0.3 + (column % 3) * 0.15))) % (this.h + 40);
      for (let k = 0; k < 4; k += 1) {
        const frame = font[glyphs[(column * 5 + k + Math.floor(speed / 20)) % glyphs.length] ?? '0'];
        if (frame) this.ctx.drawImage(atlas.canvas, frame.x, frame.y, frame.w, frame.h, column * 6, fall - k * 7, frame.w, frame.h);
      }
    }
    this.ctx.globalAlpha = 1;
  }

  private movingTiles(play: Play, camX: number, camY: number): void {
    const g = play.grid;
    const skin = this.skin;
    if (!skin) return;
    const blink = play.level.beatTicks > 0 && play.tick % play.level.beatTicks > play.level.beatTicks - 24 && Math.floor(play.tick / 4) % 2 === 0;
    for (const i of this.moving) {
      const tx = i % g.w;
      const ty = Math.floor(i / g.w);
      const x = tx * TILE - camX;
      const y = ty * TILE - camY;
      if (x < -TILE || x > this.w || y < -TILE || y > this.h) continue;
      const id = g.tiles[i] ?? T.EMPTY;
      const tick = play.tick;
      switch (id) {
        case T.QBIT:
        case T.QPOWER:
        case T.QKEY:
          this.spr(Math.floor(tick / 12) % 4 === 0 ? 'qblock2' : 'qblock1', x, y);
          break;
        case T.LIQUID:
          if ((g.tiles[i - g.w] ?? T.EMPTY) !== T.LIQUID) this.spr(Math.floor(tick / 16) % 2 === 0 ? 'liquid1' : 'liquid2', x, y);
          break;
        case T.CONV_R:
        case T.CONV_L:
          this.spr(Math.floor(tick / 6) % 2 === 0 ? 'conv1' : 'conv2', x, y, id === T.CONV_L);
          break;
        case T.SWITCH:
          this.spr(play.switchOn ? 'switchOn' : 'switchOff', x, y);
          break;
        case T.RED:
          this.spr(play.switchOn ? 'red' : 'redOff', x, y);
          break;
        case T.BLUE:
          this.spr(play.switchOn ? 'blueOff' : 'blue', x, y);
          break;
        case T.BEAT_A:
        case T.BEAT_B: {
          const on = (id === T.BEAT_A) === (play.beat === 0);
          this.spr(on && !blink ? (id === T.BEAT_A ? 'beatA' : 'beatB') : 'beatOff', x, y);
          break;
        }
        case T.FLIP:
          this.ctx.fillStyle = styled(skin, skin.hues[3] ?? skin.accent);
          this.ctx.globalAlpha = 0.14;
          this.ctx.fillRect(x, y, TILE, TILE);
          this.ctx.globalAlpha = 1;
          if ((tx + ty) % 3 === 0) this.spr('flip', x, y - ((Math.floor(tick / 6) + ty) % 8) + 4);
          break;
        case T.BIT:
          this.spr(BIT_FRAMES[Math.floor((tick + tx * 3) / 8) % 4] ?? 'bit1', x + 1, y);
          break;
        case T.KEY:
          this.spr('key', x, y + Math.round(Math.sin(tick * 0.08) * 1.5));
          break;
        case T.SPRING: {
          const b = play.body;
          const pressed = b.onGround && Math.floor((b.y + b.h + 1) / TILE) === ty && Math.abs(b.x + 3 - (tx * TILE + 4)) < 7;
          this.spr(pressed ? 'spring2' : 'spring1', x, y);
          break;
        }
        case T.WATER:
          this.ctx.fillStyle = styled(skin, skin.hues[2] ?? skin.accent);
          this.ctx.globalAlpha = 0.28;
          this.ctx.fillRect(x, y, TILE, TILE);
          this.ctx.globalAlpha = 1;
          break;
        default:
          break;
      }
    }
  }

  private ent(play: Play, e: Ent, camX: number, camY: number): void {
    const x = e.x - camX;
    const y = e.y - camY;
    if (x < -40 || x > this.w + 40 || y < -100 || y > this.h + 40) return;
    const tick = play.tick;
    const step = Math.floor((tick + e.ox) / 8) % 2;
    const left = e.dir < 0;
    const dying = e.state === -2;
    const name = this.entSprite(play, e, step);
    if (e.k === K.GOAL) return this.goal(play, e, x, y);
    if (e.k === K.PLAT_H || e.k === K.PLAT_V || e.k === K.PLAT_FALL) {
      const shakeX = e.k === K.PLAT_FALL && e.state === 1 && this.motion ? (tick % 4 < 2 ? 1 : -1) : 0;
      for (let k = 0; k < e.c; k += 1) this.spr(e.k === K.PLAT_FALL ? 'platFall' : 'plat', x + k * TILE + shakeX, y);
      return;
    }
    if (e.k === K.BOSS) return this.boss(play, e, x, y, step);
    if (!name) return;
    const atlas = this.atlas;
    const frame = atlas ? (left ? atlas.left : atlas.right)[name] : undefined;
    if (!frame || !atlas) return;
    const dx = x + e.w / 2 - frame.w / 2;
    const dy = y + e.h - frame.h;
    if (e.k === K.LOCK && Math.floor(tick / 3) % 2 === 0) return;
    if (dying) {
      // Knocked off: upside down.
      this.ctx.save();
      this.ctx.translate(Math.round(dx), Math.round(dy + frame.h));
      this.ctx.scale(1, -1);
      this.ctx.drawImage(atlas.canvas, frame.x, frame.y, frame.w, frame.h, 0, 0, frame.w, frame.h);
      this.ctx.restore();
      return;
    }
    if (e.state === -1 && e.k !== K.CRAWLER) {
      this.spr(name, dx, dy + frame.h / 2, left, frame.w, Math.ceil(frame.h / 2));
      return;
    }
    this.spr(name, dx, dy, left);
  }

  private entSprite(play: Play, e: Ent, step: number): string | null {
    switch (e.k) {
      case K.CRAWLER:
        return e.state === -1 ? 'flat' : step ? 'crawler2' : 'crawler1';
      case K.ZIP:
        return step ? 'zip2' : 'zip1';
      case K.SHELL:
        return 'shell';
      case K.MOTH:
        return Math.floor(play.tick / 5) % 2 ? 'moth2' : 'moth1';
      case K.FLEA:
        return e.onGround ? 'flea1' : 'flea2';
      case K.WORM:
        return step ? 'worm2' : 'worm1';
      case K.VIRUS:
        return step ? 'virus2' : 'virus1';
      case K.SPAMMER:
        return e.t > 92 ? 'spammer2' : 'spammer1';
      case K.CRON:
        return 'cron';
      case K.LEAK:
        return 'leak';
      case K.PHISH:
        return step ? 'phish2' : 'phish1';
      case K.SHOT_PING:
        return 'ping';
      case K.SHOT_SPAM:
        return 'spam';
      case K.SHOT_BULLET:
        return 'bullet';
      case K.SHOT_DROP:
        return 'drop';
      case K.SHOT_BOSS:
        return 'orb';
      case K.SHOT_WAVE:
        return 'wave';
      case K.RAM:
        return 'ram';
      case K.PING:
        return 'pingItem';
      case K.FAN:
        return 'fanItem';
      case K.LOCK:
        return 'lock';
      case K.LIFE:
        return 'life';
      case K.POP_BIT:
        return BIT_FRAMES[Math.floor(e.t / 3) % 4] ?? 'bit1';
      case K.POP_KEY:
        return 'key';
      case K.CHECKPOINT:
        return e.state === 1 ? 'checkUp' : 'checkDown';
      case K.BACKDOOR:
        return 'door';
      default:
        return null;
    }
  }

  private goal(play: Play, e: Ent, x: number, y: number): void {
    for (let py = y + 8; py < y + e.h; py += TILE) this.spr('pole', x - 1, py);
    this.spr('poleTop', x - 1, y);
    const slid = play.mode === 'clear' && play.clearedBy !== 1 ? Math.min(1, play.modeT / 60) : 0;
    this.spr('flag', x - 6, y + 8 + slid * (e.h - 20), true);
  }

  private boss(play: Play, e: Ent, x: number, y: number, step: number): void {
    const kind = play.level.boss;
    if (!kind) return;
    if (e.a === 1) {
      // Underground: only the dust it kicks up shows.
      if (play.tick % 3 === 0) this.emit(P_DUST, e.x + e.w / 2 + (this.fx.next() - 0.5) * 12, e.y + e.h, (this.fx.next() - 0.5) * 0.8, -0.6 - (e.state === 1 ? 0.8 : 0), 18, 0);
      return;
    }
    if (e.t2 > 0 && Math.floor(play.tick / 2) % 2 === 0) return;
    const frame = kind === 'charger' && e.state === 3 ? 2 : step + 1;
    const left = (play.body.x < e.x) !== (kind === 'swarm');
    if (e.state === -2) {
      const atlas = this.atlas;
      const f = atlas?.right[`${kind}1`];
      if (!atlas || !f) return;
      this.ctx.save();
      this.ctx.translate(Math.round(x), Math.round(y + f.h));
      this.ctx.scale(1, -1);
      this.ctx.drawImage(atlas.canvas, f.x, f.y, f.w, f.h, 0, 0, f.w, f.h);
      this.ctx.restore();
      return;
    }
    const tell = (kind === 'charger' && e.state === 1) || (kind === 'burrower' && e.state === 1);
    this.spr(BOSS_FRAMES[kind]?.[frame - 1] ?? 'hopper1', x + (tell && this.motion && play.tick % 4 < 2 ? 1 : 0), y, left);
    if (kind === 'charger' && e.state === 3) this.text('*', x + 6, y - 6 + Math.round(Math.sin(play.tick * 0.3) * 2), 2);
  }

  private player(play: Play, camX: number, camY: number): void {
    const b = play.body;
    if (play.invuln > 0 && Math.floor(play.invuln / 3) % 2 === 0 && play.mode === 'play') return;
    if (play.mode === 'pipe' && play.modeT > 26 && play.modeT < 34) return;
    const big = b.h > 8;
    const star = play.star > 0 && Math.floor(play.tick / 3) % 2 === 0;
    const prefix = big ? (star ? 'bs_' : play.power === POWER.PING ? 'bp_' : play.power === POWER.FAN ? 'bf_' : 'b_') : star ? 'ss_' : 's_';
    let pose: Pose = 'idle';
    if (play.mode === 'dying') pose = big ? 'jump' : 'dead';
    else if (!b.onGround && !b.inWater) pose = 'jump';
    else if (!big && b.onGround && b.vx * b.facing < -0.2) pose = 'skid';
    else if (Math.abs(b.vx) > 0.1 || b.inWater) pose = Math.floor((play.tick * Math.max(0.35, Math.abs(b.vx))) / 5) % 2 === 0 ? 'run1' : 'run2';
    const name = PLAYER_NAMES[prefix]?.[pose] ?? 's_idle';
    const atlas = this.atlas;
    const left = b.facing < 0;
    const frame = atlas ? (left ? atlas.left : atlas.right)[name] : undefined;
    if (!atlas || !frame) return;
    const squash = this.motion ? play.squash : 1;
    const dw = Math.round(frame.w / Math.sqrt(squash));
    const dh = Math.round(frame.h * squash);
    const dx = Math.round(b.x + b.w / 2 - dw / 2 - camX);
    const ctx = this.ctx;
    if (b.gd === -1) {
      ctx.save();
      ctx.translate(dx, Math.round(b.y - camY) + dh);
      ctx.scale(1, -1);
      ctx.drawImage(atlas.canvas, frame.x, frame.y, frame.w, frame.h, 0, dh, dw, dh);
      ctx.restore();
    } else {
      const dy = Math.round(b.y + b.h - dh - camY);
      ctx.drawImage(atlas.canvas, frame.x, frame.y, frame.w, frame.h, dx, dy, dw, dh);
      if (play.power === POWER.FAN && big) {
        const fan = atlas.right.fan;
        if (fan) {
          const spin = Math.floor(play.tick / (b.gliding ? 2 : 6)) % 2 === 0;
          ctx.drawImage(atlas.canvas, fan.x, fan.y, fan.w, fan.h, dx + (spin ? 0 : 1), dy - 3, fan.w - (spin ? 0 : 2), fan.h);
        }
      }
    }
  }

  private particles(camX: number, camY: number): void {
    const ctx = this.ctx;
    for (let i = 0; i < PARTICLES; i += 1) {
      const at = i * PF;
      const life = this.parts[at + 4] ?? 0;
      if (life <= 0) continue;
      const kind = this.parts[at + 5] ?? 0;
      let x = this.parts[at] ?? 0;
      let y = this.parts[at + 1] ?? 0;
      let vy = this.parts[at + 3] ?? 0;
      const vx = this.parts[at + 2] ?? 0;
      x += vx;
      y += vy;
      if (kind === P_CHUNK || kind === P_CONFETTI) vy += kind === P_CHUNK ? 0.18 : 0.06;
      if (kind === P_DUST || kind === P_SMOKE) vy *= 0.92;
      this.parts[at] = x;
      this.parts[at + 1] = y;
      this.parts[at + 3] = vy;
      this.parts[at + 4] = life - 1;
      const sx = Math.round(x - camX);
      const sy = Math.round(y - camY);
      const colour = this.palette[this.parts[at + 6] ?? 0] ?? '#ffffff';
      if (kind === P_TEXT) {
        this.text(this.words[i] ?? '', sx, sy, (this.parts[at + 7] ?? 0) < 0 ? 2 : 0);
        continue;
      }
      ctx.fillStyle = colour;
      const size = kind === P_CHUNK ? 3 : kind === P_SMOKE ? (life > 14 ? 3 : 2) : kind === P_STREAK ? 0 : 1;
      if (kind === P_STREAK) ctx.fillRect(sx, sy, 6, 1);
      else if (kind === P_BUBBLE) ctx.fillRect(sx + Math.round(Math.sin(life * 0.2)), sy, 2, 2);
      else ctx.fillRect(sx, sy, size + (kind === P_CONFETTI ? 1 : 0), size + (kind === P_DUST && life > 8 ? 1 : 0));
    }
  }

  private purge(play: Play, camX: number, camY: number): void {
    const skin = this.skin;
    if (!skin || play.level.chase === 0 || !play.main) return;
    const ctx = this.ctx;
    ctx.fillStyle = styled(skin, skin.danger);
    if (play.level.kind === 'climb') {
      const top = Math.round(play.chase - camY);
      if (top > this.h) return;
      ctx.fillRect(0, top + 2, this.w, this.h);
      ctx.fillStyle = styled(skin, skin.warn);
      for (let x = 0; x < this.w; x += 2) ctx.fillRect(x, top + Math.round(Math.sin((x + this.frame * 2) * 0.2) * 1.5), 2, 2);
      return;
    }
    const edge = Math.round(play.chase - camX);
    if (edge < -8) return;
    ctx.fillRect(0, 0, Math.max(0, edge), this.h);
    ctx.fillStyle = styled(skin, skin.warn);
    for (let y = 0; y < this.h; y += 3) ctx.fillRect(edge + Math.round(Math.sin((y + this.frame * 3) * 0.25) * 2), y, 2, 2);
    if (edge > -4) this.text('PURGE', Math.max(1, edge - 22), 20, 2);
  }

  private dark(play: Play, camX: number, camY: number): void {
    const radius = play.level.dark;
    if (!this.darkness || this.darkness.width !== this.w || this.darkness.height !== this.h) {
      this.darkness = document.createElement('canvas');
      this.darkness.width = this.w;
      this.darkness.height = this.h;
    }
    if (!this.light || this.lightRadius !== radius) {
      this.light = document.createElement('canvas');
      this.light.width = radius * 2;
      this.light.height = radius * 2;
      const lctx = this.light.getContext('2d');
      if (lctx) {
        const gradient = lctx.createRadialGradient(radius, radius, radius * 0.25, radius, radius, radius);
        gradient.addColorStop(0, 'rgba(0,0,0,1)');
        gradient.addColorStop(0.7, 'rgba(0,0,0,0.8)');
        gradient.addColorStop(1, 'rgba(0,0,0,0)');
        lctx.fillStyle = gradient;
        lctx.fillRect(0, 0, radius * 2, radius * 2);
      }
      this.lightRadius = radius;
    }
    const dctx = this.darkness.getContext('2d');
    if (!dctx || !this.skin) return;
    dctx.globalCompositeOperation = 'source-over';
    dctx.fillStyle = mix(this.skin.bg, '#000000', 0.6);
    dctx.globalAlpha = 0.93;
    dctx.fillRect(0, 0, this.w, this.h);
    dctx.globalAlpha = 1;
    dctx.globalCompositeOperation = 'destination-out';
    const b = play.body;
    const flicker = this.motion ? Math.sin(play.tick * 0.2) * 1.5 : 0;
    const size = radius * 2 + flicker * 2;
    dctx.drawImage(this.light, b.x + b.w / 2 - camX - size / 2, b.y + b.h / 2 - camY - size / 2, size, size);
    // Keys, the flag and the checkpoint glow a little.
    for (const e of play.ents) {
      if (e.k !== K.GOAL && e.k !== K.CHECKPOINT && e.k !== K.LOCK && e.k !== K.SHOT_PING) continue;
      const small = e.k === K.SHOT_PING ? 18 : 30;
      dctx.drawImage(this.light, e.x + e.w / 2 - camX - small / 2, e.y + 8 - camY - small / 2, small, small);
    }
    dctx.globalCompositeOperation = 'source-over';
    this.ctx.drawImage(this.darkness, 0, 0);
  }

  /** The top line's numbers as text, made again only when they change. */
  private readonly shown = { score: -1, bits: -1, lives: -1, where: -1, scoreText: '', bitsText: '', livesText: '', whereText: '' };

  private hud(play: Play): void {
    const skin = this.skin;
    if (!skin) return;
    const ctx = this.ctx;
    const shown = this.shown;
    if (shown.score !== play.score) {
      shown.score = play.score;
      shown.scoreText = String(play.score).padStart(6, '0');
    }
    if (shown.bits !== play.bits) {
      shown.bits = play.bits;
      shown.bitsText = String(play.bits).padStart(2, '0');
    }
    if (shown.lives !== play.lives) {
      shown.lives = play.lives;
      shown.livesText = String(play.lives);
    }
    if (shown.where !== play.zone * 8 + play.hop) {
      shown.where = play.zone * 8 + play.hop;
      shown.whereText = `${play.zone}-${play.hop}`;
    }
    if (skin.style === 'mosaic') {
      ctx.fillStyle = '#0000ff';
      ctx.fillRect(0, 0, this.w, 8);
    }
    this.text(shown.scoreText, 2, 1, 0);
    this.spr('bitIcon', 30, 1);
    this.text(shown.bitsText, 37, 1, 2);
    const found = this.keysFound(play);
    for (let k = 0; k < 3; k += 1) this.spr(k < found ? 'keyIcon' : 'keySlot', 50 + k * 8, 1);
    this.spr('heart', 77, 1);
    this.text(shown.livesText, 85, 1, 0);
    this.text(shown.whereText, this.w - shown.whereText.length * ADVANCE - 1, 1, 2);
    const boss = play.bossEnt;
    if (play.bossOn && boss && boss.state >= 0 && play.level.boss) {
      const name = BOSS_NAME[play.level.boss];
      const max = maxBossHp(play.zone);
      const width = 60;
      const x = Math.round((this.w - width) / 2);
      this.text(name, Math.round((this.w - name.length * ADVANCE) / 2), 10, 1);
      ctx.fillStyle = styled(skin, skin.ink);
      ctx.fillRect(x - 1, 17, width + 2, 4);
      ctx.fillStyle = styled(skin, skin.danger);
      ctx.fillRect(x, 18, Math.round((width * Math.max(0, boss.hp)) / max), 2);
    }
  }

  private keysFound(play: Play): number {
    return Math.min(3, play.keysGot.length);
  }

  private dim(amount: number): void {
    const skin = this.skin;
    if (!skin) return;
    this.ctx.fillStyle = styled(skin, skin.bg);
    this.ctx.globalAlpha = amount;
    this.ctx.fillRect(0, 0, this.w, this.h);
    this.ctx.globalAlpha = 1;
  }

  private screens(play: Play, screen: Screen, info: { best: number; muted: boolean; title: string; card: number }): void {
    const zone: Zone = play.level.zone;
    const blink = !this.motion || Math.floor(this.frame / 30) % 2 === 0;
    if (screen === 'title') {
      this.dim(0.6);
      this.centered(info.title, 30, 2, 2);
      this.centered("A PACKET'S LONG WAY HOME", 48, 1);
      const x = Math.round(this.w / 2 - 4 + Math.sin(this.frame * 0.03) * 30);
      this.spr(Math.floor(this.frame / 8) % 2 === 0 ? 's_run1' : 's_run2', x, 64, Math.cos(this.frame * 0.03) < 0);
      if (blink) this.centered('PRESS START', 86, 0);
      this.centered('B MAP', TITLE_MAP_Y, 2);
      if (info.best > 1) this.centered(`BEST: HOP ${info.best}`, 112, 1);
      this.centered('A JUMP  B RUN  START PAUSE', 128, 1);
    } else if (screen === 'card') {
      this.dim(0.82);
      this.centered(`ZONE ${zone.index}`, 34, 1);
      this.centered(zone.name, 46, 2, 2);
      this.centered(play.level.kind === 'core' ? `CORE: ${play.level.boss ? BOSS_NAME[play.level.boss] : 'BOSS'}` : `HOP ${play.hopNumber()}`, 66, 0);
      const hint = play.hop !== 1 && play.level.kind === 'climb' ? 'CLIMB!' : zone.hint;
      // Too wide for one line: one twist a line.
      const lines = hint.length * ADVANCE > this.w - 8 ? hint.split(' + ') : [hint];
      lines.forEach((line, i) => this.centered(line, 80 + i * 8, 1));
      this.spr('heart', this.w / 2 - 12, 110);
      this.text(`X ${play.lives}`, this.w / 2 - 2, 110, 0);
    } else if (screen === 'over') {
      this.dim(0.75);
      this.centered('GAME OVER', 46, 2, 2);
      this.centered(`YOU REACHED HOP ${play.hopNumber()}`, 70, 0);
      if (blink) this.centered('PRESS A TO TRY THIS ZONE AGAIN', 92, 1);
    } else if (screen === 'paused') {
      this.dim(0.55);
    }
    if (play.mode === 'clear' && play.modeT > 20) {
      const label = play.clearedBy === 1 ? 'BACKDOOR!' : play.clearedBy === 2 ? 'CORE CLEAR!' : 'HOP CLEAR!';
      this.centered(label, 40, 2, 2);
      const found = this.keysFound(play);
      this.centered(`KEYS ${found}/3${found === 3 ? '  ALL!' : ''}`, 62, found === 3 ? 2 : 0);
      if (play.flagBonus > 0 && play.clearedBy === 0) this.centered(`FLAG +${play.flagBonus}`, 74, 1);
    }
  }

  /** The world map: the zones along the cable, their hops on it, the packet, and a panel about the picked hop. */
  drawMap(play: Play, map: WorldMap, resumes: boolean): void {
    const atlas = this.ensure(play);
    const skin = this.skin;
    if (!atlas || !skin) return;
    this.frame += 1;
    const ctx = this.ctx;
    const camX = Math.round(map.camX);
    const world = map.world;
    ctx.fillStyle = styled(skin, skin.sky);
    ctx.fillRect(0, 0, this.w, this.h);
    if (skin.style === 'glyph') {
      this.rain();
    } else {
      // Faint dots: the board the network is printed on.
      ctx.fillStyle = styled(skin, mix(skin.sky, skin.dim, 0.3));
      const shift = ((Math.round(camX / 2) % 8) + 8) % 8;
      for (let x = -shift; x < this.w; x += 8) for (let y = 14; y < PANEL_Y; y += 8) ctx.fillRect(x, y, 1, 1);
    }

    // Each zone a subnet, tinted with its colour; the one still shut, dashed.
    const flat = skin.style === 'lcd' || skin.style === 'mosaic' || skin.style === 'glyph';
    for (const zone of map.zones) {
      const left = (zone.index - 1) * ZONE_W - camX + 3;
      const width = ZONE_W - 6;
      if (left > this.w || left + width < 0) continue;
      const hue = styled(skin, skin.hues[zone.hue % skin.hues.length] ?? skin.accent);
      if (zone.open && !flat) {
        ctx.globalAlpha = 0.14;
        ctx.fillStyle = hue;
        ctx.fillRect(left, 13, width, PANEL_Y - 17);
        ctx.globalAlpha = 1;
      }
      // Few colours (an LCD's four shades): a zone's hue may be the sky's, so its frame takes the dim one.
      this.box(left, 13, width, PANEL_Y - 17, zone.open && !flat ? hue : styled(skin, skin.dim), zone.open ? 0 : 2);
      this.text(`${zone.index} ${zone.name}`, left + 3, 16, zone.index === map.picked.zone ? 2 : 1);
    }

    // The cable from hop to hop, lit where a clear has opened the way (on an LCD, lit is dark).
    const lit = styled(skin, skin.style === 'lcd' ? (skin.shades[0] ?? skin.text) : skin.accentLight);
    const unlit = styled(skin, skin.dim);
    for (let i = 0; i + 1 < map.nodes.length; i += 1) {
      const a = map.nodes[i];
      const b = map.nodes[i + 1];
      if (!a || !b) continue;
      const open = b.open && world.get(a.zone, a.hop).cleared;
      this.cable(a.x - camX, a.y, b.x - camX, b.y, open ? lit : unlit, open ? 0 : 2);
    }
    // A backdoor found: its way over to the next zone.
    for (const node of map.nodes) {
      if (!world.get(node.zone, node.hop).backdoor) continue;
      const target = map.nodes.find((other) => other.zone === node.zone + 1 && other.hop === 1);
      if (target) this.arc(node.x - camX, node.y, target.x - camX, target.y, styled(skin, skin.warn));
    }
    map.nodes.forEach((node, i) => this.mapNode(node, world.get(node.zone, node.hop), node.x - camX, i === map.at, map.fresh.has(i)));

    // The packet, on its hop or flying to the next.
    const at = map.packet();
    const shake = map.denied > 0 && this.motion ? (map.denied % 4 < 2 ? -1 : 1) : 0;
    const bob = !map.flying && this.motion && Math.floor(map.ticks / 30) % 2 === 1 ? 1 : 0;
    const half = map.picked.hop === 4 ? 6 : 5;
    this.spr(map.flying ? 's_jump' : 's_idle', Math.round(at.x - camX - 4 + shake), Math.round(at.y - half - 10 - bob), at.facing < 0);

    // The keys found, along the top. (The font's W reads as an H, so no "WORLD".)
    this.text('MAP', 2, 1, 2);
    const keys = `${world.keys()}/${map.nodes.filter((node) => node.open).length * 3}`;
    const kx = this.w - keys.length * ADVANCE - 1;
    this.spr('keyIcon', kx - 9, 1);
    this.text(keys, kx, 1, 0);
    this.mapPanel(play, map, resumes);
  }

  /** One hop on the map: shut, open or cleared, with its keys below and its backdoor (once seen) at its corner. */
  private mapNode(node: MapNode, record: Readonly<HopRecord>, x: number, picked: boolean, fresh: boolean): void {
    const skin = this.skin;
    if (!skin || x < -16 || x > this.w + 16) return;
    const ctx = this.ctx;
    const core = node.hop === 4;
    const w = core ? 15 : 11;
    const h = core ? 13 : 11;
    const left = Math.round(x) - (w >> 1);
    const top = node.y - (h >> 1);
    const done = record.cleared || record.backdoor;
    // A rounded box; the core a little fort with battlements.
    const body = core ? top + 2 : top;
    const tall = core ? h - 2 : h;
    ctx.fillStyle = styled(skin, !node.open ? skin.dim : done ? skin.ok : core ? skin.danger : skin.accent);
    ctx.fillRect(left + 1, body, w - 2, tall);
    ctx.fillRect(left, body + 1, w, tall - 2);
    if (core) for (let merlon = 0; merlon < 3; merlon += 1) ctx.fillRect(left + merlon * 6, top, 3, 2);
    ctx.fillStyle = styled(skin, !node.open ? skin.near : done ? skin.ok : skin.bg);
    ctx.fillRect(left + 1, body + 1, w - 2, tall - 2);
    const cx = left + ((w - 3) >> 1);
    const cy = body + ((tall - 5) >> 1);
    if (node.open) {
      this.text(String(node.hop), cx, cy, done ? 3 : 0, false);
      for (let k = 0; k < 3; k += 1) {
        ctx.fillStyle = styled(skin, k < record.keys.length ? skin.warn : skin.dim);
        ctx.fillRect(Math.round(x) - 4 + k * 3, top + h + 2, 2, 2);
      }
    } else {
      // A padlock.
      ctx.fillStyle = styled(skin, skin.dim);
      ctx.fillRect(cx, cy - 1, 3, 1);
      ctx.fillRect(cx - 1, cy, 1, 2);
      ctx.fillRect(cx + 3, cy, 1, 2);
      ctx.fillRect(cx - 1, cy + 2, 5, 4);
    }
    if (record.secret) {
      // The backdoor: a little door, lit once it's been taken.
      const dx = left + w - 3;
      const dy = top - 4;
      ctx.fillStyle = styled(skin, record.backdoor ? skin.warn : skin.dim);
      ctx.fillRect(dx, dy, 5, 6);
      ctx.fillStyle = styled(skin, record.backdoor ? skin.ink : skin.sky);
      ctx.fillRect(dx + 1, dy + 1, 3, 5);
    }
    if (picked && (!this.motion || Math.floor(this.frame / 20) % 3 !== 0)) this.box(left - 2, top - 2, w + 4, h + 4, styled(skin, skin.warn), 0);
    if (fresh && (!this.motion || Math.floor(this.frame / 15) % 2 === 0)) this.text('NEW', Math.round(x) - 5, top + h + 6, 2);
  }

  /** The picked hop: where it is, its keys, best time and backdoor, and what A does. */
  private mapPanel(play: Play, map: WorldMap, resumes: boolean): void {
    const skin = this.skin;
    if (!skin) return;
    const ctx = this.ctx;
    ctx.fillStyle = styled(skin, skin.bg);
    ctx.fillRect(0, PANEL_Y, this.w, this.h - PANEL_Y);
    ctx.fillStyle = styled(skin, skin.dim);
    ctx.fillRect(0, PANEL_Y, this.w, 1);
    const node = map.picked;
    const zone = map.zones[node.zone - 1];
    const record = map.world.get(node.zone, node.hop);
    const where = `${node.zone}-${node.hop}`;
    const boss = zone && zone.boss in BOSS_NAME ? BOSS_NAME[zone.boss as keyof typeof BOSS_NAME] : 'BOSS';
    this.text(where, 4, PANEL_Y + 5, 2);
    this.text(node.hop === 4 ? `CORE: ${boss}` : (zone?.name ?? ''), 4 + (where.length + 1) * ADVANCE, PANEL_Y + 5, 0);
    if (!node.open) {
      this.text(`LOCKED: ${node.hop > 1 ? `CLEAR ${node.zone}-${node.hop - 1}` : `BEAT CORE ${node.zone - 1}-4`}`, 4, PANEL_Y + 16, 1);
      this.centered('B BACK', PANEL_Y + 28, 1);
      return;
    }
    for (let k = 0; k < 3; k += 1) this.spr(k < record.keys.length ? 'keyIcon' : 'keySlot', 4 + k * 8, PANEL_Y + 15);
    this.text(record.time > 0 ? `BEST ${clock(record.time)}` : 'BEST -:--.-', 32, PANEL_Y + 16, record.time > 0 ? 0 : 1);
    if (record.secret) {
      const word = record.backdoor ? 'BACKDOOR!' : 'BACKDOOR?';
      this.text(word, this.w - word.length * ADVANCE - 3, PANEL_Y + 16, record.backdoor ? 2 : 1);
    }
    const here = resumes && node.zone === play.zone && node.hop === play.hop;
    this.centered(here ? 'A CARRY ON  B BACK' : 'A PLAY  B BACK', PANEL_Y + 28, 0);
  }

  /** A cable two pixels thick from one point to another, solid or dashed. */
  private cable(x0: number, y0: number, x1: number, y1: number, colour: string, dash: number): void {
    if (Math.max(x0, x1) < -2 || Math.min(x0, x1) > this.w + 2) return;
    const steps = Math.max(1, Math.round(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))));
    this.ctx.fillStyle = colour;
    for (let i = 0; i <= steps; i += 1) {
      if (dash > 0 && i % (dash * 2) >= dash) continue;
      this.ctx.fillRect(Math.round(x0 + ((x1 - x0) * i) / steps), Math.round(y0 + ((y1 - y0) * i) / steps), 2, 2);
    }
  }

  /** A backdoor's way: a dashed arc over the rest of its zone to the next one. */
  private arc(x0: number, y0: number, x1: number, y1: number, colour: string): void {
    if (Math.max(x0, x1) < -2 || Math.min(x0, x1) > this.w + 2) return;
    const cx = (x0 + x1) / 2;
    const cy = Math.max(24, Math.min(y0, y1) - 30);
    const steps = Math.max(1, Math.round(Math.abs(x1 - x0) * 1.3));
    this.ctx.fillStyle = colour;
    for (let i = 0; i <= steps; i += 1) {
      if (i % 5 >= 3) continue;
      const t = i / steps;
      const x = (1 - t) * (1 - t) * x0 + 2 * (1 - t) * t * cx + t * t * x1;
      const y = (1 - t) * (1 - t) * y0 + 2 * (1 - t) * t * cy + t * t * y1;
      this.ctx.fillRect(Math.round(x), Math.round(y), 2, 2);
    }
  }

  /** A frame one pixel wide, solid or dashed. */
  private box(x: number, y: number, w: number, h: number, colour: string, dash: number): void {
    const ctx = this.ctx;
    ctx.fillStyle = colour;
    if (dash === 0) {
      ctx.fillRect(x, y, w, 1);
      ctx.fillRect(x, y + h - 1, w, 1);
      ctx.fillRect(x, y, 1, h);
      ctx.fillRect(x + w - 1, y, 1, h);
      return;
    }
    for (let i = 0; i < w; i += dash * 2) {
      ctx.fillRect(x + i, y, Math.min(dash, w - i), 1);
      ctx.fillRect(x + i, y + h - 1, Math.min(dash, w - i), 1);
    }
    for (let i = 0; i < h; i += dash * 2) {
      ctx.fillRect(x, y + i, 1, Math.min(dash, h - i));
      ctx.fillRect(x + w - 1, y + i, 1, Math.min(dash, h - i));
    }
  }
}
