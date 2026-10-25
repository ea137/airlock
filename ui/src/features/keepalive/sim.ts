// The world in play: Echo and the party walking behind, the area's tiles
// and signals, the things that move, and the abilities. It steps 60 times
// a second whatever the screen does, keeps what it needs in plain fields
// (so a save can hold it exactly), and allocates nothing while it runs.
//
// Time: `tick` counts every step; `clock` is the area's own time, which
// stands still while Cron freezes it. Everything that moves on a schedule
// (gates, crushers, sweepers, sentries, timed relays, bosses) reads the
// clock or skips its turn while frozen.

import { Events } from '../game/events';
import { Rng } from '../game/rng';
import { bossHooks } from './bosses';
import type { Frame } from './input';
import { EV, ITEM_KINDS, K, NO } from './kinds';
import { type Effect, Story } from './story';
import { ABILITY, type Area, type AreaSpec, alwaysSolid, type Companion, DOWN, dx, dy, isConveyor, isVoid, LEFT, markAt, parse, RIGHT, T, TILE, UP } from './world';

export const WALK = 1.25;
/** Echo's feet: the box that collides. */
export const HALF_W = 5;
export const HALF_H = 4;
export const PING_RADIUS = 48;
export const PING_COOL = 36;
export const PING_LIFE = 24;
export const FREEZE_TICKS = 240;
export const FREEZE_COOL = 90;
export const HOVER_TICKS = 64;
export const HOVER_COOL = 40;
export const FORCE_COOL = 24;
export const FALL_TICKS = 28;
export const HURT_TICKS = 60;
export const PUSH_DELAY = 10;
export const SLIDE_TICKS = 10;
export const CONVEYOR = 0.75;
const CONVEYOR_BLOCK = 30;
const STUN_TICKS = 200;
export const MAX_HP = 3;
export const MOST_HP = 6;
/** Followers walk this many trail steps apart. */
export const SPACING = 13;
export const TRAIL = 128;
const MAX_ENTS = 160;
/** A crusher is down for the last part of its beat. */
export const CRUSH_FROM = 0.72;

export class Ent {
  k = 0;
  x = 0;
  y = 0;
  vx = 0;
  vy = 0;
  dir = 0;
  state = 0;
  t = 0;
  hp = 0;
  a = 0;
  b = 0;
  c = 0;
  ox = 0;
  oy = 0;
  /** Its spec in the area's `placed`, or -1. */
  spec = -1;

  reset(): void {
    this.k = 0;
    this.x = 0;
    this.y = 0;
    this.vx = 0;
    this.vy = 0;
    this.dir = 0;
    this.state = 0;
    this.t = 0;
    this.hp = 0;
    this.a = 0;
    this.b = 0;
    this.c = 0;
    this.ox = 0;
    this.oy = 0;
    this.spec = -1;
  }
}

/** The fields of an entity a save keeps, in order. */
export const ENT_FIELDS = ['k', 'x', 'y', 'vx', 'vy', 'dir', 'state', 't', 'hp', 'a', 'b', 'c', 'ox', 'oy', 'spec'] as const;

/** What an area remembers after you leave it: walls broken, lights lit, signals set. */
export type Memory = { broken: number[]; lit: number[]; forced: number };

/** An effect for the engine to do (music, sounds, the ending, a chapter's card). */
export type Notice = { verb: string; args: string[] };

const CORNERS = [
  [-HALF_W, -HALF_H],
  [HALF_W - 0.01, -HALF_H],
  [-HALF_W, HALF_H - 0.01],
  [HALF_W - 0.01, HALF_H - 0.01],
] as const;

export class World {
  readonly story = new Story();
  readonly events = new Events();
  readonly rng = new Rng(1);
  private readonly specs: Record<string, AreaSpec>;
  private readonly built = new Map<string, Area>();
  area: Area;
  /** The live tiles: the area's own, with walls broken and pits filled. */
  tiles = new Uint8Array(0);
  /** Per tile: a solid thing standing there (its entity index + 1). */
  occ = new Int16Array(0);
  /** Per tile: a relay's or lamp's time left; -1 stays on. */
  lit = new Int16Array(0);
  readonly ents: Ent[] = [];
  memory = new Map<string, Memory>();

  x = 0;
  y = 0;
  facing = DOWN;
  moving = false;
  hp = MAX_HP;
  maxHp = MAX_HP;
  invuln = 0;
  knockX = 0;
  knockY = 0;
  knock = 0;
  fall = 0;
  safeX = 0;
  safeY = 0;
  push = 0;
  /** Where Echo came into this area, to be sent back to. */
  entryX = 0;
  entryY = 0;
  entryDir = DOWN;
  /** The tile Echo's centre was on last tick, to notice stepping onto a new one. */
  onTile = -1;

  ping = 0;
  pingCool = 0;
  pingX = 0;
  pingY = 0;
  freeze = 0;
  freezeCool = 0;
  hover = 0;
  hoverCool = 0;
  forceCool = 0;
  /** A companion's move to show: who (by place in the party) and for how long. */
  actor = -1;
  acting = 0;

  tick = 0;
  clock = 0;
  /** Signals on now, a bit each, and the ones scenes forced on in this area. */
  signals = 0;
  forced = 0;
  /** Signals held on by story flags, worked out when the flags may have changed. */
  private held = 0;
  shake = 0;
  /** Echo's footsteps, for the party to follow: x, y pairs, the newest at `head`. */
  readonly trail = new Float32Array(TRAIL * 2);
  head = 0;
  /** The scene the world wants played, or ''. */
  want = '';
  /** Echo used a beacon: the engine opens the rest menu. */
  wantRest = false;
  /** Why the last A did nothing (NO), for a remark; -1 when it did something. */
  refused = -1;
  readonly notices: Notice[] = [];
  boss: Ent | null = null;
  /** How long the area's name still shows. */
  banner = 0;
  /** The flag of the last thing picked up, for the engine to name it. */
  lastItem = '';
  /** Sent back to the way in at the end of this tick: 1 seen by a sentry, 2 timed out. */
  private sendingBack = 0;
  private checked = -10_000;
  private readonly plates = new Set<number>();

  /** A way to an area whose chapter isn't loaded yet: the engine fetches it, then calls arrive(). */
  missing: { to: string; at: string; facing: number; step: boolean } | null = null;

