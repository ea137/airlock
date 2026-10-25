// Draws the world on a small canvas (144 pixels tall, 160 to 256 wide) that
// the page scales up in whole steps. An area's still tiles are painted once
// into one canvas and patched where a tile changes; each frame then draws
// the void beneath, that canvas, the tiles that move or switch, everyone
// sorted by how far down they stand, the beams and the sparkle, the dark
// (with holes for the lights), and the hearts and the companion in front.

import { mix, type Skin } from '../game/skin';
import { FONT, GLYPH_H, GLYPH_W } from '../game/font';
import { BOSS_HP, DOG, JIT, OOM, SPIN, spoofCopy, SPOOF } from './bosses';
import { personOf } from './cast';
import { EV, K } from './kinds';
import { palette, type Palette } from './look';
import type { WorldMap } from './map';
import { type Atlas, buildAtlas, type Frame } from './paint';
import { CRUSH_FROM, type Ent, FREEZE_TICKS, HOVER_TICKS, PING_LIFE, PING_RADIUS, FALL_TICKS, type World } from './sim';
import { ABILITY, alwaysSolid, DOWN, dx, dy, isConveyor, isVoid, LEFT, T, TILE, UP } from './world';

export type Screen = 'title' | 'card' | 'play' | 'talk' | 'menu' | 'end';

const PARTICLES = 160;
/** Particle fields: x, y, vx, vy, life, kind, colour. */
const PF = 7;
const P_DOT = 0;
const P_RING = 1;
const P_CHUNK = 2;

const BUGS = ['tick', 'locker', 'drop', 'phantom', 'nul'];
const ICONS: Record<string, string> = { freeze: 'cron', force: 'sudo', hover: 'float', talk: 'tel' };

/** Whether a tile is drawn each frame (it switches, moves or glows). */
function live(tile: number): boolean {
  return (
    tile === T.DOOR ||
    tile === T.SHUT ||
    tile === T.GATE ||
    tile === T.BRIDGE ||
    tile === T.GHOST ||
    tile === T.PLATE ||
    tile === T.NODE ||
    tile === T.LAMP ||
    tile === T.VENT ||
    tile === T.HAZARD ||
    tile === T.BEACON ||
    isConveyor(tile)
  );
}

function wallish(tile: number): boolean {
  return tile === T.WALL || tile === T.CRACKED;
}

export class Renderer {
  readonly ctx: CanvasRenderingContext2D;
  w = 160;
  h = 144;
  skin: Skin | null = null;
  motion = true;
  private atlas: Atlas | null = null;
  private atlasChapter = -1;
  private pal: Palette | null = null;
  private layer: HTMLCanvasElement | null = null;
  private layerArea = '';
  private drawn = new Uint8Array(0);
  private liveTiles: number[] = [];
  private dark: HTMLCanvasElement | null = null;
  private stamp: HTMLCanvasElement | null = null;
  private readonly parts = new Float32Array(PARTICLES * PF);
  private nextPart = 0;
  private frame = 0;
  private fade = 0;
  private flash = 0;
  private readonly texts = new Map<string, HTMLCanvasElement>();
  private readonly keys = new Float32Array(200);
  private readonly ids = new Int16Array(200);
  private readonly spot = { x: 0, y: 0 };
  camX = 0;
  camY = 0;

  constructor(readonly canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Keepalive needs a 2D canvas, and this browser gave none.');
    this.ctx = ctx;
  }

  resize(w: number, h: number): void {
    if (w === this.w && h === this.h && this.canvas.width === w) return;
    this.w = w;
    this.h = h;
    this.canvas.width = w;
    this.canvas.height = h;
    this.ctx.imageSmoothingEnabled = false;
    this.dark = null;
  }

  setSkin(skin: Skin, motion: boolean): void {
    this.skin = skin;
    this.motion = motion;
    this.atlas = null;
    this.atlasChapter = -1;
    this.layerArea = '';
    this.texts.clear();
    this.mapPalettes = [];
  }

  /** A speaker's colour for their name in the page, or '' for the page's own text colour (an LCD's shades vanish on its panels). */
  nameColour(paint: keyof Palette): string {
    if (!this.pal || this.skin?.style === 'lcd') return '';
    return this.pal[paint];
  }

  private ensure(world: World): Atlas | null {
    const skin = this.skin;
    if (!skin) return null;
    const chapter = world.area.spec.chapter;
    if (!this.atlas || this.atlasChapter !== chapter) {
      this.pal = palette(skin, chapter);
      this.atlas = buildAtlas(skin, chapter, this.pal);
      this.atlasChapter = chapter;
      this.layerArea = '';
      this.texts.clear();
    }
    if (this.layerArea !== world.area.id || this.drawn.length !== world.tiles.length) this.buildLayer(world);
    return this.atlas;
  }

  private buildLayer(world: World): void {
    const area = world.area;
    const canvas = document.createElement('canvas');
    canvas.width = area.w * TILE;
    canvas.height = area.h * TILE;
    const ctx = canvas.getContext('2d');
    if (ctx) ctx.imageSmoothingEnabled = false;
    this.layer = canvas;
    this.layerArea = area.id;
    this.drawn = world.tiles.slice();
    for (let ty = 0; ty < area.h; ty += 1) for (let tx = 0; tx < area.w; tx += 1) this.paintTile(world, tx, ty);
    this.listLive(world);
  }

  private listLive(world: World): void {
    this.liveTiles = [];
    for (let i = 0; i < world.tiles.length; i += 1) if (live(world.tiles[i] ?? 0)) this.liveTiles.push(i);
  }

  /** Repaints tiles that changed since the last frame (a wall broken, a pit filled). */
  private patch(world: World): void {
    const tiles = world.tiles;
    let changed = false;
    for (let i = 0; i < tiles.length; i += 1) {
      if (tiles[i] === this.drawn[i]) continue;
      changed = true;
      const tx = i % world.area.w;
      const ty = Math.floor(i / world.area.w);
      for (let oy = -1; oy <= 1; oy += 1) for (let ox = -1; ox <= 1; ox += 1) this.paintTile(world, tx + ox, ty + oy);
    }
    if (!changed) return;
    this.drawn.set(tiles);
    this.listLive(world);
  }

  private put(ctx: CanvasRenderingContext2D, name: string, x: number, y: number): void {
    const f = this.atlas?.frames[name];
    if (f && this.atlas) ctx.drawImage(this.atlas.canvas, f.x, f.y, f.w, f.h, x, y, f.w, f.h);
  }