  constructor(specs: AreaSpec[], first: string) {
    this.specs = Object.fromEntries(specs.map((spec) => [spec.id, spec]));
    for (let i = 0; i < MAX_ENTS; i += 1) this.ents.push(new Ent());
    this.area = this.build(first);
  }

  addAreas(specs: AreaSpec[]): void {
    for (const spec of specs) this.specs[spec.id] = spec;
  }

  arrive(): void {
    const missing = this.missing;
    this.missing = null;
    if (missing && this.hasArea(missing.to)) this.enter(missing.to, missing.at, missing.facing, missing.step);
  }

  get specList(): AreaSpec[] {
    return Object.values(this.specs);
  }

  build(id: string): Area {
    const known = this.built.get(id);
    if (known) return known;
    const spec = this.specs[id];
    if (!spec) throw new Error(`There's no area called ${id}.`);
    const area = parse(spec);
    this.built.set(id, area);
    return area;
  }

  hasArea(id: string): boolean {
    return id in this.specs;
  }

  remember(id: string): Memory {
    let memory = this.memory.get(id);
    if (!memory) {
      memory = { broken: [], lit: [], forced: 0 };
      this.memory.set(id, memory);
    }
    return memory;
  }

  /**
   * Puts Echo in an area, at the tile marked `mark`; with `step`, one tile
   * further the way Echo faces (arriving through a way in).
   */
  enter(id: string, mark: string, facing: number, step: boolean): void {
    const area = this.build(id);
    this.area = area;
    // Been here: the world map shows it from now on.
    this.story.flags.add(`been.${area.spec.region ?? id}`);
    this.tiles = area.tiles.slice();
    this.occ = new Int16Array(area.w * area.h);
    this.lit = new Int16Array(area.w * area.h);
    const memory = this.remember(id);
    for (const i of memory.broken) if (this.tiles[i] === T.CRACKED) this.tiles[i] = T.RUBBLE;
    for (const i of memory.lit) this.lit[i] = -1;
    this.forced = memory.forced;
    this.clock = 0;
    this.freeze = 0;
    this.ping = 0;
    this.spawn();
    const at = markAt(area, mark) ?? markAt(area, '@') ?? { x: 1, y: 1 };
    const tx = at.x + (step ? dx(facing) : 0);
    const ty = at.y + (step ? dy(facing) : 0);
    this.place(tx * TILE + TILE / 2, ty * TILE + TILE / 2 + 2, facing);
    this.entryX = this.x;
    this.entryY = this.y;
    this.entryDir = facing;
    this.refresh();
    this.events.push(EV.ENTER);
    this.banner = 150;
    this.enterScene();
  }

  private enterScene(): void {
    for (const rule of this.area.spec.enter ?? []) {
      if (this.story.test(rule.if) && !this.story.has(`seen.${rule.scene}`)) {
        this.want = rule.scene;
        return;
      }
    }
  }

  place(x: number, y: number, facing: number): void {
    this.x = x;
    this.y = y;
    this.facing = facing;
    this.safeX = x;
    this.safeY = y;
    this.fall = 0;
    this.knock = 0;
    this.hover = 0;
    this.push = 0;
    this.onTile = this.tileIndex(x, y);
    this.lineUp();
  }

  lineUp(): void {
    const bx = -dx(this.facing);
    const by = -dy(this.facing);
    for (let i = 0; i < TRAIL; i += 1) {
      let dist = Math.min(((TRAIL - 1 - i) / SPACING) * 14, 60);
      while (dist > 0 && this.solidAtPoint(this.x + bx * dist, this.y + by * dist)) dist -= 2;
      this.trail[i * 2] = this.x + bx * Math.max(0, dist);
      this.trail[i * 2 + 1] = this.y + by * Math.max(0, dist);
    }
    this.head = TRAIL - 1;
  }

  private spawn(): void {
    for (const e of this.ents) e.reset();
    this.boss = null;
    let n = 0;
    const area = this.area;
    for (let index = 0; index < area.placed.length; index += 1) {
      const p = area.placed[index];
      const e = this.ents[n];
      if (!p || !e) break;
      const s = p.spec;
      e.spec = index;
      e.x = p.x * TILE + TILE / 2;
      e.y = p.y * TILE + TILE / 2;
      switch (s.t) {
        case 'npc':
          e.k = K.NPC;
          e.dir = DOWN;
          break;
        case 'item':
          if (this.story.has(s.flag)) continue;
          e.k = K.ITEM;
          e.state = s.hidden ? 0 : 1;
          break;
        case 'mover':
          e.k = K.MOVER;
          e.ox = e.x;
          e.oy = e.y;
          break;
        case 'sweeper':
          e.k = K.SWEEPER;
          e.a = (s.angle * Math.PI) / 180;
          break;
        case 'crusher':
          e.k = K.CRUSHER;
          break;
        case 'sentry':
          e.k = K.SENTRY;
          e.dir = s.dir;
          e.state = 1;
          break;
        case 'bug':
          e.k = K.BUG;
          e.state = 1;
          e.a = s.kind;
          e.dir = (index * 7) & 3;
          break;
        case 'boss':
          e.k = K.BOSS;
          this.boss = e;
          bossHooks(s.kind).spawn(this, e);
          break;
        case 'block':
          e.k = K.BLOCK;
          e.a = s.heavy ? 1 : 0;
          e.x = p.x * TILE;
          e.y = p.y * TILE;
          e.b = p.y * area.w + p.x;
          break;
        default:
          continue;
      }
      n += 1;
    }
  }

  /** Re-reads what depends on the story: who's here, signals held by flags, items taken. */
  refresh(): void {
    const area = this.area;
    this.occ.fill(0);
    this.held = 0;
    area.signals.forEach((options, s) => {
      if ((options.when && this.story.test(options.when)) || (options.latch && this.story.has(options.latch))) this.held |= 1 << s;
    });
    this.ents.forEach((e, index) => {
      const spec = area.placed[e.spec]?.spec;
      if (e.k === K.NPC) {
        e.state = spec?.t === 'npc' && this.story.test(spec.if) ? 1 : 0;
        if (e.state) this.occupy(this.tileIndex(e.x, e.y), index);
      } else if (e.k === K.BLOCK) {
        this.occupy(e.b, index);
      } else if (e.k === K.SENTRY) {
        this.occupy(this.tileIndex(e.x, e.y), index);
      } else if (e.k === K.BOSS && e.state !== 9 && bossHooks(this.bossKind()).solid) {
        this.occupy(this.tileIndex(e.x, e.y), index);
      } else if (e.k === K.ITEM && spec?.t === 'item' && this.story.has(spec.flag)) {
        e.k = K.NONE;
      }
    });
    this.updateSignals(false);
  }