  private paintTile(world: World, tx: number, ty: number): void {
    const area = world.area;
    if (tx < 0 || ty < 0 || tx >= area.w || ty >= area.h) return;
    const ctx = this.layer?.getContext('2d');
    const pal = this.pal;
    if (!ctx || !pal) return;
    const x = tx * TILE;
    const y = ty * TILE;
    ctx.clearRect(x, y, TILE, TILE);
    const tile = world.tileAt(tx, ty);
    const below = world.tileAt(tx, ty + 1);
    const above = ty > 0 ? world.tileAt(tx, ty - 1) : T.WALL;
    switch (tile) {
      case T.WALL:
      case T.CRACKED: {
        const face = !wallish(below) && ty + 1 < area.h;
        const base = tile === T.CRACKED ? 'cracked' : 'wall';
        this.put(ctx, face ? `${base}Face` : base, x, y);
        // Edges against open floor.
        const edge = this.skin?.style === 'outline' || this.skin?.style === 'neon' ? pal.wallLight : pal.wallLine;
        ctx.fillStyle = edge;
        if (!wallish(world.tileAt(tx - 1, ty)) && tx > 0) ctx.fillRect(x, y, 1, face ? 10 : TILE);
        if (!wallish(world.tileAt(tx + 1, ty)) && tx + 1 < area.w) ctx.fillRect(x + TILE - 1, y, 1, face ? 10 : TILE);
        if (!wallish(above) && ty > 0) {
          ctx.fillStyle = pal.wallLight;
          ctx.fillRect(x, y, TILE, 1);
        }
        return;
      }
      case T.PIT:
      case T.VENT:
      case T.BRIDGE:
      case T.GHOST:
        // The void shows through; the floor's edge drops into it.
        if (!isVoid(above) && above !== T.BRIDGE && above !== T.GHOST && ty > 0) this.put(ctx, 'cliff', x, y);
        return;
      case T.FLOOR2:
        this.put(ctx, 'floor2', x, y);
        return;
      case T.RUG:
        this.put(ctx, 'rug', x, y);
        return;
      case T.RUBBLE:
        this.put(ctx, 'rubble', x, y);
        return;
      case T.FILLED:
        this.put(ctx, 'filled', x, y);
        return;
      case T.LEDGE:
        this.put(ctx, 'ledge', x, y);
        return;
      case T.HAZARD:
      case T.GATE:
        return;
      default:
        if (isConveyor(tile)) return;
        this.put(ctx, 'floor', x, y);
    }
    // Things standing on the floor.
    if (tile === T.DECOR) this.put(ctx, 'decor', x, y);
    else if (tile === T.DECOR2) this.put(ctx, 'decor2', x, y);
    else if (tile === T.SIGN) this.put(ctx, 'signPost', x, y);
    else if (tile === T.TERMINAL) this.put(ctx, 'terminalBox', x, y);
  }