  private occupy(i: number, index: number): void {
    if (i >= 0 && i < this.occ.length) this.occ[i] = index + 1;
  }

  tileIndex(x: number, y: number): number {
    const tx = Math.floor(x / TILE);
    const ty = Math.floor(y / TILE);
    if (tx < 0 || ty < 0 || tx >= this.area.w || ty >= this.area.h) return -1;
    return ty * this.area.w + tx;
  }

  tileAt(tx: number, ty: number): number {
    if (tx < 0 || ty < 0 || tx >= this.area.w || ty >= this.area.h) return T.WALL;
    return this.tiles[ty * this.area.w + tx] ?? T.WALL;
  }

  on(signal: number): boolean {
    return signal < 16 && (this.signals & (1 << signal)) !== 0;
  }

  gateOpen(i: number): boolean {
    const p = this.area.placed[this.area.at[i] ?? -1]?.spec;
    if (p?.t !== 'gate') return true;
    return (this.clock + p.phase) % p.period < p.open;
  }

  crusherPhase(period: number, phase: number): number {
    return ((this.clock + phase) % period) / period;
  }

  private crusherDown(i: number): boolean {
    const p = this.area.placed[this.area.at[i] ?? -1]?.spec;
    return p?.t === 'crusher' && this.crusherPhase(p.period, p.phase) >= CRUSH_FROM;
  }

  /** Whether the floor here holds you up (not counting movers). */
  floorAt(i: number): boolean {
    const tile = this.tiles[i];
    if (tile === undefined || isVoid(tile)) return false;
    if (tile === T.BRIDGE || tile === T.GHOST) return this.on(this.area.sig[i] ?? 255);
    return true;
  }

  /** A door, gate or crusher that is closed right now (solid, but not for good). */
  closed(i: number): boolean {
    const tile = this.tiles[i];
    if (tile === T.DOOR) return !this.on(this.area.sig[i] ?? 255);
    if (tile === T.SHUT) return this.on(this.area.sig[i] ?? 255);
    if (tile === T.GATE) return !this.gateOpen(i);
    return this.crusherDown(i);
  }

  solidTile(tx: number, ty: number): boolean {
    if (tx < 0 || ty < 0 || tx >= this.area.w || ty >= this.area.h) return true;
    const i = ty * this.area.w + tx;
    if (alwaysSolid(this.tiles[i] ?? T.WALL)) return true;
    return (this.occ[i] ?? 0) !== 0 || this.closed(i);
  }

  solidAtPoint(x: number, y: number): boolean {
    return this.solidTile(Math.floor(x / TILE), Math.floor(y / TILE));
  }

  /**
   * Whether Echo's box at (x, y) runs into anything. Someone who turned up on
   * a tile Echo already stands in doesn't trap it there.
   */
  private blocked(x: number, y: number, fromX: number, fromY: number): boolean {
    const x0 = Math.floor((x - HALF_W) / TILE);
    const x1 = Math.floor((x + HALF_W - 0.01) / TILE);
    const y0 = Math.floor((y - HALF_H) / TILE);
    const y1 = Math.floor((y + HALF_H - 0.01) / TILE);
    const ax0 = Math.floor((fromX - HALF_W) / TILE);
    const ax1 = Math.floor((fromX + HALF_W - 0.01) / TILE);
    const ay0 = Math.floor((fromY - HALF_H) / TILE);
    const ay1 = Math.floor((fromY + HALF_H - 0.01) / TILE);
    for (let ty = y0; ty <= y1; ty += 1) {
      for (let tx = x0; tx <= x1; tx += 1) {
        if (!this.solidTile(tx, ty)) continue;
        const i = ty * this.area.w + tx;
        const inside = tx >= ax0 && tx <= ax1 && ty >= ay0 && ty <= ay1;
        if (inside && (this.occ[i] ?? 0) !== 0 && !alwaysSolid(this.tiles[i] ?? T.WALL) && !this.closed(i)) continue;
        return true;
      }
    }
    return false;
  }

  step(input: Frame): void {
    this.events.clear();
    this.tick += 1;
    this.refused = -1;
    if (this.banner > 0) this.banner -= 1;
    if (this.shake > 0) this.shake -= 1;
    const frozen = this.freeze > 0;
    if (!frozen) this.clock += 1;
    this.timers();
    if (this.fall > 0) {
      this.falling();
    } else {
      this.controls(input);
      this.move(input.dir);
      this.afterMove();
    }
    this.updateEnts(frozen);
    this.updateSignals(true);
    this.unstick();
    const boss = this.boss;
    if (boss) bossHooks(this.bossKind()).update(this, boss, frozen);
    this.touch();
    if (this.sendingBack) {
      this.sendingBack = 0;
      this.sendBack();
    }
  }

  bossKind(): string {
    const spec = this.boss ? this.area.placed[this.boss.spec]?.spec : undefined;
    return spec?.t === 'boss' ? spec.kind : '';
  }

  private timers(): void {
    if (this.invuln > 0) this.invuln -= 1;
    if (this.pingCool > 0) this.pingCool -= 1;
    if (this.ping > 0) this.ping -= 1;
    if (this.forceCool > 0) this.forceCool -= 1;
    if (this.acting > 0) this.acting -= 1;
    if (this.freeze > 0) {
      this.freeze -= 1;
      if (this.freeze === 0) {
        this.freezeCool = FREEZE_COOL;
        this.events.push(EV.THAW);
      }
    } else if (this.freezeCool > 0) {
      this.freezeCool -= 1;
    }
    if (this.hover > 0) {
      this.hover -= 1;
      if (this.hover === 0) this.hoverCool = HOVER_COOL;
    } else if (this.hoverCool > 0) {
      this.hoverCool -= 1;
    }
    // Timed relays run on the area's clock: frozen, they hold.
    if (this.freeze === 0) {
      const lit = this.lit;
      for (let i = 0; i < lit.length; i += 1) {
        const left = lit[i] ?? 0;
        if (left > 0) lit[i] = left - 1;
      }
    }
  }

  private controls(input: Frame): void {
    const pressed = input.pressed;
    if (pressed.switch && this.story.party.length > 1) {
      this.story.rotate();
      this.events.push(EV.SWITCH);
    }
    if (pressed.b && this.pingCool === 0) this.doPing();
    if (pressed.a) this.use();
  }

  facingTile(): number {
    return this.tileIndex(this.x + dx(this.facing) * (HALF_W + 6), this.y + dy(this.facing) * (HALF_H + 6));
  }

  private use(): void {
    const i = this.facingTile();
    if (i >= 0) {
      const o = (this.occ[i] ?? 0) - 1;
      const e = o >= 0 ? this.ents[o] : undefined;
      if (e?.k === K.NPC && e.state) {
        const spec = this.area.placed[e.spec]?.spec;
        const rule = spec?.t === 'npc' ? spec.talk.find((r) => this.story.test(r.if)) : undefined;
        if (rule) {
          e.dir = (this.facing + 2) & 3;
          this.want = rule.scene;
          return;
        }
      }
      const tile = this.tiles[i] ?? T.WALL;
      const placed = this.area.placed[this.area.at[i] ?? -1]?.spec;
      if (tile === T.SIGN && placed?.t === 'sign') {
        this.want = placed.scene;
        return;
      }
      if (tile === T.TERMINAL && placed?.t === 'terminal') {
        if (this.story.with('tel')) {
          this.actBy('tel', 30);
          this.want = placed.scene;
        } else {
          this.refuse(NO.NEED_TEL);
        }
        return;
      }
      if (tile === T.BEACON) {
        this.checkpoint(true);
        this.wantRest = true;
        return;
      }
      if (tile === T.CRACKED) {
        if (this.story.with('sudo')) this.breakWall(i);
        else this.refuse(NO.NEED_SUDO);
        return;
      }
      if (e?.k === K.BLOCK) {
        if (e.a === 1 && !this.story.with('sudo')) this.refuse(NO.HEAVY);
        else if (this.tryPush(e, this.facing, true) && e.a === 1) this.actBy('sudo', 16);
        return;
      }
    }
    this.ability();
  }

  private refuse(why: number): void {
    this.refused = why;
    this.events.push(EV.NO, this.x, this.y, why);
  }

  private actBy(who: Companion, ticks: number): void {
    this.actor = this.story.party.indexOf(who);
    this.acting = ticks;
  }

  private ability(): void {
    const who = this.story.party[0];
    if (!who) {
      this.refuse(NO.ALONE);
      return;
    }
    switch (ABILITY[who]) {
      case 'freeze':
        if (!this.story.has('can.freeze')) this.refuse(NO.NO_FREEZE);
        else if (this.freeze > 0 || this.freezeCool > 0) this.refuse(NO.TIRED);
        else {
          this.freeze = FREEZE_TICKS;
          this.actBy('cron', 30);
          this.events.push(EV.FREEZE, this.x, this.y);
        }
        break;
      case 'hover':
        if (this.hover > 0 || this.hoverCool > 0) this.refuse(NO.TIRED);
        else {
          this.hover = HOVER_TICKS;
          this.events.push(EV.HOVER, this.x, this.y);
        }
        break;
      case 'force':
        if (this.forceCool > 0) this.refuse(NO.TIRED);
        else this.shove();
        break;
      default:
        // Tel has a word about the place instead.
        this.refuse(NO.NOTHING);
    }
  }

  private shove(): void {
    this.forceCool = FORCE_COOL;
    this.actBy('sudo', 18);
    const reach = HALF_W + 12;
    const hx = this.x + dx(this.facing) * reach;
    const hy = this.y + dy(this.facing) * reach;
    this.events.push(EV.FORCE, hx, hy);
    let hit = false;
    for (const e of this.ents) {
      if (e.k === K.BUG && Math.abs(e.x - hx) < 12 && Math.abs(e.y - hy) < 12) {
        e.k = K.NONE;
        this.events.push(EV.POP, e.x, e.y);
        hit = true;
      }
    }
    const boss = this.boss;
    if (boss && bossHooks(this.bossKind()).force(this, boss, hx, hy)) hit = true;
    if (!hit) this.events.push(EV.WHIFF, hx, hy);
  }

  breakWall(i: number): void {
    this.tiles[i] = T.RUBBLE;
    const memory = this.remember(this.area.id);
    if (!memory.broken.includes(i)) memory.broken.push(i);
    this.actBy('sudo', 18);
    this.events.push(EV.BREAK, (i % this.area.w) * TILE + 8, Math.floor(i / this.area.w) * TILE + 8);
    this.shake = 8;
  }

  private doPing(): void {
    this.ping = PING_LIFE;
    this.pingCool = PING_COOL;
    this.pingX = this.x;
    this.pingY = this.y - 4;
    this.events.push(EV.PING, this.pingX, this.pingY);
    const area = this.area;
    // A tile counts if the ring reaches into it.
    const r = PING_RADIUS + 6;
    const tx0 = Math.max(0, Math.floor((this.pingX - r) / TILE));
    const tx1 = Math.min(area.w - 1, Math.floor((this.pingX + r) / TILE));
    const ty0 = Math.max(0, Math.floor((this.pingY - r) / TILE));
    const ty1 = Math.min(area.h - 1, Math.floor((this.pingY + r) / TILE));
    for (let ty = ty0; ty <= ty1; ty += 1) {
      for (let tx = tx0; tx <= tx1; tx += 1) {
        const cx = tx * TILE + 8 - this.pingX;
        const cy = ty * TILE + 8 - this.pingY;
        if (cx * cx + cy * cy > r * r) continue;
        const i = ty * area.w + tx;
        const tile = this.tiles[i];
        if (tile !== T.NODE && tile !== T.LAMP) continue;
        const p = area.placed[area.at[i] ?? -1]?.spec;
        const time = tile === T.NODE && p?.t === 'node' ? p.time : 0;
        const was = this.lit[i] ?? 0;
        this.lit[i] = time > 0 ? Math.max(was, time) : -1;
        // A relay or lamp that stays on stays on for good.
        if (time === 0) {
          const memory = this.remember(area.id);
          if (!memory.lit.includes(i)) memory.lit.push(i);
        }
        if (was === 0) this.events.push(EV.NODE, tx * TILE + 8, ty * TILE + 8, tile === T.LAMP ? 1 : 0);
      }
    }
    for (const e of this.ents) {
      const ex = e.x - this.pingX;
      const ey = e.y - this.pingY;
      if (ex * ex + ey * ey > r * r) continue;
      if (e.k === K.BUG && e.state === 1) {
        e.state = 2;
        e.t = STUN_TICKS;
        this.events.push(EV.STUN, e.x, e.y);
      } else if (e.k === K.ITEM && e.state === 0) {
        e.state = 1;
        this.events.push(EV.NODE, e.x, e.y, 2);
      }
    }
    const boss = this.boss;
    if (boss) bossHooks(this.bossKind()).ping(this, boss);
  }