  draw(world: World, screen: Screen, title: string): void {
    const atlas = this.ensure(world);
    const skin = this.skin;
    const pal = this.pal;
    if (!atlas || !skin || !pal) return;
    this.frame += 1;
    this.patch(world);
    const ctx = this.ctx;
    const area = world.area;
    const aw = area.w * TILE;
    const ah = area.h * TILE;
    // The camera keeps Echo a little below the middle, inside the area.
    let cx = aw <= this.w ? -(this.w - aw) / 2 : Math.max(0, Math.min(aw - this.w, world.x - this.w / 2));
    let cy = ah <= this.h ? -(this.h - ah) / 2 : Math.max(0, Math.min(ah - this.h, world.y - 8 - this.h / 2));
    if (this.motion && world.shake > 0) {
      cx += ((this.frame * 7) % 5) - 2;
      cy += ((this.frame * 3) % 5) - 2;
    }
    cx = Math.round(cx);
    cy = Math.round(cy);
    this.camX = cx;
    this.camY = cy;

    this.voidBackdrop(area.spec.chapter, pal, cx, cy);
    if (this.layer) ctx.drawImage(this.layer, -cx, -cy);
    this.liveTilesDraw(world, pal, cx, cy);
    for (const e of world.ents) if (e.k === K.MOVER) this.sprite('platform', e.x - 8 - cx, e.y - 8 - cy);
    this.sentrySight(world, cx, cy);
    this.actors(world, cx, cy);
    this.beams(world, pal, cx, cy);
    this.particles(cx, cy);
    if (world.ping > 0) {
      const k = 1 - world.ping / PING_LIFE;
      ctx.strokeStyle = pal.accentLight;
      ctx.globalAlpha = Math.max(0, 1 - k * 0.9);
      ctx.beginPath();
      ctx.arc(Math.round(world.pingX - cx), Math.round(world.pingY - cy), Math.max(1, k * PING_RADIUS), 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    if (area.spec.dark) this.darkness(world, cx, cy);
    if (world.freeze > 0) this.frozen(world, pal);
    if (this.flash > 0) {
      this.flash -= 1;
      ctx.fillStyle = pal.light;
      ctx.globalAlpha = 0.3;
      ctx.fillRect(0, 0, this.w, this.h);
      ctx.globalAlpha = 1;
    }
    if (screen !== 'title') this.hud(world, pal);
    if (world.banner > 0 && screen === 'play') {
      // The place's name, on a dark band so it reads over any floor.
      const a = Math.max(0, Math.min(1, world.banner / 30, (150 - world.banner) / 15));
      const name = area.spec.name.toUpperCase();
      ctx.globalAlpha = a * 0.75;
      ctx.fillStyle = pal.ink;
      ctx.fillRect(Math.round((this.w - name.length * 4) / 2) - 4, 18, name.length * 4 + 7, 12);
      ctx.globalAlpha = a;
      this.centered(name, 21, 'light', 1);
      ctx.globalAlpha = 1;
    }
    if (this.fade > 0) {
      ctx.fillStyle = pal.void;
      ctx.globalAlpha = this.fade / 12;
      ctx.fillRect(0, 0, this.w, this.h);
      ctx.globalAlpha = 1;
      this.fade -= 1;
    }
    if (screen === 'title') this.titleScreen(world, pal, title);
  }

  /** The void under the floor, a different deep for each chapter. */
  private voidBackdrop(chapter: number, pal: Palette, cx: number, cy: number): void {
    const ctx = this.ctx;
    ctx.fillStyle = pal.void;
    ctx.fillRect(0, 0, this.w, this.h);
    ctx.fillStyle = pal.voidLight;
    const t = this.motion ? this.frame : 0;
    const px = cx * 0.5;
    const py = cy * 0.5;
    switch (chapter) {
      case 1:
        // Gears turning far below.
        for (let g = 0; g < 4; g += 1) {
          const gx = ((g * 97 - px) % (this.w + 80)) + (g * 97 - px < 0 ? this.w + 80 : 0) - 40;
          const gy = ((g * 61 - py) % (this.h + 80) + this.h + 80) % (this.h + 80) - 40;
          const turn = t * 0.01 * (g % 2 ? 1 : -1);
          for (let k = 0; k < 10; k += 1) {
            const a = turn + (k * Math.PI) / 5;
            ctx.fillRect(Math.round(gx + Math.cos(a) * 22) - 2, Math.round(gy + Math.sin(a) * 22) - 2, 4, 4);
          }
        }
        break;
      case 3:
        // Swell on the sea.
        for (let row = 0; row < 12; row += 1) {
          const y = (((row * 13 - py) % this.h) + this.h) % this.h;
          for (let x = 0; x < this.w; x += 6) if (Math.sin((x + px + t * 0.6 + row * 17) * 0.08) > 0.6) ctx.fillRect(x, y, 4, 1);
        }
        break;
      case 4:
        for (let y = ((-py % 12) + 12) % 12; y < this.h; y += 12) for (let x = ((-px % 12) + 12) % 12; x < this.w; x += 12) ctx.fillRect(x, y, 1, 1);
        break;
      case 2:
        // Bits falling down the stacks.
        for (let col = 0; col < 20; col += 1) {
          const x = (((col * 23 - px) % this.w) + this.w) % this.w;
          const y = ((((col * 37 + t * (0.5 + (col % 3) * 0.3) - py) % (this.h + 20)) + this.h + 20) % (this.h + 20)) - 10;
          ctx.fillRect(x, y, 1, 4);
        }
        break;
      default:
        // Stars (the Null's turn slowly).
        for (let s = 0; s < 40; s += 1) {
          const x = ((((s * 53) % 311) - px * (0.3 + (s % 3) * 0.2) + (chapter === 5 ? t * 0.05 * (s % 2 ? 1 : -1) : 0)) % this.w + this.w) % this.w;
          const y = ((((s * 97) % 241) - py * (0.3 + (s % 3) * 0.2)) % this.h + this.h) % this.h;
          ctx.fillRect(Math.round(x), Math.round(y), 1, 1);
        }
    }
  }

  private liveTilesDraw(world: World, pal: Palette, cx: number, cy: number): void {
    const area = world.area;
    const ctx = this.ctx;
    const slow = this.motion ? Math.floor(this.frame / 8) : 0;
    for (const i of this.liveTiles) {
      const tx = i % area.w;
      const ty = Math.floor(i / area.w);
      const x = tx * TILE - cx;
      const y = ty * TILE - cy;
      if (x < -TILE || y < -TILE || x > this.w || y > this.h) continue;
      const tile = world.tiles[i] ?? 0;
      const s = area.sig[i] ?? 255;
      switch (tile) {
        case T.DOOR:
        case T.SHUT:
          if (world.closed(i)) this.sprite('door', x, y);
          else this.sprite('floor', x, y);
          break;
        case T.GATE:
          this.sprite('floor', x, y);
          if (world.closed(i)) this.sprite('gate', x, y);
          else {
            // A gate about to shut warns you.
            ctx.fillStyle = pal.hueDark;
            ctx.fillRect(x, y, TILE, 2);
          }
          break;
        case T.BRIDGE:
          this.sprite(world.on(s) ? 'bridgeOn' : 'bridgeOff', x, y);
          break;
        case T.GHOST:
          if (world.on(s)) this.sprite('ghostOn', x, y);
          else if (this.motion && (tx * 7 + ty * 3 + slow) % 23 === 0) {
            ctx.fillStyle = pal.voidLight;
            ctx.fillRect(x + 7, y + 7, 2, 2);
          }
          break;
        case T.PLATE:
          this.sprite(this.pressed(world, i) ? 'plateDown' : 'plateUp', x, y);
          break;
        case T.NODE:
          this.sprite('floor', x, y);
          this.sprite((world.lit[i] ?? 0) !== 0 ? 'relayOn' : 'relay', x, y);
          // A timed relay about to go out flickers.
          if ((world.lit[i] ?? 0) > 0 && (world.lit[i] ?? 0) < 50 && this.frame % 8 < 4) this.sprite('relay', x, y);
          break;
        case T.LAMP:
          this.sprite('floor', x, y);
          this.sprite((world.lit[i] ?? 0) !== 0 ? 'lanternOn' : 'lantern', x, y);
          break;
        case T.VENT:
          this.sprite(slow % 2 ? 'vent1' : 'vent0', x, y);
          break;
        case T.HAZARD:
          this.sprite(slow % 2 ? 'hazard1' : 'hazard0', x, y);
          break;
        case T.BEACON:
          this.sprite('floor', x, y);
          this.sprite(slow % 4 === 0 ? 'beaconLit' : 'beacon', x, y);
          break;
        default:
          if (isConveyor(tile)) {
            const frame = world.freeze > 0 || !this.motion ? 0 : Math.floor(world.clock / 6) % 4;
            this.sprite(`conv${tile - T.CONV_U}${frame}`, x, y);
          }
      }
    }
  }

  private pressed(world: World, i: number): boolean {
    if (world.tileIndex(world.x, world.y) === i && world.hover === 0) return true;
    for (const e of world.ents) if (e.k === K.BLOCK && e.b === i && e.state === 0) return true;
    return false;
  }

  private sprite(name: string, x: number, y: number, w = 0, h = 0): Frame | null {
    const atlas = this.atlas;
    const f = atlas?.frames[name];
    if (!atlas || !f) return null;
    this.ctx.drawImage(atlas.canvas, f.x, f.y, f.w, f.h, Math.round(x), Math.round(y), w || f.w, h || f.h);
    return f;
  }

  private actors(world: World, cx: number, cy: number): void {
    let n = 0;
    const keys = this.keys;
    const ids = this.ids;
    for (let i = 0; i < world.ents.length && n < 190; i += 1) {
      const e = world.ents[i];
      if (!e || e.k === K.NONE || e.k === K.MOVER || e.k === K.SWEEPER) continue;
      if (e.k === K.NPC && e.state === 0) continue;
      if (e.k === K.ITEM && e.state === 0) continue;
      keys[n] = e.k === K.BLOCK ? e.y + 15 : e.k === K.SHOT ? e.y + 40 : e.y + 6;
      ids[n] = i;
      n += 1;
    }
    const party = world.story.party;
    const lifted = world.hover > 0 && party.includes('float');
    for (let p = 0; p < party.length; p += 1) {
      if (lifted && party[p] === 'float') continue;
      world.follower(p, this.spot);
      keys[n] = this.spot.y + 6;
      ids[n] = 1000 + p;
      n += 1;
    }
    keys[n] = world.y + 6.5;
    ids[n] = 999;
    n += 1;
    // Insertion sort: few things, nearly sorted from the last frame.
    for (let i = 1; i < n; i += 1) {
      const key = keys[i] ?? 0;
      const id = ids[i] ?? 0;
      let j = i - 1;
      while (j >= 0 && (keys[j] ?? 0) > key) {
        keys[j + 1] = keys[j] ?? 0;
        ids[j + 1] = ids[j] ?? 0;
        j -= 1;
      }
      keys[j + 1] = key;
      ids[j + 1] = id;
    }
    for (let i = 0; i < n; i += 1) {
      const id = ids[i] ?? 0;
      if (id === 999) this.echo(world, cx, cy);
      else if (id >= 1000) this.companion(world, id - 1000, cx, cy);
      else {
        const e = world.ents[id];
        if (e) this.ent(world, e, cx, cy);
      }
    }
  }

  private shadow(x: number, y: number, w: number): void {
    const pal = this.pal;
    if (!pal) return;
    this.ctx.fillStyle = pal.ink;
    this.ctx.globalAlpha = 0.35;
    this.ctx.fillRect(Math.round(x - w / 2), Math.round(y), w, 2);
    this.ctx.fillRect(Math.round(x - w / 2 + 1), Math.round(y - 1), w - 2, 4);
    this.ctx.globalAlpha = 1;
  }

  private echo(world: World, cx: number, cy: number): void {
    if (world.invuln > 0 && Math.floor(world.invuln / 4) % 2 === 0 && world.fall === 0) return;
    const x = world.x - cx;
    const y = world.y - cy;
    const name = world.facing === UP ? 'echoUp' : world.facing === DOWN ? 'echo' : world.facing === LEFT ? 'echoSideL' : 'echoSide';
    if (world.fall > 0) {
      // Falling away into the void.
      const k = world.fall / FALL_TICKS;
      const size = Math.max(2, Math.round(16 * k));
      this.sprite(name, x - size / 2, y - size + 2 + (1 - k) * 6, size, size);
      return;
    }
    let lift = 0;
    if (world.hover > 0) {
      lift = 5 + (this.motion ? Math.round(Math.sin(world.tick * 0.2)) : 0);
      this.shadow(x, y + 1, 10);
      // Float holds Echo up.
      if (world.story.party.includes('float')) this.sprite('float', x - 8, y - 30 - lift);
    }
    const bob = world.moving && this.motion && Math.floor(world.tick / 8) % 2 === 0 ? 1 : 0;
    this.sprite(name, x - 8, y - 14 - bob - lift);
  }

  private companion(world: World, n: number, cx: number, cy: number): void {
    const who = world.story.party[n];
    if (!who) return;
    world.follower(n, this.spot);
    const x = this.spot.x - cx;
    const y = this.spot.y - cy;
    const facing = world.followerFacing(n);
    const acting = world.actor === n && world.acting > 0;
    const hop = acting ? Math.round(Math.sin((world.acting / 18) * Math.PI) * 4) : 0;
    const bob = world.moving && this.motion && Math.floor((world.tick + n * 4) / 8) % 2 === 0 ? 1 : 0;
    const float = who === 'float' ? 3 + (this.motion ? Math.round(Math.sin(world.tick * 0.08 + n)) : 0) : 0;
    if (float) this.shadow(x, y + 1, 8);
    this.sprite(facing === UP ? `${who}Up` : who, x - 8, y - 14 - bob - hop - float);
  }

  private ent(world: World, e: Ent, cx: number, cy: number): void {
    const x = e.x - cx;
    const y = e.y - cy;
    switch (e.k) {
      case K.NPC: {
        const spec = world.area.placed[e.spec]?.spec;
        const person = personOf(spec?.t === 'npc' ? spec.id : '');
        const art = person.art || 'folk';
        const bob = this.motion && Math.floor((world.tick + e.spec * 13) / 40) % 2 === 0 ? 1 : 0;
        const f = this.atlas?.frames[art];
        if (f) this.sprite(art, x - f.w / 2, y + 7 - f.h - bob);
        break;
      }
      case K.ITEM: {
        const spec = world.area.placed[e.spec]?.spec;
        const kind = spec?.t === 'item' ? spec.kind : 'log';
        const bob = this.motion ? Math.round(Math.sin(world.tick * 0.08 + e.spec) * 1.5) : 0;
        this.shadow(x, y + 4, 6);
        this.sprite(kind, x - 5, y - 8 + bob);
        break;
      }
      case K.BLOCK:
        this.sprite(e.a === 1 ? 'heavy' : 'crate', x, y);
        break;
      case K.CRUSHER: {
        const spec = world.area.placed[e.spec]?.spec;
        if (spec?.t !== 'crusher') break;
        const phase = world.crusherPhase(spec.period, spec.phase);
        const up = phase < 0.6 ? 12 : phase < CRUSH_FROM ? Math.round(12 * (1 - (phase - 0.6) / (CRUSH_FROM - 0.6))) : 0;
        this.shadow(x, y + 5, 14 - up / 2);
        this.sprite('crusher', x - 8, y - 8 - up);
        break;
      }
      case K.SENTRY:
        this.sprite('sentry', x - 8, y - 12);
        if (e.state === 1) {
          const pal = this.pal;
          if (pal) {
            this.ctx.fillStyle = pal.danger;
            this.ctx.fillRect(Math.round(x - 1 + dx(e.dir) * 3), Math.round(y - 9 + dy(e.dir) * 2), 2, 2);
          }
        }
        break;
      case K.BUG: {
        const bob = this.motion && Math.floor((world.tick + e.spec * 5) / 6) % 2 === 0 ? 1 : 0;
        const name = BUGS[e.a] ?? 'tick';
        if (e.state === 2 && Math.floor(world.tick / 6) % 2 === 0) break;
        this.sprite(name, x - 8, y - 12 - (e.state === 2 ? 0 : bob));
        break;
      }
      case K.SHOT:
        this.sprite('shot', x - 4, y - 4);
        break;
      case K.BOSS:
        this.boss(world, e, cx, cy);
        break;
    }
  }

  private sentrySight(world: World, cx: number, cy: number): void {
    const pal = this.pal;
    if (!pal) return;
    const ctx = this.ctx;
    for (const e of world.ents) {
      if (e.k !== K.SENTRY || e.state !== 1) continue;
      const spec = world.area.placed[e.spec]?.spec;
      if (spec?.t !== 'sentry') continue;
      const sx = Math.floor(e.x / TILE);
      const sy = Math.floor(e.y / TILE);
      ctx.fillStyle = pal.danger;
      ctx.globalAlpha = world.freeze > 0 ? 0.12 : 0.28;
      for (let k = 1; k <= spec.range; k += 1) {
        const tx = sx + dx(e.dir) * k;
        const ty = sy + dy(e.dir) * k;
        if (alwaysSolid(world.tileAt(tx, ty)) || world.solidTile(tx, ty)) break;
        ctx.fillRect(tx * TILE - cx + 2, ty * TILE - cy + 2, TILE - 4, TILE - 4);
      }
      ctx.globalAlpha = 1;
    }
  }

  private beams(world: World, pal: Palette, cx: number, cy: number): void {
    const ctx = this.ctx;
    const frozen = world.freeze > 0;
    for (const e of world.ents) {
      if (e.k === K.SWEEPER) {
        const spec = world.area.placed[e.spec]?.spec;
        if (spec?.t !== 'sweeper') continue;
        this.beam(e.x - cx, e.y - cy, e.a, spec.arms, spec.length * TILE, frozen ? pal.dim : pal.danger, frozen ? pal.hueLight : pal.light);
        ctx.fillStyle = pal.ink;
        ctx.fillRect(Math.round(e.x - cx) - 3, Math.round(e.y - cy) - 3, 6, 6);
        ctx.fillStyle = pal.danger;
        ctx.fillRect(Math.round(e.x - cx) - 1, Math.round(e.y - cy) - 1, 2, 2);
      }
    }
  }

  private beam(x: number, y: number, angle: number, arms: number, length: number, outer: string, inner: string): void {
    const ctx = this.ctx;
    for (let arm = 0; arm < arms; arm += 1) {
      const a = angle + (arm * Math.PI * 2) / arms;
      const ex = x + Math.cos(a) * length;
      const ey = y + Math.sin(a) * length;
      ctx.strokeStyle = outer;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(Math.round(x), Math.round(y));
      ctx.lineTo(Math.round(ex), Math.round(ey));
      ctx.stroke();
      ctx.strokeStyle = inner;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(Math.round(x), Math.round(y));
      ctx.lineTo(Math.round(ex), Math.round(ey));
      ctx.stroke();
    }
  }

  private boss(world: World, e: Ent, cx: number, cy: number): void {
    const pal = this.pal;
    if (!pal || e.state === 9) return;
    const x = e.x - cx;
    const y = e.y - cy;
    const kind = world.bossKind();
    const hurt = e.b > 0 && Math.floor(e.b / 4) % 2 === 0;
    switch (kind) {
      case 'spinlock': {
        const p = Math.max(0, Math.min(2, BOSS_HP - e.hp));
        this.beam(x, y - 2, e.a, SPIN.arms[p] ?? 4, (SPIN.length[p] ?? 4) * TILE, world.freeze > 0 ? pal.dim : pal.danger, world.freeze > 0 ? pal.cronLight : pal.light);
        if (!hurt) this.sprite('spinlock', x - 12, y - 16);
        break;
      }
      case 'oom': {
        if (e.c === OOM.AIM) {
          // The line it's about to dash along.
          this.ctx.fillStyle = pal.danger;
          this.ctx.globalAlpha = 0.3 + (this.frame % 8 < 4 ? 0.2 : 0);
          const len = 200;
          const ax = dx(e.dir);
          const ay = dy(e.dir);
          this.ctx.fillRect(Math.round(x + Math.min(0, ax * len) - (ax ? 0 : 6)), Math.round(y + Math.min(0, ay * len) - (ay ? 0 : 6)), ax ? len : 12, ay ? len : 12);
          this.ctx.globalAlpha = 1;
        }
        this.shadow(x, y + 10, 16);
        const shake = e.c === OOM.STUNNED && this.motion ? (this.frame % 4 < 2 ? 1 : -1) : 0;
        if (!hurt) this.sprite('oom', x - 12 + shake, y - 18 + (e.c === OOM.STUNNED ? 2 : Math.round(Math.sin(world.tick * 0.1) * 2)));
        if (e.c === OOM.STUNNED) this.centered2('?', x, y - 26);
        break;
      }
      case 'jitter': {
        if (e.c === JIT.UNDER) break;
        const rise = e.c === JIT.RISING ? 1 - e.t / 24 : e.c === JIT.DIVING ? e.t / 24 : 1;
        // A body coiling down into the void below the head.
        for (let s = 3; s >= 1; s -= 1) {
          const sx = x + Math.sin(world.tick * 0.05 + s) * 6 * s;
          const sy = y + s * 9 * rise;
          this.sprite('segment', sx - 6, sy - 6 + (1 - rise) * 20);
        }
        if (!hurt) this.sprite('jitter', x - 12, y - 22 + (1 - rise) * 24);
        break;
      }
      case 'spoofer': {
        const party = world.story.party;
        for (let n = 0; n < SPOOF.COPIES; n += 1) {
          spoofCopy(e, n, this.spot);
          const who = party[n % Math.max(1, party.length)] ?? 'echo';
          const real = n === e.c;
          const shown = real && e.dir > 0;
          if (real && hurt) continue;
          // Fakes flicker; the real one, once pinged, stands out.
          if (!shown && this.motion && (this.frame + n * 5) % 30 < 2) continue;
          this.shadow(this.spot.x - cx, this.spot.y - cy + 6, 10);
          this.sprite(who, this.spot.x - cx - 8, this.spot.y - cy - 12);
          if (shown) {
            this.ctx.strokeStyle = pal.danger;
            this.ctx.lineWidth = 1;
            this.ctx.strokeRect(Math.round(this.spot.x - cx) - 9.5, Math.round(this.spot.y - cy) - 13.5, 19, 20);
          }
        }
        break;
      }
      case 'watchdog': {
        const listening = e.c === DOG.LISTENING;
        const sway = listening || !this.motion ? 0 : Math.round(Math.sin(world.tick * 0.03) * 2);
        if (!hurt) this.sprite('watchdog', x - 16, y - 26 + sway);
        break;
      }
    }
  }

  private emit(kind: number, x: number, y: number, vx: number, vy: number, life: number, colour: number): void {
    const at = this.nextPart * PF;
    this.nextPart = (this.nextPart + 1) % PARTICLES;
    this.parts[at] = x;
    this.parts[at + 1] = y;
    this.parts[at + 2] = vx;
    this.parts[at + 3] = vy;
    this.parts[at + 4] = life;
    this.parts[at + 5] = kind;
    this.parts[at + 6] = colour;
  }

  private colourOf(pal: Palette, n: number): string {
    switch (n) {
      case 1:
        return pal.hueLight;
      case 2:
        return pal.danger;
      case 3:
        return pal.wallTop;
      case 4:
        return pal.cronLight;
      case 5:
        return pal.warn;
      default:
        return pal.light;
    }
  }

  /** Sparkle for what happened in a step (the sim's events); called once after each step. */
  effects(world: World): void {
    const ev = world.events;
    for (let i = 0; i < ev.count; i += 1) {
      const what = ev.data[i * 4] ?? 0;
      if (what === EV.ENTER) this.fade = 12;
      else if (what === EV.HURT) this.flash = 3;
    }
    if (!this.motion) return;
    for (let i = 0; i < ev.count; i += 1) {
      const at = i * 4;
      const what = ev.data[at] ?? 0;
      const x = ev.data[at + 1] ?? 0;
      const y = ev.data[at + 2] ?? 0;
      switch (what) {
        case EV.BREAK:
        case EV.FILL:
          for (let k = 0; k < 10; k += 1) this.emit(P_CHUNK, x + ((k * 5) % 12) - 6, y + ((k * 3) % 10) - 5, ((k % 5) - 2) * 0.5, -1 - (k % 3) * 0.5, 30, 3);
          break;
        case EV.POP:
        case EV.PICK:
        case EV.BOSS_HIT:
          for (let k = 0; k < 8; k += 1) {
            const a = (k / 8) * Math.PI * 2;
            this.emit(P_DOT, x, y - 4, Math.cos(a) * 1.2, Math.sin(a) * 1.2, 24, what === EV.BOSS_HIT ? 2 : 5);
          }
          break;
        case EV.NODE:
          this.emit(P_RING, x, y - 4, 0, 0, 20, 1);
          break;
        case EV.FREEZE:
          this.emit(P_RING, x, y - 6, 0, 0, 30, 4);
          break;
        case EV.HOVER:
          for (let k = 0; k < 6; k += 1) this.emit(P_DOT, x + k * 2 - 5, y, 0, 0.6, 20, 1);
          break;
        case EV.FORCE:
          this.emit(P_RING, x, y, 0, 0, 12, 2);
          break;
        case EV.CHECK:
          for (let k = 0; k < 12; k += 1) this.emit(P_DOT, x + ((k * 7) % 16) - 8, y, 0, -0.6 - (k % 4) * 0.2, 40, 1);
          break;
      }
    }
  }

  private particles(cx: number, cy: number): void {
    const pal = this.pal;
    if (!pal) return;
    const ctx = this.ctx;
    for (let i = 0; i < PARTICLES; i += 1) {
      const at = i * PF;
      const life = this.parts[at + 4] ?? 0;
      if (life <= 0) continue;
      const kind = this.parts[at + 5] ?? 0;
      this.parts[at] = (this.parts[at] ?? 0) + (this.parts[at + 2] ?? 0);
      this.parts[at + 1] = (this.parts[at + 1] ?? 0) + (this.parts[at + 3] ?? 0);
      if (kind === P_CHUNK) this.parts[at + 3] = (this.parts[at + 3] ?? 0) + 0.12;
      this.parts[at + 4] = life - 1;
      const x = (this.parts[at] ?? 0) - cx;
      const y = (this.parts[at + 1] ?? 0) - cy;
      const colour = this.colourOf(pal, this.parts[at + 6] ?? 0);
      if (kind === P_RING) {
        ctx.strokeStyle = colour;
        ctx.lineWidth = 1;
        ctx.globalAlpha = Math.min(1, life / 10);
        ctx.beginPath();
        ctx.arc(Math.round(x), Math.round(y), Math.max(1, (30 - life) * 1.2), 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
      } else {
        ctx.fillStyle = colour;
        ctx.fillRect(Math.round(x), Math.round(y), kind === P_CHUNK ? 2 : 1, kind === P_CHUNK ? 2 : 1);
      }
    }
  }

  private lightStamp(): HTMLCanvasElement | null {
    if (this.stamp) return this.stamp;
    const size = 64;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    // A soft disc, stepped into a few rings so it stays pixel-like.
    for (let r = size / 2; r > 0; r -= 4) {
      ctx.globalAlpha = Math.min(1, ((size / 2 - r) / (size / 2)) * 1.6 + 0.15);
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(size / 2, size / 2, r, 0, Math.PI * 2);
      ctx.fill();
    }
    this.stamp = canvas;
    return canvas;
  }

  private darkness(world: World, cx: number, cy: number): void {
    const pal = this.pal;
    const stamp = this.lightStamp();
    if (!pal || !stamp) return;
    if (!this.dark || this.dark.width !== this.w || this.dark.height !== this.h) {
      this.dark = document.createElement('canvas');
      this.dark.width = this.w;
      this.dark.height = this.h;
    }
    const d = this.dark.getContext('2d');
    if (!d) return;
    d.globalCompositeOperation = 'source-over';
    d.fillStyle = mix(pal.void, '#000000', 0.6);
    d.globalAlpha = 0.94;
    d.fillRect(0, 0, this.w, this.h);
    d.globalAlpha = 1;
    d.globalCompositeOperation = 'destination-out';
    const hole = (x: number, y: number, r: number) => d.drawImage(stamp, Math.round(x - r), Math.round(y - r), r * 2, r * 2);
    const glow = world.ping > 0 ? 70 : world.pingCool > 0 ? 70 - (36 - world.pingCool) : 0;
    hole(world.x - cx, world.y - 6 - cy, Math.max(34, glow));
    const area = world.area;
    for (const i of this.liveTiles) {
      const tile = world.tiles[i];
      const on = (world.lit[i] ?? 0) !== 0;
      if (!((tile === T.LAMP && on) || tile === T.BEACON || (tile === T.NODE && on))) continue;
      const x = (i % area.w) * TILE + 8 - cx;
      const y = Math.floor(i / area.w) * TILE + 6 - cy;
      if (x < -80 || y < -80 || x > this.w + 80 || y > this.h + 80) continue;
      hole(x, y, tile === T.LAMP ? 58 : tile === T.BEACON ? 30 : 22);
    }
    d.globalCompositeOperation = 'source-over';
    this.ctx.drawImage(this.dark, 0, 0);
  }

  /** Time held still: a cold wash, and the seconds left running round the edge. */
  private frozen(world: World, pal: Palette): void {
    const ctx = this.ctx;
    ctx.fillStyle = pal.cronLight;
    ctx.globalAlpha = 0.1;
    ctx.fillRect(0, 0, this.w, this.h);
    ctx.globalAlpha = 1;
    const left = world.freeze / FREEZE_TICKS;
    const perimeter = (this.w + this.h) * 2;
    let run = Math.round(perimeter * left);
    ctx.fillStyle = pal.cron;
    const edge = (x: number, y: number, w: number, h: number) => {
      ctx.fillRect(x, y, w, h);
    };
    const top = Math.min(run, this.w);
    edge(0, 0, top, 2);
    run -= top;
    const right = Math.min(run, this.h);
    edge(this.w - 2, 0, 2, right);
    run -= right;
    const bottom = Math.min(run, this.w);
    edge(this.w - bottom, this.h - 2, bottom, 2);
    run -= bottom;
    edge(0, this.h - Math.min(run, this.h), 2, Math.min(run, this.h));
  }

  private hud(world: World, pal: Palette): void {
    const ctx = this.ctx;
    // On an LCD the hearts' shades are the walls' too: they sit on the lightest one, the lost ones faint.
    const lcd = this.skin?.style === 'lcd';
    if (lcd) {
      ctx.fillStyle = pal.light;
      ctx.fillRect(1, 1, world.maxHp * 8 + 3, 10);
    }
    for (let k = 0; k < world.maxHp; k += 1) {
      const full = k < world.hp;
      if (lcd && !full) ctx.globalAlpha = 0.3;
      this.sprite(full ? 'hpFull' : 'hpEmpty', 3 + k * 8, 3);
      ctx.globalAlpha = 1;
    }
    const who = world.story.party[0];
    if (!who) return;
    // The companion in front, and how ready their move is.
    const x = this.w - 20;
    ctx.fillStyle = pal.ink;
    ctx.globalAlpha = 0.5;
    ctx.fillRect(x - 2, 1, 20, 22);
    ctx.globalAlpha = 1;
    this.sprite(who, x, 2);
    const ability = ABILITY[who];
    let ready = 1;
    if (ability === 'freeze') ready = world.freeze > 0 ? world.freeze / FREEZE_TICKS : world.story.has('can.freeze') ? 1 - world.freezeCool / 90 : 0;
    else if (ability === 'hover') ready = world.hover > 0 ? world.hover / HOVER_TICKS : 1 - world.hoverCool / 40;
    else if (ability === 'force') ready = 1 - world.forceCool / 24;
    ctx.fillStyle = pal.dim;
    ctx.fillRect(x, 19, 16, 2);
    ctx.fillStyle = ready >= 1 ? pal[(ICONS[ability] ?? 'hue') as 'cron'] : pal.light;
    ctx.fillRect(x, 19, Math.round(16 * Math.max(0, Math.min(1, ready))), 2);
    if (world.story.party.length > 1) {
      // The others, small, waiting their turn.
      for (let p = 1; p < world.story.party.length; p += 1) {
        const other = world.story.party[p];
        if (!other) continue;
        ctx.fillStyle = pal[other === 'cron' ? 'cron' : other === 'sudo' ? 'sudo' : other === 'float' ? 'float' : 'telLight'];
        ctx.fillRect(x - 6, 3 + (p - 1) * 5, 3, 3);
      }
    }
  }

  /** A word or line in the game's small capitals, painted once and kept. */
  private textCanvas(text: string, paint: keyof Palette): HTMLCanvasElement | null {
    const key = `${paint}:${text}`;
    const known = this.texts.get(key);
    if (known) return known;
    const pal = this.pal;
    if (!pal) return null;
    if (this.texts.size > 80) this.texts.clear();
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, text.length * 4 + 1);
    canvas.height = GLYPH_H + 1;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    for (const [pass, colour] of [
      [1, pal.ink],
      [0, pal[paint]],
    ] as const) {
      ctx.fillStyle = colour;
      for (let i = 0; i < text.length; i += 1) {
        const glyph = FONT[text[i] ?? ' '] ?? FONT['?'] ?? '';
        for (let p = 0; p < GLYPH_W * GLYPH_H; p += 1) if (glyph[p] === '#') ctx.fillRect(i * 4 + (p % GLYPH_W) + pass, Math.floor(p / GLYPH_W) + pass, 1, 1);
      }
    }
    this.texts.set(key, canvas);
    return canvas;
  }

  centered(text: string, y: number, paint: keyof Palette, scale: number): void {
    const canvas = this.textCanvas(text, paint);
    if (!canvas) return;
    const w = canvas.width * scale;
    this.ctx.drawImage(canvas, Math.round((this.w - w) / 2), Math.round(y), w, canvas.height * scale);
  }

  private centered2(text: string, x: number, y: number): void {
    const canvas = this.textCanvas(text, 'light');
    if (canvas) this.ctx.drawImage(canvas, Math.round(x - canvas.width / 2), Math.round(y));
  }

  private mapPalettes: Palette[] = [];
  private mapScale = 1;
  private mapLeft = 0;
  private mapTop = 0;
  /** How much of the canvas's bottom the page covers with the map's card; the map keeps above it. */
  mapReserve = 0;
  private static readonly DASH = [2, 2];
  private static readonly SOLID: number[] = [];

  private mapPalette(chapter: number): Palette | null {
    const skin = this.skin;
    if (!skin) return null;
    if (this.mapPalettes.length === 0) for (let c = 0; c < 7; c += 1) this.mapPalettes.push(palette(skin, c));
    return this.mapPalettes[chapter] ?? this.mapPalettes[0] ?? null;
  }

  private mapX(x: number): number {
    return Math.round(this.mapLeft + x * this.mapScale);
  }

  /** Fits the places known so far in the canvas, under the heading and above the card. */
  private fitMap(map: WorldMap): void {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const n of map.nodes) {
      minX = Math.min(minX, n.x);
      maxX = Math.max(maxX, n.x);
      minY = Math.min(minY, n.y);
      maxY = Math.max(maxY, n.y);
    }
    if (map.nodes.length === 0) {
      minX = minY = 0;
      maxX = 256;
      maxY = 144;
    }
    const top = 22;
    const bottom = this.h - Math.min(this.mapReserve, this.h - 64) - 12;
    const spanX = Math.max(1, maxX - minX);
    const spanY = Math.max(1, maxY - minY);
    this.mapScale = Math.min(1, (this.w - 28) / spanX, (bottom - top) / spanY);
    this.mapLeft = Math.round((this.w - spanX * this.mapScale) / 2 - minX * this.mapScale);
    this.mapTop = Math.round(top + (bottom - top - spanY * this.mapScale) / 2 - minY * this.mapScale);
  }

  private mapY(y: number): number {
    return Math.round(this.mapTop + y * this.mapScale);
  }

  /** The place under a point of the canvas, or -1. */
  mapHit(map: WorldMap, x: number, y: number): number {
    let best = -1;
    let bestDistance = 14;
    map.nodes.forEach((n, i) => {
      const distance = Math.hypot(this.mapX(n.x) - x, this.mapY(n.y) - y);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = i;
      }
    });
    return best;
  }