  private move(dir: number): void {
    const fromX = this.x;
    const fromY = this.y;
    let mx = 0;
    let my = 0;
    if (this.knock > 0) {
      this.knock -= 1;
      mx = this.knockX;
      my = this.knockY;
    } else if (dir >= 0) {
      this.facing = dir;
      mx = dx(dir) * WALK;
      my = dy(dir) * WALK;
    }
    const here = this.tiles[this.tileIndex(this.x, this.y)] ?? T.FLOOR;
    if (isConveyor(here) && this.hover === 0 && this.freeze === 0) {
      const along = here - T.CONV_U;
      mx += dx(along) * CONVEYOR;
      my += dy(along) * CONVEYOR;
    }
    const ride = this.riding();
    if (ride) {
      mx += ride.x - ride.ox;
      my += ride.y - ride.oy;
    }
    const stopped = this.slide(mx, 0, dir === LEFT || dir === RIGHT) + this.slide(0, my, dir === UP || dir === DOWN);
    this.moving = this.x !== fromX || this.y !== fromY;
    if (dir >= 0 && stopped > 0 && this.knock === 0) this.pushAhead(dir);
    else this.push = 0;
    if (this.moving) this.stepTrail();
  }

  /** Moves along one axis; returns 1 if something stopped it. Slides round corners when nearly clear. */
  private slide(mx: number, my: number, assist: boolean): number {
    if (mx === 0 && my === 0) return 0;
    const nx = this.x + mx;
    const ny = this.y + my;
    if (!this.blocked(nx, ny, this.x, this.y)) {
      this.x = nx;
      this.y = ny;
      return 0;
    }
    if (assist) {
      // Just off a free lane: nudge sideways into it.
      for (let k = 1; k <= 6; k += 1) {
        for (let side = -1; side <= 1; side += 2) {
          const ox = my !== 0 ? side * k : 0;
          const oy = mx !== 0 ? side * k : 0;
          if (this.blocked(nx + ox, ny + oy, this.x, this.y)) continue;
          const sx = Math.sign(ox);
          const sy = Math.sign(oy);
          if (this.blocked(this.x + sx, this.y + sy, this.x, this.y)) continue;
          this.x += sx;
          this.y += sy;
          return 1;
        }
      }
    }
    // Up against it: close the gap.
    const sx = Math.sign(mx) * 0.25;
    const sy = Math.sign(my) * 0.25;
    for (let k = 0; k < 4 && !this.blocked(this.x + sx, this.y + sy, this.x, this.y); k += 1) {
      this.x += sx;
      this.y += sy;
    }
    return 1;
  }

  private stepTrail(): void {
    const lx = this.trail[this.head * 2] ?? this.x;
    const ly = this.trail[this.head * 2 + 1] ?? this.y;
    // Only steps of about a walking stride, so the party keeps its spacing.
    if (Math.abs(lx - this.x) + Math.abs(ly - this.y) < WALK * 0.9) return;
    this.head = (this.head + 1) % TRAIL;
    this.trail[this.head * 2] = this.x;
    this.trail[this.head * 2 + 1] = this.y;
    if (this.tick % 16 === 0) this.events.push(EV.STEP);
  }

  /** Where follower n (0 first) stands. */
  follower(n: number, out: { x: number; y: number }): { x: number; y: number } {
    const at = (((this.head - (n + 1) * SPACING) % TRAIL) + TRAIL) % TRAIL;
    out.x = this.trail[at * 2] ?? this.x;
    out.y = this.trail[at * 2 + 1] ?? this.y;
    return out;
  }

  followerFacing(n: number): number {
    const at = (((this.head - (n + 1) * SPACING) % TRAIL) + TRAIL) % TRAIL;
    const ahead = (at + 3) % TRAIL;
    const mx = (this.trail[ahead * 2] ?? 0) - (this.trail[at * 2] ?? 0);
    const my = (this.trail[ahead * 2 + 1] ?? 0) - (this.trail[at * 2 + 1] ?? 0);
    if (Math.abs(mx) < 0.01 && Math.abs(my) < 0.01) return this.facing;
    return Math.abs(mx) > Math.abs(my) ? (mx > 0 ? RIGHT : LEFT) : my > 0 ? DOWN : UP;
  }

  riding(): Ent | null {
    for (const e of this.ents) {
      if (e.k === K.MOVER && Math.abs(e.x - this.x) <= 8 && Math.abs(e.y - (this.y - 2)) <= 8) return e;
    }
    return null;
  }

  private pushAhead(dir: number): void {
    const i = this.tileIndex(this.x + dx(dir) * (HALF_W + 2), this.y + dy(dir) * (HALF_H + 2));
    const o = i >= 0 ? (this.occ[i] ?? 0) - 1 : -1;
    const e = o >= 0 ? this.ents[o] : undefined;
    if (e?.k !== K.BLOCK) {
      this.push = 0;
      return;
    }
    this.push += 1;
    if (this.push < PUSH_DELAY) return;
    this.push = 0;
    if (e.a === 1 && !this.story.with('sudo')) {
      this.refuse(NO.HEAVY);
      return;
    }
    if (this.tryPush(e, dir, false) && e.a === 1) this.actBy('sudo', 12);
  }

  /** Slides a block one tile, if there's room; pushed into the void, it fills it. */
  tryPush(e: Ent, dir: number, shoved: boolean): boolean {
    if (e.state > 0) return false;
    const w = this.area.w;
    const tx = (e.b % w) + dx(dir);
    const ty = Math.floor(e.b / w) + dy(dir);
    if (this.solidTile(tx, ty)) {
      if (shoved) this.events.push(EV.BUMP, tx * TILE + 8, ty * TILE + 8);
      return false;
    }
    // Not onto Echo.
    if (Math.abs(tx * TILE + 8 - this.x) < 8 + HALF_W && Math.abs(ty * TILE + 8 - this.y) < 8 + HALF_H) return false;
    const to = ty * w + tx;
    this.occ[e.b] = 0;
    e.b = to;
    e.dir = dir;
    e.state = SLIDE_TICKS;
    this.occupy(to, this.ents.indexOf(e));
    this.events.push(EV.PUSH, tx * TILE + 8, ty * TILE + 8, e.a);
    return true;
  }

  private afterMove(): void {
    const i = this.tileIndex(this.x, this.y);
    const tile = this.tiles[i] ?? T.WALL;
    const ride = this.riding();
    const over = !this.floorAt(i) && !ride;
    if (this.hover > 0) {
      if (tile === T.VENT) this.hover = HOVER_TICKS;
    } else if (over) {
      this.fall = FALL_TICKS;
      this.events.push(EV.FALL, this.x, this.y);
      return;
    } else if (tile === T.HAZARD) {
      this.hurt(this.x - dx(this.facing) * 8, this.y - dy(this.facing) * 8);
    }
    // The last spot with solid floor all round, to come back to after a fall.
    if (!ride && this.hover === 0 && this.boxOnFloor()) {
      this.safeX = this.x;
      this.safeY = this.y;
    }
    if (i !== this.onTile) {
      this.onTile = i;
      this.stepOnto(i);
    }
  }

  private boxOnFloor(): boolean {
    for (const [ox, oy] of CORNERS) {
      const i = this.tileIndex(this.x + ox, this.y + oy);
      const tile = this.tiles[i];
      if (tile === undefined || !this.floorAt(i) || tile === T.HAZARD || tile === T.BRIDGE || tile === T.GHOST || isConveyor(tile)) return false;
    }
    return true;
  }

  private falling(): void {
    this.fall -= 1;
    if (this.fall > 0) return;
    this.place(this.safeX, this.safeY, this.facing);
    this.damage(1);
    this.events.push(EV.LAND, this.x, this.y);
  }

  /** A door, gate or crusher closing on Echo pushes it out (and a gate or crusher hurts). */
  private unstick(): void {
    if (this.fall > 0) return;
    for (const [ox, oy] of CORNERS) {
      const i = this.tileIndex(this.x + ox, this.y + oy);
      if (i < 0 || !this.closed(i)) continue;
      const cx = (i % this.area.w) * TILE + 8;
      const cy = Math.floor(i / this.area.w) * TILE + 8;
      const ax = this.x - cx;
      const ay = this.y - cy;
      // Out the nearest side that's free: the way Echo leans first.
      const sx = ax >= 0 ? 1 : -1;
      const sy = ay >= 0 ? 1 : -1;
      const sides =
        Math.abs(ax) >= Math.abs(ay)
          ? [cx + sx * (8 + HALF_W), this.y, cx - sx * (8 + HALF_W), this.y, this.x, cy + sy * (8 + HALF_H), this.x, cy - sy * (8 + HALF_H)]
          : [this.x, cy + sy * (8 + HALF_H), this.x, cy - sy * (8 + HALF_H), cx + sx * (8 + HALF_W), this.y, cx - sx * (8 + HALF_W), this.y];
      for (let k = 0; k < sides.length; k += 2) {
        const nx = sides[k] ?? this.x;
        const ny = sides[k + 1] ?? this.y;
        if (this.blocked(nx, ny, nx, ny)) continue;
        this.x = nx;
        this.y = ny;
        break;
      }
      const tile = this.tiles[i];
      if (tile === T.GATE || (tile !== T.DOOR && tile !== T.SHUT)) {
        this.hurt(cx, cy);
        this.events.push(EV.CRUSH, cx, cy);
      }
      return;
    }
  }

  private stepOnto(i: number): void {
    const area = this.area;
    for (let at = area.at[i] ?? -1; at >= 0 && at < area.placed.length; at += 1) {
      const p = area.placed[at];
      if (!p || p.y * area.w + p.x !== i) break;
      const s = p.spec;
      if (s.t === 'exit') {
        if (this.story.test(s.if) && !this.hasArea(s.to)) {
          // Not loaded yet: wait at the threshold while it comes.
          this.missing = { to: s.to, at: s.at, facing: this.facing, step: true };
          this.x -= dx(this.facing) * 6;
          this.y -= dy(this.facing) * 6;
          this.onTile = this.tileIndex(this.x, this.y);
          return;
        }
        if (this.story.test(s.if)) {
          this.enter(s.to, s.at, this.facing, true);
          return;
        }
        // Not yet: say why, and step back.
        this.x -= dx(this.facing) * 6;
        this.y -= dy(this.facing) * 6;
        this.onTile = this.tileIndex(this.x, this.y);
        if (s.no && !this.want) this.want = s.no;
        return;
      }
      if (s.t === 'trigger' && !this.want && this.story.test(s.if) && !this.story.has(`seen.${s.scene}`)) this.want = s.scene;
    }
  }

  private touch(): void {
    if (this.fall > 0 || this.sendingBack) return;
    const frozen = this.freeze > 0;
    for (const e of this.ents) {
      switch (e.k) {
        case K.ITEM:
          if (e.state === 1 && Math.abs(e.x - this.x) < 10 && Math.abs(e.y - this.y) < 10) this.pick(e);
          break;
        case K.BUG:
          if (Math.abs(e.x - this.x) < 9 && Math.abs(e.y - this.y) < 8) {
            if (e.state === 1 && !frozen) this.hurt(e.x, e.y);
            else if (e.state === 2) {
              e.k = K.NONE;
              this.events.push(EV.POP, e.x, e.y);
            }
          }
          break;
        case K.SHOT:
          if (!frozen && Math.abs(e.x - this.x) < 7 && Math.abs(e.y - (this.y - 3)) < 7) {
            this.hurt(e.x, e.y);
            e.k = K.NONE;
          }
          break;
        case K.SWEEPER:
          if (!frozen && this.beamHits(e)) this.hurt(e.x, e.y);
          break;
        case K.SENTRY:
          if (e.state === 1 && !frozen && this.seenBy(e)) {
            this.events.push(EV.CAUGHT, this.x, this.y);
            this.sendingBack = 1;
            return;
          }
          break;
      }
    }
    if (this.tiles[this.facingTile()] === T.BEACON || this.tiles[this.tileIndex(this.x, this.y - 12)] === T.BEACON) this.checkpoint(false);
  }

  private pick(e: Ent): void {
    const spec = this.area.placed[e.spec]?.spec;
    e.k = K.NONE;
    if (spec?.t !== 'item') return;
    this.story.flags.add(spec.flag);
    if (spec.kind === 'heart') this.addHeart();
    this.lastItem = spec.flag;
    this.events.push(EV.PICK, e.x, e.y, ITEM_KINDS.indexOf(spec.kind));
  }