  /** The world map, over everything: the network as far as you've seen it. */
  drawMap(map: WorldMap, picked: number): void {
    const home = this.mapPalette(0);
    if (!home) return;
    const ctx = this.ctx;
    this.fitMap(map);
    ctx.fillStyle = home.void;
    ctx.fillRect(0, 0, this.w, this.h);
    ctx.fillStyle = home.voidLight;
    for (let y = 6; y < this.h; y += 12) for (let x = 6; x < this.w; x += 12) ctx.fillRect(x, y, 1, 1);
    // Land under each place, in its chapter's colour; somewhere not yet been is fainter.
    for (const n of map.nodes) {
      const pal = this.mapPalette(n.chapter);
      if (!pal) continue;
      ctx.fillStyle = n.visited ? pal.floor2 : pal.voidLight;
      ctx.beginPath();
      ctx.arc(this.mapX(n.x), this.mapY(n.y), Math.max(5, 12 * this.mapScale), 0, Math.PI * 2);
      ctx.fill();
    }
    // The roads between them.
    ctx.lineWidth = 1;
    for (const [a, b] of map.edges) {
      const from = map.nodes[a];
      const to = map.nodes[b];
      if (!from || !to) continue;
      const both = from.visited && to.visited;
      ctx.strokeStyle = both ? home.light : home.dim;
      ctx.setLineDash(both ? Renderer.SOLID : Renderer.DASH);
      ctx.beginPath();
      ctx.moveTo(this.mapX(from.x) + 0.5, this.mapY(from.y) + 0.5);
      ctx.lineTo(this.mapX(to.x) + 0.5, this.mapY(to.y) + 0.5);
      ctx.stroke();
    }
    ctx.setLineDash(Renderer.SOLID);
    const blink = !this.motion || Math.floor(this.frame / 20) % 2 === 0;
    map.nodes.forEach((n, i) => {
      const pal = this.mapPalette(n.chapter);
      if (!pal) return;
      const x = this.mapX(n.x);
      const y = this.mapY(n.y);
      ctx.fillStyle = pal.ink;
      ctx.fillRect(x - 3, y - 3, 7, 7);
      // Been: lit up (gold once every secret's found). Not yet: the void's colour.
      ctx.fillStyle = n.visited ? (n.found >= n.secrets && n.secrets > 0 ? pal.warn : pal.light) : pal.voidLight;
      ctx.fillRect(x - 2, y - 2, 5, 5);
      if (!n.visited) this.textAt('?', x - 1, y - 2, 'light');
      if (n.here && blink) {
        ctx.strokeStyle = pal.accentLight;
        ctx.strokeRect(x - 5.5, y - 5.5, 12, 12);
      }
      // The story's next step; on an LCD the warning's shade is too dark to see on the map.
      if (n.main) this.textAt('!', x - 1, y - 11, this.skin?.style === 'lcd' ? 'light' : 'warn');
      if (n.side.length > 0) {
        ctx.fillStyle = pal.accentLight;
        ctx.fillRect(x + 4, y - 6, 2, 2);
      }
      if (i === picked) {
        ctx.fillStyle = home.light;
        for (const [cx, cy] of [
          [-7, -7],
          [6, -7],
          [-7, 6],
          [6, 6],
        ] as const) {
          ctx.fillRect(x + cx, y + cy, 2, 1);
          ctx.fillRect(x + cx + (cx < 0 ? 0 : 1), y + cy + (cy < 0 ? 0 : -1), 1, 2);
        }
      }
    });
    this.textAt('THE NETWORK', 3, 3, 'dim');
    // The picked place's name, unless the card (which names it too) covers the bottom.
    const n = map.nodes[picked];
    if (n && this.mapReserve === 0) this.centered(n.name.toUpperCase(), this.h - 9, 'light', 1);
  }

  private textAt(text: string, x: number, y: number, paint: keyof Palette): void {
    const canvas = this.textCanvas(text, paint);
    if (canvas) this.ctx.drawImage(canvas, Math.round(x), Math.round(y));
  }

  /** A sprite drawn into another canvas, scaled to fit (the face beside a line of dialogue). */
  portrait(target: CanvasRenderingContext2D, name: string, w: number, h: number): void {
    const atlas = this.atlas;
    const f = atlas?.frames[name];
    if (!atlas || !f) return;
    const scale = Math.max(1, Math.floor(Math.min(w / f.w, h / f.h)));
    target.imageSmoothingEnabled = false;
    target.drawImage(atlas.canvas, f.x, f.y, f.w, f.h, Math.round((w - f.w * scale) / 2), Math.round((h - f.h * scale) / 2), f.w * scale, f.h * scale);
  }

  /** The chapter's title card, over the world. */
  card(chapter: string, name: string, line: string): void {
    const pal = this.pal;
    if (!pal) return;
    const ctx = this.ctx;
    ctx.fillStyle = pal.void;
    ctx.globalAlpha = 0.86;
    ctx.fillRect(0, 0, this.w, this.h);
    ctx.globalAlpha = 1;
    this.centered(chapter, 38, 'light', 1);
    this.centered(name, 52, 'hueLight', 2);
    this.centered(line, 82, 'light', 1);
  }

  private titleScreen(world: World, pal: Palette, title: string): void {
    const ctx = this.ctx;
    ctx.fillStyle = pal.void;
    ctx.globalAlpha = 0.55;
    ctx.fillRect(0, 0, this.w, this.h);
    ctx.globalAlpha = 1;
    this.centered(title, 18, 'accentLight', 2);
    this.centered('ARE YOU STILL THERE?', 36, 'light', 1);
    // Echo and the four, walking across.
    const names = ['echoSide', 'cron', 'sudo', 'float', 'tel'];
    const span = 22;
    const t = this.motion ? this.frame : 0;
    for (let i = 0; i < names.length; i += 1) {
      const x = (((t * 0.4 - i * span) % (this.w + 120)) + this.w + 120) % (this.w + 120) - 40;
      const bob = Math.floor((t + i * 5) / 8) % 2;
      this.sprite(names[i] ?? 'echo', Math.round(x), 50 - bob - (names[i] === 'float' ? 3 : 0));
    }
    void world;
  }
}