  private beamHits(e: Ent): boolean {
    const spec = this.area.placed[e.spec]?.spec;
    if (spec?.t !== 'sweeper') return false;
    return beamTouches(e.x, e.y, e.a, spec.arms, spec.length * TILE, this.x, this.y - 2);
  }

  seenBy(e: Ent): boolean {
    const spec = this.area.placed[e.spec]?.spec;
    if (spec?.t !== 'sentry') return false;
    const sx = Math.floor(e.x / TILE);
    const sy = Math.floor(e.y / TILE);
    const px = Math.floor(this.x / TILE);
    const py = Math.floor(this.y / TILE);
    for (let k = 1; k <= spec.range; k += 1) {
      const tx = sx + dx(e.dir) * k;
      const ty = sy + dy(e.dir) * k;
      if (tx === px && ty === py) return true;
      if (this.solidTile(tx, ty)) return false;
    }
    return false;
  }

  /** Back to where Echo came into the area, the area as it was. */
  sendBack(): void {
    const x = this.entryX;
    const y = this.entryY;
    const dir = this.entryDir;
    const want = this.want;
    this.enter(this.area.id, '\u0000', dir, false);
    this.want = want;
    this.place(x, y, dir);
    this.entryX = x;
    this.entryY = y;
    this.banner = 0;
  }

  /** A beacon heals, and the engine saves; `used` when Echo asked it to. */
  checkpoint(used: boolean): void {
    const fresh = this.tick - this.checked > 300;
    this.checked = this.tick;
    if (used || fresh || this.hp < this.maxHp) {
      this.hp = this.maxHp;
      if (used || fresh) this.events.push(EV.CHECK, this.x, this.y);
    }
  }

  hurt(fromX: number, fromY: number): void {
    if (this.invuln > 0 || this.fall > 0) return;
    const ax = this.x - fromX;
    const ay = this.y - fromY;
    const length = Math.hypot(ax, ay) || 1;
    this.knockX = (ax / length) * 2;
    this.knockY = (ay / length) * 2;
    this.knock = 8;
    this.damage(1);
  }

  private damage(amount: number): void {
    this.hp -= amount;
    this.invuln = HURT_TICKS;
    this.shake = 6;
    this.events.push(EV.HURT, this.x, this.y);
    if (this.hp <= 0) {
      this.hp = this.maxHp;
      this.events.push(EV.TIMEOUT, this.x, this.y);
      this.sendingBack = 2;
    }
  }

  addHeart(): void {
    this.maxHp = Math.min(MOST_HP, this.maxHp + 1);
    this.hp = this.maxHp;
  }

  private updateEnts(frozen: boolean): void {
    for (const e of this.ents) {
      switch (e.k) {
        case K.MOVER:
          this.updateMover(e, frozen);
          break;
        case K.SWEEPER:
          if (!frozen) {
            const spec = this.area.placed[e.spec]?.spec;
            if (spec?.t === 'sweeper') e.a += (spec.speed * Math.PI * 2) / 60;
          }
          break;
        case K.SENTRY:
          this.updateSentry(e, frozen);
          break;
        case K.BUG:
          if (!frozen) this.updateBug(e);
          break;
        case K.BLOCK:
          this.updateBlock(e, frozen);
          break;
        case K.SHOT:
          if (!frozen) {
            e.x += e.vx;
            e.y += e.vy;
            e.t -= 1;
            if (e.t <= 0 || alwaysSolid(this.tiles[this.tileIndex(e.x, e.y)] ?? T.WALL)) e.k = K.NONE;
          }
          break;
      }
    }
  }

  private updateMover(e: Ent, frozen: boolean): void {
    e.ox = e.x;
    e.oy = e.y;
    const p = this.area.placed[e.spec];
    const spec = p?.spec;
    if (!p || spec?.t !== 'mover' || frozen) return;
    if (spec.sig >= 0 && !this.on(spec.sig)) return;
    e.t += 1;
    moverOffset(spec.path, spec.speed, e.t, this.at);
    e.x = p.x * TILE + TILE / 2 + this.at.x;
    e.y = p.y * TILE + TILE / 2 + this.at.y;
  }

  private readonly at = { x: 0, y: 0 };

  private updateSentry(e: Ent, frozen: boolean): void {
    const spec = this.area.placed[e.spec]?.spec;
    if (spec?.t !== 'sentry') return;
    e.state = spec.sig >= 0 && this.on(spec.sig) ? 0 : 1;
    if (frozen || e.state === 0 || spec.turn <= 0) return;
    e.t += 1;
    if (e.t >= spec.turn) {
      e.t = 0;
      e.dir = (e.dir + 1) & 3;
    }
  }

  private updateBug(e: Ent): void {
    if (e.state === 2) {
      e.t -= 1;
      if (e.t <= 0) e.state = 1;
      return;
    }
    const speed = e.a === 1 ? 0.7 : 0.45;
    const nx = e.x + dx(e.dir) * speed;
    const ny = e.y + dy(e.dir) * speed;
    const lookX = nx + dx(e.dir) * 6;
    const lookY = ny + dy(e.dir) * 6;
    const ahead = this.tileIndex(lookX, lookY);
    if (ahead < 0 || this.solidAtPoint(lookX, lookY) || !this.floorAt(ahead) || this.rng.next() < 0.004) {
      e.dir = (e.dir + (this.rng.next() < 0.5 ? 1 : 3)) & 3;
      return;
    }
    e.x = nx;
    e.y = ny;
    e.t += 1;
  }

  private updateBlock(e: Ent, frozen: boolean): void {
    const w = this.area.w;
    const tx = e.b % w;
    const ty = Math.floor(e.b / w);
    if (e.state > 0) {
      e.state -= 1;
      const k = e.state / SLIDE_TICKS;
      e.x = (tx - dx(e.dir) * k) * TILE;
      e.y = (ty - dy(e.dir) * k) * TILE;
      if (e.state === 0 && !this.floorAt(e.b)) {
        this.tiles[e.b] = T.FILLED;
        this.occ[e.b] = 0;
        e.k = K.NONE;
        this.events.push(EV.FILL, tx * TILE + 8, ty * TILE + 8);
      }
      return;
    }
    const tile = this.tiles[e.b] ?? T.FLOOR;
    if (isConveyor(tile) && !frozen) {
      e.t += 1;
      if (e.t >= CONVEYOR_BLOCK) {
        e.t = 0;
        this.tryPush(e, tile - T.CONV_U, false);
      }
    } else {
      e.t = 0;
    }
  }

  /**
   * Works out which signals are on: those whose plates are all pressed and
   * relays and lamps all lit, plus those forced on by a scene or held on by
   * the story. A signal that latches stays on for good once it comes on.
   */
  updateSignals(announce: boolean): void {
    const area = this.area;
    let sources = 0;
    let off = 0;
    const pressed = this.pressedPlates();
    for (let i = 0; i < this.tiles.length; i += 1) {
      const s = area.sig[i] ?? 255;
      if (s >= 16) continue;
      const tile = this.tiles[i];
      let on: boolean;
      if (tile === T.PLATE) on = pressed.has(i);
      else if (tile === T.NODE || tile === T.LAMP) on = (this.lit[i] ?? 0) !== 0;
      else continue;
      sources |= 1 << s;
      if (!on) off |= 1 << s;
    }
    let next = (sources & ~off) | this.forced | this.held;
    for (let s = 0; s < 16; s += 1) {
      const latch = area.signals[s]?.latch;
      if (!latch || (next & (1 << s)) === 0 || this.story.has(latch)) continue;
      this.story.flags.add(latch);
      this.held |= 1 << s;
      if (announce) this.events.push(EV.SOLVED, this.x, this.y, s);
    }
    next |= this.held;
    if (announce && (next & ~this.signals) !== 0) this.events.push(EV.OPEN, this.x, this.y, next & ~this.signals);
    this.signals = next;
  }

  private pressedPlates(): Set<number> {
    const set = this.plates;
    set.clear();
    const here = this.tileIndex(this.x, this.y);
    if (this.fall === 0 && this.hover === 0 && this.tiles[here] === T.PLATE) set.add(here);
    for (const e of this.ents) if (e.k === K.BLOCK && e.state === 0 && this.tiles[e.b] === T.PLATE) set.add(e.b);
    return set;
  }

  /** Does a scene's effects: the story's own, then the world's; the rest go to the engine. */
  act(fx: Effect[]): void {
    const rest = this.story.apply(fx);
    for (const e of rest) {
      if (e.k === 'chapter') {
        this.notices.push({ verb: 'chapter', args: [String(e.n)] });
        continue;
      }
      if (e.k !== 'world') continue;
      const [a = '', b = ''] = e.args;
      switch (e.verb) {
        case 'goto':
          if (this.hasArea(a)) this.enter(a, b, this.facing, false);
          else this.missing = { to: a, at: b, facing: this.facing, step: false };
          break;
        case 'sig':
          this.force(a, 1);
          break;
        case 'unsig':
          this.force(a, 0);
          break;
        case 'flip':
          this.force(a, -1);
          break;
        case 'heal':
          this.hp = this.maxHp;
          break;
        case 'heart':
          this.addHeart();
          break;
        case 'face':
          this.facing = Math.max(0, ['up', 'right', 'down', 'left'].indexOf(a));
          this.lineUp();
          break;
        case 'shake':
          this.shake = 16;
          break;
        case 'boss':
          if (this.boss) {
            this.boss.state = 1;
            this.events.push(EV.BOSS_START);
          }
          break;
        default:
          this.notices.push({ verb: e.verb, args: e.args });
      }
    }
    this.refresh();
  }

  /** Sets (1), clears (0) or flips (-1) a signal for good, in this area. */
  private force(letter: string, how: number): void {
    const bit = 1 << (letter.charCodeAt(0) - 97);
    if (how === 1) this.forced |= bit;
    else if (how === 0) this.forced &= ~bit;
    else this.forced ^= bit;
    this.remember(this.area.id).forced = this.forced;
  }

  newGame(first: string, mark: string): void {
    this.story.reset();
    this.memory = new Map();
    this.hp = MAX_HP;
    this.maxHp = MAX_HP;
    this.tick = 0;
    this.want = '';
    this.wantRest = false;
    this.notices.length = 0;
    this.invuln = 0;
    this.freezeCool = 0;
    this.hoverCool = 0;
    this.pingCool = 0;
    this.enter(first, mark, DOWN, false);
  }

  shoot(x: number, y: number, speed: number, angle = Math.atan2(this.y - 3 - y, this.x - x)): void {
    for (const e of this.ents) {
      if (e.k !== K.NONE) continue;
      e.reset();
      e.k = K.SHOT;
      e.x = x;
      e.y = y;
      e.vx = Math.cos(angle) * speed;
      e.vy = Math.sin(angle) * speed;
      e.t = 240;
      this.events.push(EV.SHOT, x, y);
      return;
    }
  }

  beat(kind: string): void {
    this.story.flags.add(`beat.${kind}`);
    this.events.push(EV.BOSS_DOWN, this.x, this.y);
    this.want = `${kind}.down`;
    this.freeze = 0;
    for (const e of this.ents) if (e.k === K.SHOT) e.k = K.NONE;
  }
}

/** Where along its path a mover is after `t` ticks, as an offset in pixels; it goes there and back. */
export function moverOffset(path: number[], speed: number, t: number, out: { x: number; y: number }): { x: number; y: number } {
  let total = 0;
  for (let i = 1; i < path.length; i += 2) total += (path[i] ?? 0) * TILE;
  out.x = 0;
  out.y = 0;
  if (total === 0) return out;
  let s = (t * speed) % (total * 2);
  if (s > total) s = total * 2 - s;
  for (let i = 0; i + 1 < path.length && s > 0; i += 2) {
    const dir = path[i] ?? 0;
    const take = Math.min(s, (path[i + 1] ?? 0) * TILE);
    out.x += dx(dir) * take;
    out.y += dy(dir) * take;
    s -= take;
  }
  return out;
}

/** Whether beams turning about (cx, cy) touch a point: `arms` of them, `length` pixels long. */
export function beamTouches(cx: number, cy: number, angle: number, arms: number, length: number, x: number, y: number): boolean {
  const px = x - cx;
  const py = y - cy;
  const dist = Math.hypot(px, py);
  if (dist > length + 4 || dist < 6) return false;
  for (let arm = 0; arm < arms; arm += 1) {
    const a = angle + (arm * Math.PI * 2) / arms;
    const bx = Math.cos(a);
    const by = Math.sin(a);
    if (px * bx + py * by < 0) continue;
    if (Math.abs(px * by - py * bx) < 5) return true;
  }
  return false;
}
