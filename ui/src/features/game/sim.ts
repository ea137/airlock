// One game in progress: the packet, the bugs, the blocks it bumps, the
// zone's twists, and how a hop is won and lost. It steps 60 times a second
// whatever the screen does, keeps everything it needs in plain fields (so a
// save can hold it exactly), and allocates nothing while it runs.

import { updateBoss } from './boss';
import { EV, Events } from './events';
import { type Level, levelFor, RUN_H } from './generator';
import { isFoe, isItem, isPlatform, isShot, isSpiky, K } from './kinds';
import { Body, emptyPad, fits, type Grid, hasHazards, PLATFORM_STRIDE, solidAt, StepEvents, stepBody, tileAt } from './physics';
import { hash, Rng } from './rng';
import * as tiles from './tiles';
import { type Spot, World } from './world';
import { HOPS_PER_ZONE } from './zones';

const { F, FLAGS, T, TILE } = tiles;

export type Input = { left: boolean; right: boolean; up: boolean; down: boolean; a: boolean; b: boolean };

export const POWER = { SMALL: 0, BIG: 1, PING: 2, FAN: 3 } as const;

export const START_LIVES = 5;
const MAX_ENTS = 200;
const SMALL_H = 7;
const BIG_H = 13;
const STOMP_SCORES = [100, 200, 400, 800, 1000, 2000, 4000, 8000];
const STAR_TICKS = 600;
const HURT_TICKS = 120;
const SHELL_SPEED = 2.6;
const GRAVITY = 0.2;

export type Mode = 'play' | 'dying' | 'clear' | 'pipe' | 'over';

/** Anything that moves or waits in a level, from a bug to the flag. */
export class Ent {
  k = 0;
  x = 0;
  y = 0;
  w = 8;
  h = 8;
  vx = 0;
  vy = 0;
  dir = -1;
  /** What it is doing; negative while it dies (-1 squashed, -2 knocked off). */
  state = 0;
  t = 0;
  t2 = 0;
  hp = 1;
  a = 0;
  b = 0;
  c = 0;
  ox = 0;
  oy = 0;
  onGround = false;
  active = false;

  reset(): void {
    this.k = 0;
    this.x = 0;
    this.y = 0;
    this.w = 8;
    this.h = 8;
    this.vx = 0;
    this.vy = 0;
    this.dir = -1;
    this.state = 0;
    this.t = 0;
    this.t2 = 0;
    this.hp = 1;
    this.a = 0;
    this.b = 0;
    this.c = 0;
    this.ox = 0;
    this.oy = 0;
    this.onGround = false;
    this.active = false;
  }
}

/** The fields of an entity a save keeps, in order. */
export const ENT_FIELDS = ['k', 'x', 'y', 'w', 'h', 'vx', 'vy', 'dir', 'state', 't', 't2', 'hp', 'a', 'b', 'c', 'ox', 'oy', 'onGround', 'active'] as const;

/** Each kind's box, width then height, by kind number. */
const SIZES = new Uint8Array(256 * 2).fill(8);
for (const [k, w, h] of [
  [K.CRAWLER, 8, 7],
  [K.ZIP, 8, 10],
  [K.SHELL, 8, 7],
  [K.MOTH, 8, 7],
  [K.FLEA, 7, 6],
  [K.WORM, 12, 5],
  [K.SPAMMER, 8, 10],
  [K.LEAK, 8, 6],
  [K.PHISH, 9, 6],
  [K.SHOT_PING, 4, 4],
  [K.SHOT_SPAM, 6, 5],
  [K.SHOT_BULLET, 8, 6],
  [K.SHOT_DROP, 3, 5],
  [K.SHOT_BOSS, 5, 5],
  [K.SHOT_WAVE, 8, 6],
  [K.CHECKPOINT, 8, 16],
  [K.GOAL, 6, 80],
  [K.BACKDOOR, 8, 16],
  [K.BOSS, 16, 16],
  [K.POP_BIT, 6, 8],
  [K.POP_KEY, 6, 8],
] as const) {
  SIZES[k * 2] = w;
  SIZES[k * 2 + 1] = h;
}

export class Play {
  seed = 1;
  zone = 1;
  hop = 1;
  level: Level;
  room = 0;
  roomTiles: Uint8Array[] = [];
  readonly grid: Grid;
  readonly body = new Body();
  readonly ents: Ent[] = [];
  readonly events = new Events();
  rng = new Rng(1);

  power: number = POWER.SMALL;
  invuln = 0;
  star = 0;
  combo = 0;
  shotCool = 0;
  flapped = false;
  growing = 0;
  /** The packet's squash and stretch, for drawing: 1 is its own shape. */
  squash = 1;

  score = 0;
  bits = 0;
  lives = START_LIVES;
  /** Keys taken this hop, by room and tile, kept through a restart. */
  keysGot: number[] = [];
  /** Keys taken in the whole game. */
  keysTotal = 0;
  best = 0;
  /** What's been done in each hop of this game, for the world map. */
  world = new World();
  /** Ticks played in this hop, through any falls, for its best time. */
  hopTicks = 0;
  /** The hops the last clear opened (not saved: only the map shows them). */
  opened: Spot[] = [];

  tick = 0;
  switchOn = true;
  beat = 0;
  chase = 0;
  camX = 0;
  camY = 0;
  viewW = 160;
  viewH = 144;
  checkX = -1;
  checkY = -1;
  mode: Mode = 'play';
  modeT = 0;
  hitstop = 0;
  shake = 0;
  bossAt = -1;
  bossOn = false;
  gateX = -1;
  /** Where a pipe leads while the packet goes through it: room, then x, y. */
  pipeTo = -1;
  pipeX = 0;
  pipeY = 0;
  /** How the last hop ended, for the tally: 0 flag, 1 backdoor, 2 boss. */
  clearedBy = 0;
  flagBonus = 0;

  /** Last tick's buttons, to tell a press from a hold. */
  prevA = false;
  prevB = false;
  prevDown = false;
  /** The main room's bugs, kept (as ENT_FIELDS rows) while the packet is in a bonus room. */
  mainEnts: number[] = [];
  lookAhead = 0;
  private readonly pad = emptyPad();
  private readonly ev = new StepEvents();

  constructor(seed: number) {
    for (let i = 0; i < MAX_ENTS; i += 1) this.ents.push(new Ent());
    this.level = levelFor(seed, 1, 1);
    this.grid = { w: 1, h: 1, tiles: new Uint8Array(1), switchOn: true, beat: 0, waterLine: -1, hazards: false, platforms: new Float32Array(32 * PLATFORM_STRIDE), platformCount: 0 };
    this.newGame(seed);
  }

  newGame(seed: number): void {
    this.seed = seed >>> 0;
    this.zone = 1;
    this.hop = 1;
    this.score = 0;
    this.bits = 0;
    this.lives = START_LIVES;
    this.keysTotal = 0;
    this.power = POWER.SMALL;
    this.world = new World();
    this.startHop(false);
  }

  /** Goes to a hop picked on the world map, from its start. */
  startLevel(zone: number, hop: number): void {
    this.zone = zone;
    this.hop = hop;
    this.keysGot = [];
    this.checkX = -1;
    this.checkY = -1;
    this.startHop(false);
  }

  /** Builds the current hop afresh: from the start, or from its checkpoint after a fall. */
  startHop(fromCheckpoint: boolean): void {
    this.level = levelFor(this.seed, this.zone, this.hop);
    this.world.visit(this.zone, this.hop, this.level.rooms[0]?.spawns.some((spawn) => spawn.k === K.BACKDOOR) ?? false);
    if (!fromCheckpoint) this.hopTicks = 0;
    this.rng = new Rng(hash(this.seed, this.zone, this.hop, 99));
    this.roomTiles = this.level.rooms.map((room) => room.tiles.slice());
    // Keys already taken this hop stay taken.
    for (const code of this.keysGot) {
      const tilesOf = this.roomTiles[code >> 20];
      const at = code & 0xfffff;
      if (!tilesOf) continue;
      tilesOf[at] = tilesOf[at] === T.QKEY ? T.USED : T.EMPTY;
    }
    if (!fromCheckpoint) {
      this.checkX = -1;
      this.checkY = -1;
    }
    this.tick = 0;
    this.switchOn = true;
    this.beat = 0;
    this.mode = 'play';
    this.modeT = 0;
    this.hitstop = 0;
    this.bossOn = false;
    this.bossAt = -1;
    this.invuln = 0;
    this.star = 0;
    this.combo = 0;
    this.flapped = false;
    this.growing = 0;
    this.enterRoom(0, true);
    const main = this.level.rooms[0];
    if (!main) return;
    const sx = this.checkX >= 0 ? this.checkX : main.startX * TILE;
    const sy = this.checkY >= 0 ? this.checkY : (main.startY + 1) * TILE;
    this.placePlayer(sx, sy);
    this.chase = this.level.kind === 'climb' ? main.h * TILE + 24 : sx - 120;
    this.snapCamera();
    this.events.push(EV.RESPAWN);
  }

  /** Points the grid at a room's tiles, leaving the entities alone. */
  useRoom(index: number): void {
    const room = this.level.rooms[index];
    const tilesOf = this.roomTiles[index];
    if (!room || !tilesOf) return;
    this.room = index;
    this.grid.w = room.w;
    this.grid.h = room.h;
    this.grid.tiles = tilesOf;
    this.grid.waterLine = room.kind === 'bonus' ? -1 : this.level.waterLine;
    this.grid.hazards = hasHazards(tilesOf);
    this.grid.switchOn = this.switchOn;
    this.grid.beat = this.beat;
    this.grid.platformCount = 0;
  }

  private enterRoom(index: number, fresh: boolean): void {
    const room = this.level.rooms[index];
    const tilesOf = this.roomTiles[index];
    if (!room || !tilesOf) return;
    this.useRoom(index);
    for (const e of this.ents) e.reset();
    if (!fresh && index !== 0) return;
    this.gateX = -1;
    if (index === 0) {
      const gate = tilesOf.indexOf(T.GATE);
      this.gateX = gate >= 0 ? gate % room.w : -1;
    }
    for (const spawn of room.spawns) {
      const e = this.spawn(spawn.k, spawn.x, spawn.y);
      if (!e) break;
      e.a = spawn.a;
      e.b = spawn.b;
      e.c = spawn.c;
      if (isPlatform(e.k)) {
        e.w = spawn.c * TILE;
        e.h = 4;
        e.x = spawn.x;
        e.y = spawn.y;
        e.ox = e.x;
        e.oy = e.y;
        e.dir = 1;
        // Lifts start at different points of their track, so they don't move in step.
        if (e.k === K.PLAT_V) e.t = (spawn.x * 7) % 200;
      }
      if (e.k === K.GOAL) e.y = spawn.y + TILE - e.h;
      if (e.k === K.BOSS) {
        e.hp = (3 + Math.min(3, Math.floor((this.zone - 1) / 4))) * 4;
        this.bossAt = this.ents.indexOf(e);
      }
    }
  }

  /** Puts an entity in a free slot, standing in the cell at (x, y). */
  spawn(k: number, x: number, y: number): Ent | null {
    for (const e of this.ents) {
      if (e.k !== 0) continue;
      e.reset();
      e.k = k;
      e.w = SIZES[k * 2] ?? 8;
      e.h = SIZES[k * 2 + 1] ?? 8;
      e.x = x + (TILE - e.w) / 2;
      e.y = y + TILE - e.h;
      e.ox = e.x;
      e.oy = e.y;
      e.dir = -1;
      if (k === K.LEAK) e.y = y;
      if (k === K.MOTH || k === K.PHISH) e.oy = e.y;
      return e;
    }
    return null;
  }

  private placePlayer(x: number, feet: number): void {
    const b = this.body;
    b.w = 6;
    b.h = this.power === POWER.SMALL ? SMALL_H : BIG_H;
    b.x = x + 1;
    b.y = feet - b.h;
    b.vx = 0;
    b.vy = 0;
    b.gd = 1;
    b.onGround = false;
    b.jumping = false;
    b.platform = -1;
    b.facing = 1;
    b.canGlide = this.power === POWER.FAN;
  }

  get main(): boolean {
    return this.room === 0;
  }

  get bossEnt(): Ent | null {
    const e = this.bossAt >= 0 ? this.ents[this.bossAt] : undefined;
    return e && e.k === K.BOSS ? e : null;
  }

  addScore(points: number, x: number, y: number): void {
    this.score += points;
    this.events.push(EV.SCORE, x, y, points);
  }

  private addBits(count: number, x: number, y: number): void {
    this.bits += count;
    this.score += 10 * count;
    this.events.push(EV.BIT, x, y);
    while (this.bits >= 100) {
      this.bits -= 100;
      this.oneUp(x, y);
    }
  }

  private oneUp(x: number, y: number): void {
    this.lives = Math.min(99, this.lives + 1);
    this.events.push(EV.LIFE, x, y);
  }

  step(input: Input): void {
    this.events.clear();
    const pressedA = input.a && !this.prevA;
    const pressedB = input.b && !this.prevB;
    const pressedDown = input.down && !this.prevDown;
    this.prevA = input.a;
    this.prevB = input.b;
    this.prevDown = input.down;
    if (this.shake > 0) this.shake -= 1;
    if (this.hitstop > 0) {
      this.hitstop -= 1;
      return;
    }
    this.modeT += 1;
    if (this.mode === 'dying') return this.stepDying();
    if (this.mode === 'clear') return this.stepClear();
    if (this.mode === 'pipe') return this.stepPipe();
    if (this.mode === 'over') return;

    this.tick += 1;
    this.hopTicks += 1;
    this.stepWorld();
    this.stepPlayer(input, pressedA, pressedB, pressedDown);
    this.stepEnts();
    this.stepChase();
    this.updateCamera();
  }

  private stepWorld(): void {
    const level = this.level;
    if (level.beatTicks > 0) {
      const beat = Math.floor(this.tick / level.beatTicks) % 2;
      if (beat !== this.beat) {
        this.beat = beat;
        this.grid.beat = beat;
        this.events.push(EV.BEAT);
        this.unstick();
      }
    }
    this.grid.switchOn = this.switchOn;
    // Platforms move first, so the packet rides them this tick.
    let count = 0;
    for (const e of this.ents) {
      if (!isPlatform(e.k) || count >= 32) continue;
      const fromX = e.x;
      const fromY = e.y;
      this.movePlatform(e);
      const at = count * PLATFORM_STRIDE;
      this.grid.platforms[at] = e.x;
      this.grid.platforms[at + 1] = e.y;
      this.grid.platforms[at + 2] = e.w;
      this.grid.platforms[at + 3] = e.x - fromX;
      this.grid.platforms[at + 4] = e.y - fromY;
      e.hp = count;
      count += 1;
    }
    this.grid.platformCount = count;
  }

  private movePlatform(e: Ent): void {
    if (e.k === K.PLAT_H) {
      e.x += 0.5 * e.dir;
      if (e.x >= e.b) {
        e.x = e.b;
        e.dir = -1;
      } else if (e.x <= e.a) {
        e.x = e.a;
        e.dir = 1;
      }
    } else if (e.k === K.PLAT_V) {
      // Up and down its track, easing at the ends.
      e.t += 1;
      const span = e.b - e.a;
      const period = Math.max(60, span * 4);
      const phase = (e.t % period) / period;
      e.y = e.b - span * (0.5 - 0.5 * Math.cos(phase * Math.PI * 2));
    } else if (e.k === K.PLAT_FALL) {
      if (e.state === 1) {
        e.t += 1;
        if (e.t > 28) e.state = 2;
      } else if (e.state === 2) {
        e.vy = Math.min(3, e.vy + 0.15);
        e.y += e.vy;
        e.t += 1;
        if (e.t > 210) {
          e.state = 0;
          e.t = 0;
          e.vy = 0;
          e.x = e.ox;
          e.y = e.oy;
        }
      }
    }
  }

  /** A block appeared where the packet is: lift it out. */
  private unstick(): void {
    const b = this.body;
    if (fits(b, this.grid)) return;
    for (let lift = 1; lift <= 24; lift += 1) {
      b.y -= 1;
      if (fits(b, this.grid)) return;
    }
    b.y += 24;
  }

  private stepPlayer(input: Input, pressedA: boolean, pressedB: boolean, pressedDown: boolean): void {
    const b = this.body;
    const pad = this.pad;
    pad.left = input.left;
    pad.right = input.right;
    pad.up = input.up;
    pad.down = input.down;
    pad.jump = input.a;
    pad.jumpPressed = pressedA;
    pad.run = input.b;

    if (this.invuln > 0) this.invuln -= 1;
    if (this.star > 0) this.star -= 1;
    if (this.shotCool > 0) this.shotCool -= 1;
    if (this.growing > 0) {
      this.growing -= 1;
      if (this.growing === 0 && this.power > POWER.SMALL) this.grow();
    }

    // The fan's flutter: one extra push upwards in each jump.
    if (pressedA && this.power === POWER.FAN && !b.onGround && !b.inWater && b.coyote === 0 && !this.flapped) {
      this.flapped = true;
      b.vy = -2.5 * b.gd;
      b.jumping = true;
      this.events.push(EV.FLAP, b.x, b.y);
    }
    if (pressedB && this.power === POWER.PING && this.shotCool === 0) this.shoot();

    // Pipes: down on a warp pipe's top.
    if (pressedDown && b.onGround && this.enterPipe()) return;

    const wind = this.windNow();
    stepBody(b, pad, this.level.tuning, this.grid, this.ev, wind * (b.onGround ? 0.45 : 1), 0);
    const ev = this.ev;
    if (b.onGround) {
      this.flapped = false;
      this.combo = 0;
    }
    if (ev.jumped) {
      this.squash = 1.25;
      this.events.push(EV.JUMP, b.x, b.y);
    }
    if (ev.landed) {
      this.squash = ev.landSpeed > 2.5 ? 0.7 : 0.85;
      this.events.push(EV.LAND, b.x + b.w / 2, b.y + b.h);
    }
    if (ev.skidding && this.tick % 4 === 0) this.events.push(EV.SKID, b.x + b.w / 2, b.y + b.h);
    if (ev.sprung) {
      this.squash = 1.35;
      this.events.push(EV.SPRING, b.x, b.y + b.h);
    }
    if (ev.swam) this.events.push(EV.SWIM, b.x, b.y);
    this.squash += (1 - this.squash) * 0.25;
    if (ev.bumpTx >= 0) this.bump(ev.bumpTx, ev.bumpTy);
    if (ev.died) return this.die();
    if (ev.hurt) this.hurt();
    this.pickups();
    if (this.mode !== 'play') return;

    // A falling platform starts to drop once stood on.
    if (b.onGround && b.platform >= 0) {
      for (const e of this.ents) {
        if (e.k === K.PLAT_FALL && e.hp === b.platform && e.state === 0) {
          e.state = 1;
          e.t = 0;
        }
      }
    }
    // The boss's gate shuts once the packet is through it.
    if (this.main && this.gateX >= 0 && !this.bossOn && b.x > (this.gateX + 2) * TILE) this.startBoss();
  }

  windNow(): number {
    const strength = this.level.wind;
    if (strength === 0 || !this.main) return 0;
    const period = 420;
    const at = this.tick % period;
    const dir = Math.floor(this.tick / period) % 3 === 1 ? 1 : -1;
    if (at < 180) return 0;
    if (at < 200) return dir * strength * ((at - 180) / 20);
    if (at < 360) return dir * strength;
    if (at < 380) return dir * strength * ((380 - at) / 20);
    return 0;
  }

  /** Whether a gust is blowing now, and which way (for drawing streaks). */
  gust(): number {
    return Math.sign(this.windNow());
  }

  private shoot(): void {
    let alive = 0;
    for (const e of this.ents) if (e.k === K.SHOT_PING) alive += 1;
    if (alive >= 2) return;
    const b = this.body;
    const e = this.spawn(K.SHOT_PING, b.x + (b.facing > 0 ? b.w : -4), b.y + 2);
    if (!e) return;
    e.y = b.y + 3;
    e.vx = 2.3 * b.facing;
    e.vy = 0.5;
    e.dir = b.facing;
    this.shotCool = 12;
    this.events.push(EV.SHOOT, e.x, e.y);
  }

  private enterPipe(): boolean {
    const b = this.body;
    const under = Math.floor((b.y + b.h + 1) / TILE);
    const mid = Math.floor((b.x + b.w / 2) / TILE);
    let warpX = -1;
    for (const tx of [mid, mid - 1]) {
      if (tileAt(this.grid, tx, under) === T.WARP) warpX = tx;
    }
    if (warpX < 0) return false;
    let target = -1;
    if (this.room === 0) {
      const warp = this.level.warps.find((w) => w.tx === warpX && w.ty === under);
      target = warp ? warp.to : -1;
      this.pipeX = warpX * TILE + 4;
      this.pipeY = under * TILE;
    } else {
      target = 0;
    }
    if (target < 0) return false;
    this.pipeTo = target;
    this.mode = 'pipe';
    this.modeT = 0;
    b.x = warpX * TILE + 5;
    b.vx = 0;
    b.vy = 0;
    this.events.push(EV.PIPE, b.x, b.y);
    return true;
  }

  private stepPipe(): void {
    const b = this.body;
    if (this.modeT <= 30) {
      b.y += 0.5;
      return;
    }
    if (this.modeT === 31) {
      const to = this.pipeTo;
      if (to === 0) {
        // Back out of the warp pipe the packet went in by.
        this.useRoom(0);
        this.respawnMain();
        b.x = this.pipeX - 2;
        b.y = this.pipeY;
      } else {
        this.saveMainEnts();
        this.enterRoom(to, true);
        const room = this.level.rooms[to];
        if (room) {
          b.x = room.startX * TILE + 1;
          b.y = (room.startY + 1) * TILE - b.h;
        }
      }
      b.vx = 0;
      b.vy = 0;
      this.snapCamera();
      this.events.push(EV.PIPE, b.x, b.y);
      return;
    }
    if (this.modeT <= 31 + 26) {
      if (this.pipeTo === 0) b.y -= 0.6;
      return;
    }
    if (this.pipeTo === 0) b.y = this.pipeY - b.h;
    this.mode = 'play';
    this.modeT = 0;
  }

  private saveMainEnts(): void {
    this.mainEnts = writeEnts(this.ents);
  }

  private respawnMain(): void {
    readEnts(this.ents, this.mainEnts);
    this.mainEnts = [];
  }

  /** The packet's head hit a block from below. */
  private bump(tx: number, ty: number): void {
    const tilesOf = this.grid.tiles;
    const at = ty * this.grid.w + tx;
    const tile = tilesOf[at] ?? T.EMPTY;
    const x = tx * TILE;
    const y = ty * TILE;
    const big = this.power > POWER.SMALL;
    this.events.push(EV.BUMP, x + 4, y + 8);
    this.knockAbove(tx, ty);
    switch (tile) {
      case T.BRICK:
        if (big) {
          tilesOf[at] = T.EMPTY;
          this.addScore(50, x, y);
          this.events.push(EV.BREAK, x + 4, y + 4);
          this.shake = Math.max(this.shake, 4);
        }
        break;
      case T.QBIT:
      case T.HIDDEN_BIT:
        tilesOf[at] = T.USED;
        this.popBit(x, y);
        break;
      case T.MULTI:
        // A few bits, then it's empty.
        this.popBit(x, y);
        if (this.rng.chance(0.15)) tilesOf[at] = T.USED;
        break;
      case T.QKEY: {
        tilesOf[at] = T.USED;
        const pop = this.spawn(K.POP_KEY, x, y - TILE);
        if (pop) pop.vy = -2.5;
        this.takeKey(this.room * 0x100000 + at, x, y);
        break;
      }
      case T.QPOWER:
      case T.HIDDEN_LIFE: {
        tilesOf[at] = T.USED;
        const kind = tile === T.HIDDEN_LIFE ? K.LIFE : this.power === POWER.SMALL ? K.RAM : this.rng.chance(0.2) ? K.LOCK : this.level.zone.power === 'fan' ? K.FAN : K.PING;
        const item = this.spawn(kind, x, y);
        if (item) {
          item.state = 1;
          item.t = 0;
          item.dir = 1;
        }
        this.events.push(EV.ITEM, x, y);
        break;
      }
      case T.SWITCH:
        this.switchOn = !this.switchOn;
        this.grid.switchOn = this.switchOn;
        this.events.push(EV.SWITCH, x, y);
        this.unstick();
        break;
      default:
        break;
    }
  }

  private popBit(x: number, y: number): void {
    const pop = this.spawn(K.POP_BIT, x, y - TILE);
    if (pop) pop.vy = -3;
    this.addBits(1, x, y);
  }

  /** Bugs standing on a bumped block get knocked off it. */
  private knockAbove(tx: number, ty: number): void {
    const top = ty * TILE;
    for (const e of this.ents) {
      if (!isFoe(e.k) || e.state < 0) continue;
      if (e.x + e.w > tx * TILE && e.x < tx * TILE + TILE && Math.abs(e.y + e.h - top) < 2) this.kill(e, 100);
    }
  }

  private takeKey(code: number, x: number, y: number): void {
    if (this.keysGot.includes(code)) return;
    this.keysGot.push(code);
    this.keysTotal += 1;
    this.addScore(2000, x, y);
    this.events.push(EV.KEY, x, y);
  }

  /** Bits and keys the packet passes through. */
  private pickups(): void {
    const b = this.body;
    const g = this.grid;
    const tx0 = Math.floor(b.x / TILE);
    const tx1 = Math.floor((b.x + b.w - 0.01) / TILE);
    const ty0 = Math.floor(b.y / TILE);
    const ty1 = Math.floor((b.y + b.h - 0.01) / TILE);
    for (let ty = ty0; ty <= ty1; ty += 1) {
      for (let tx = tx0; tx <= tx1; tx += 1) {
        if (tx < 0 || ty < 0 || tx >= g.w || ty >= g.h) continue;
        const at = ty * g.w + tx;
        const tile = g.tiles[at];
        if (tile === T.BIT) {
          g.tiles[at] = T.EMPTY;
          this.addBits(1, tx * TILE + 4, ty * TILE + 4);
        } else if (tile === T.KEY) {
          g.tiles[at] = T.EMPTY;
          this.takeKey(this.room * 0x100000 + at, tx * TILE + 4, ty * TILE + 4);
        }
      }
    }
  }

  hurt(): void {
    if (this.invuln > 0 || this.star > 0 || this.mode !== 'play') return;
    if (this.power === POWER.SMALL) return this.die();
    this.power = this.power === POWER.BIG ? POWER.SMALL : POWER.BIG;
    this.invuln = HURT_TICKS;
    this.hitstop = 6;
    this.shake = 6;
    this.body.canGlide = false;
    if (this.power === POWER.SMALL) this.shrink();
    this.events.push(EV.HURT, this.body.x, this.body.y);
  }

  private grow(): void {
    const b = this.body;
    if (b.h === BIG_H) return;
    if (!fits(b, this.grid, BIG_H)) {
      // No room overhead yet: grow once there is.
      this.growing = 1;
      return;
    }
    if (b.gd === 1) b.y -= BIG_H - SMALL_H;
    b.h = BIG_H;
  }

  private shrink(): void {
    const b = this.body;
    if (b.h === SMALL_H) return;
    if (b.gd === 1) b.y += BIG_H - SMALL_H;
    b.h = SMALL_H;
  }

  private die(): void {
    if (this.mode !== 'play') return;
    this.mode = 'dying';
    this.modeT = 0;
    this.body.vy = -3.2;
    this.body.vx = 0;
    this.star = 0;
    this.hitstop = 14;
    this.shake = 8;
    this.events.push(EV.DIE, this.body.x, this.body.y);
  }

  private stepDying(): void {
    const b = this.body;
    if (this.modeT > 16) {
      b.vy = Math.min(4, b.vy + 0.18);
      b.y += b.vy;
    }
    if (this.modeT < 130) return;
    this.lives -= 1;
    this.power = POWER.SMALL;
    if (this.lives <= 0) {
      this.mode = 'over';
      this.modeT = 0;
      this.best = Math.max(this.best, this.hopNumber());
      this.events.push(EV.GAME_OVER);
      return;
    }
    this.startHop(true);
  }

  /** After a game over: back to the zone's first hop with fresh lives. */
  continueZone(): void {
    this.hop = 1;
    this.lives = START_LIVES;
    this.score = 0;
    this.keysGot = [];
    this.power = POWER.SMALL;
    this.startHop(false);
  }

  /** The hop number across the whole game: zone 2's first is hop 5. */
  hopNumber(): number {
    return (this.zone - 1) * HOPS_PER_ZONE + this.hop;
  }

  private clear(by: number): void {
    if (this.mode !== 'play') return;
    this.mode = 'clear';
    this.modeT = 0;
    this.clearedBy = by;
    this.star = 0;
    this.body.vx = 0;
    this.opened = this.world.clear(this.zone, this.hop, by, this.keysGot, this.hopTicks);
    // All three of the hop's keys: a life and a bonus.
    if (this.keysGot.length >= 3) {
      this.addScore(5000, this.body.x, this.body.y - 10);
      this.oneUp(this.body.x, this.body.y);
    }
    this.events.push(by === 1 ? EV.SECRET : EV.CLEAR, this.body.x, this.body.y);
  }

  private stepClear(): void {
    const b = this.body;
    if (this.clearedBy === 0 && this.modeT < 60) {
      // Slide down the flag, then walk on.
      b.vy = 0;
      b.y = Math.min(b.y + 1.5, this.flagFoot() - b.h);
      return;
    }
    if (this.modeT < 150) {
      if (this.clearedBy === 0) {
        b.x += 0.7;
        b.y = this.flagFoot() - b.h;
      }
      return;
    }
    this.nextHop();
  }

  private flagFoot(): number {
    for (const e of this.ents) if (e.k === K.GOAL) return e.y + e.h;
    return this.body.y + this.body.h;
  }

  private nextHop(): void {
    this.keysGot = [];
    this.checkX = -1;
    this.checkY = -1;
    if (this.clearedBy === 1 || this.hop >= HOPS_PER_ZONE) {
      this.zone += 1;
      this.hop = 1;
    } else {
      this.hop += 1;
    }
    this.best = Math.max(this.best, this.hopNumber());
    this.startHop(false);
  }

  private startBoss(): void {
    this.bossOn = true;
    const tilesOf = this.grid.tiles;
    for (let i = 0; i < tilesOf.length; i += 1) if (tilesOf[i] === T.GATE) tilesOf[i] = T.GATE_SHUT;
    const boss = this.bossEnt;
    if (boss) {
      boss.active = true;
      boss.state = 0;
      boss.t = 0;
    }
    this.shake = 10;
    this.events.push(EV.BOSS_START);
  }

  /** The boss is beaten: the flag comes down in the arena. */
  bossBeaten(e: Ent): void {
    this.addScore(10000, e.x, e.y);
    this.events.push(EV.BOSS_DIE, e.x + e.w / 2, e.y + e.h / 2);
    this.shake = 24;
    this.hitstop = 20;
    const room = this.level.rooms[0];
    if (!room) return;
    const flag = this.spawn(K.GOAL, (room.w - 7) * TILE, (RUN_H - 3) * TILE);
    if (flag) {
      // Stand it on the arena floor.
      for (let ty = 2; ty < room.h; ty += 1) {
        if (solidAt(this.grid, Math.floor((flag.x + 2) / TILE), ty)) {
          flag.y = ty * TILE - flag.h;
          break;
        }
      }
    }
  }

  private stepChase(): void {
    const speed = this.level.chase;
    if (speed === 0 || !this.main || this.tick < 90) return;
    const b = this.body;
    if (this.level.kind === 'climb') {
      // The purge rises from below, never far off screen.
      this.chase = Math.min(this.chase - speed, this.camY + this.viewH + 30);
      if (b.y + b.h > this.chase + 3) this.die();
    } else {
      this.chase = Math.max(this.chase + speed, this.camX - 40);
      if (b.x < this.chase + 4) this.die();
    }
  }

  private stepEnts(): void {
    const b = this.body;
    const left = this.camX - 24;
    const right = this.camX + this.viewW + 24;
    const top = this.camY - 32;
    const bottom = this.camY + this.viewH + 32;
    for (const e of this.ents) {
      if (e.k === 0) continue;
      if (!e.active) {
        // Woken once on screen, and from then on.
        if (e.x + e.w > left && e.x < right && e.y + e.h > top && e.y < bottom) e.active = true;
        else if (!isPlatform(e.k)) continue;
      }
      this.stepEnt(e);
      if (e.k === 0) continue;
      // Gone off the bottom, or a shot gone off screen.
      if (e.y > this.grid.h * TILE + 40 && !isPlatform(e.k)) e.k = 0;
      else if (isShot(e.k) && (e.x < this.camX - 60 || e.x > this.camX + this.viewW + 60)) e.k = 0;
      if (e.k !== 0 && e.state >= 0 && this.mode === 'play') this.touch(e, b);
    }
  }

  private stepEnt(e: Ent): void {
    const b = this.body;
    if (e.state < 0) {
      // Dying: squashed flat for a moment, or knocked off the screen.
      e.t += 1;
      if (e.state === -2) {
        e.vy += GRAVITY;
        e.y += e.vy;
        e.x += e.vx;
      }
      if ((e.state === -1 && e.t > 24) || e.t > 120) e.k = 0;
      return;
    }
    const px = b.x + b.w / 2;
    const ex = e.x + e.w / 2;
    switch (e.k) {
      case K.CRAWLER:
        this.walker(e, 0.35, this.zone >= 5);
        break;
      case K.ZIP:
        this.walker(e, 0.4, this.zone >= 8);
        break;
      case K.SHELL:
        if (e.vx === 0) {
          e.t += 1;
          if (e.t > 360) this.becomeZip(e);
        } else {
          e.t2 = Math.max(0, e.t2 - 1);
        }
        this.fall(e);
        if (this.moveEnt(e) & HIT_WALL) {
          e.vx = -e.vx;
          this.events.push(EV.BUMP, e.x, e.y);
        }
        if (e.vx !== 0) this.shellHits(e);
        break;
      case K.MOTH:
        e.t += 1;
        e.x += e.dir * 0.32;
        e.y = e.oy + Math.sin(e.t * 0.05) * 14;
        if (e.t % 200 === 0) e.dir = px < ex ? -1 : 1;
        break;
      case K.FLEA:
        this.fall(e);
        if (e.onGround) {
          e.vx = 0;
          e.t += 1;
          if (e.t > 70 + (this.rng.state % 40)) {
            e.t = 0;
            this.rng.next();
            e.dir = px < ex ? -1 : 1;
            e.vx = e.dir * 0.8;
            e.vy = -3.2;
          }
        }
        if (this.moveEnt(e) & HIT_WALL) e.vx = -e.vx;
        break;
      case K.WORM: {
        const near = Math.abs(px - ex) < 88 && Math.abs(b.y - e.y) < 40;
        if (near) e.dir = px < ex ? -1 : 1;
        const target = near ? 1.05 : 0.3;
        e.vx += (e.dir * target - e.vx) * 0.04;
        this.fall(e);
        if (this.moveEnt(e) & HIT_WALL) {
          e.dir = -e.dir;
          e.vx = 0;
        }
        e.t += 1;
        break;
      }
      case K.VIRUS:
        this.walker(e, 0.25, true);
        e.t += 1;
        break;
      case K.SPAMMER:
        this.fall(e);
        this.moveEnt(e);
        e.dir = px < ex ? -1 : 1;
        e.t += 1;
        if (e.t > 110 && Math.abs(px - ex) < 120) {
          e.t = 0;
          const shot = this.spawn(K.SHOT_SPAM, e.x, e.y - 4);
          if (shot) {
            shot.vx = e.dir * (0.8 + Math.min(1, Math.abs(px - ex) / 120));
            shot.vy = -2.6;
          }
        }
        break;
      case K.CRON:
        e.t += 1;
        if (e.t > 150 && Math.abs(px - ex) < 130 && Math.abs(px - ex) > 12) {
          e.t = 0;
          e.dir = px < ex ? -1 : 1;
          const shot = this.spawn(K.SHOT_BULLET, e.x + e.dir * 8, e.y - 1);
          if (shot) {
            shot.vx = e.dir * 1.35;
            shot.dir = e.dir;
          }
          this.events.push(EV.SHOOT, e.x, e.y);
        }
        break;
      case K.LEAK:
        e.t += 1;
        if (e.t > 80 && Math.abs(px - ex) < 40) {
          e.t = 0;
          this.spawn(K.SHOT_DROP, e.x, e.y + 2);
        }
        break;
      case K.PHISH:
        e.t += 1;
        e.x += e.dir * 0.45;
        e.y = e.oy + Math.sin(e.t * 0.04) * 6;
        if (this.moveEnt(e) & HIT_WALL || e.t % 240 === 0) e.dir = -e.dir;
        if (Math.abs(b.y - e.y) < 8 && Math.abs(px - ex) < 64 && (px - ex) * e.dir > 0) e.x += e.dir * 0.6;
        break;
      case K.SHOT_PING:
        e.t += 1;
        e.vy = Math.min(3, e.vy + 0.25);
        {
          const hit = this.moveEnt(e);
          if (hit & HIT_FLOOR) e.vy = -1.9;
          if (hit & HIT_WALL || e.t > 100) {
            e.k = 0;
            this.events.push(EV.SPLASH, e.x, e.y);
            break;
          }
        }
        this.pingHits(e);
        break;
      case K.SHOT_SPAM:
      case K.SHOT_DROP:
        e.vy = Math.min(3, e.vy + (e.k === K.SHOT_DROP ? 0.14 : 0.12));
        if (this.moveEnt(e) !== 0) {
          e.k = 0;
          this.events.push(EV.SPLASH, e.x, e.y);
        }
        break;
      case K.SHOT_BULLET:
        e.x += e.vx;
        if (solidAt(this.grid, Math.floor((e.x + (e.vx > 0 ? e.w : 0)) / TILE), Math.floor((e.y + e.h / 2) / TILE)) && e.t > 8) {
          e.k = 0;
          this.events.push(EV.SPLASH, e.x, e.y);
        }
        e.t += 1;
        break;
      case K.SHOT_BOSS:
        e.t += 1;
        if (e.state === 1) e.vy = Math.min(3, e.vy + 0.1);
        e.x += e.vx;
        e.y += e.vy;
        if (e.t > 8 && solidAt(this.grid, Math.floor((e.x + e.w / 2) / TILE), Math.floor((e.y + e.h / 2) / TILE))) {
          if (e.state === 1 && e.c === 0) {
            // A bomb: bursts into sparks along the ground.
            for (const dir of [-1, 1]) {
              const spark = this.spawn(K.SHOT_BOSS, e.x, e.y - 8);
              if (spark) {
                spark.vx = dir * 1.2;
                spark.vy = 0;
                spark.c = 1;
                spark.t = 9;
              }
            }
          }
          e.k = 0;
          this.events.push(EV.SPLASH, e.x, e.y);
        }
        if (e.t > 400) e.k = 0;
        break;
      case K.SHOT_WAVE:
        e.x += e.vx;
        e.t += 1;
        if (e.t > 140 || solidAt(this.grid, Math.floor((e.x + (e.vx > 0 ? e.w : 0)) / TILE), Math.floor((e.y + 2) / TILE))) e.k = 0;
        break;
      case K.RAM:
      case K.LIFE:
      case K.LOCK:
      case K.PING:
      case K.FAN:
        this.item(e);
        break;
      case K.POP_BIT:
      case K.POP_KEY:
        e.vy += 0.2;
        e.y += e.vy;
        e.t += 1;
        if (e.t > 22) e.k = 0;
        break;
      case K.CHECKPOINT:
        if (e.state === 1) e.t += 1;
        break;
      case K.BOSS:
        if (this.bossOn) updateBoss(this, e);
        break;
      default:
        break;
    }
  }

  private walker(e: Ent, speed: number, careful: boolean): void {
    if (e.vx === 0) e.vx = e.dir * speed;
    this.fall(e);
    const hit = this.moveEnt(e);
    if (hit & HIT_WALL) {
      e.dir = -e.dir;
      e.vx = e.dir * speed;
    } else if (careful && e.onGround && !this.groundAhead(e)) {
      e.dir = -e.dir;
      e.vx = e.dir * speed;
    }
    e.t += 1;
  }

  private groundAhead(e: Ent): boolean {
    const tx = Math.floor((e.dir > 0 ? e.x + e.w + 1 : e.x - 1) / TILE);
    const ty = Math.floor((e.y + e.h + 1) / TILE);
    return solidAt(this.grid, tx, ty) || ((FLAGS[tileAt(this.grid, tx, ty)] ?? 0) & F.ONEWAY) !== 0;
  }

  fall(e: Ent): void {
    e.vy = Math.min(3, e.vy + GRAVITY * this.level.tuning.gravityScale);
    if (this.grid.waterLine >= 0 && e.y > this.grid.waterLine * TILE) e.vy = Math.min(e.vy, 0.8);
  }

  /** Moves an entity through the tiles; says what it hit (1 wall, 2 floor, 4 ceiling). */
  moveEnt(e: Ent): number {
    const g = this.grid;
    let hit = 0;
    e.x += e.vx;
    if (e.vx !== 0) {
      const tx = e.vx > 0 ? Math.floor((e.x + e.w - 0.01) / TILE) : Math.floor(e.x / TILE);
      const ty0 = Math.floor(e.y / TILE);
      const ty1 = Math.floor((e.y + e.h - 0.01) / TILE);
      for (let ty = ty0; ty <= ty1; ty += 1) {
        if (solidAt(g, tx, ty)) {
          e.x = e.vx > 0 ? tx * TILE - e.w : (tx + 1) * TILE;
          hit |= HIT_WALL;
          break;
        }
      }
    }
    const prevBottom = e.y + e.h;
    e.y += e.vy;
    e.onGround = false;
    const tx0 = Math.floor(e.x / TILE);
    const tx1 = Math.floor((e.x + e.w - 0.01) / TILE);
    if (e.vy > 0) {
      const ty = Math.floor((e.y + e.h - 0.01) / TILE);
      for (let tx = tx0; tx <= tx1; tx += 1) {
        const oneway = ((FLAGS[tileAt(g, tx, ty)] ?? 0) & F.ONEWAY) !== 0 && prevBottom <= ty * TILE + 0.01;
        if (solidAt(g, tx, ty) || oneway) {
          e.y = ty * TILE - e.h;
          e.vy = 0;
          e.onGround = true;
          hit |= HIT_FLOOR;
          break;
        }
      }
    } else if (e.vy < 0) {
      const ty = Math.floor(e.y / TILE);
      for (let tx = tx0; tx <= tx1; tx += 1) {
        if (solidAt(g, tx, ty)) {
          e.y = (ty + 1) * TILE;
          e.vy = 0;
          hit |= HIT_CEILING;
          break;
        }
      }
    }
    return hit;
  }

  private item(e: Ent): void {
    if (e.state === 1) {
      // Rising out of its block.
      e.t += 1;
      e.y -= 0.5;
      if (e.t >= 16) {
        e.state = 0;
        e.t = 0;
      }
      return;
    }
    if (e.k === K.PING || e.k === K.FAN) return;
    const speed = e.k === K.LOCK ? 0.9 : 0.6;
    e.vx = e.dir * speed;
    this.fall(e);
    const hit = this.moveEnt(e);
    if (hit & HIT_WALL) e.dir = -e.dir;
    if (e.k === K.LOCK && hit & HIT_FLOOR) e.vy = -2.6;
  }

  private shellHits(shell: Ent): void {
    for (const e of this.ents) {
      if (e === shell || !isFoe(e.k) || e.state < 0) continue;
      if (overlap(shell, e)) {
        if (e.k === K.SHELL && e.vx !== 0) {
          this.kill(shell, 0);
          this.kill(e, 0);
          return;
        }
        this.combo += 1;
        this.kill(e, STOMP_SCORES[Math.min(STOMP_SCORES.length - 1, this.combo - 1)] ?? 8000);
      }
    }
  }

  private pingHits(shot: Ent): void {
    for (const e of this.ents) {
      if (e.k === 0 || e.state < 0) continue;
      if (!overlap(shot, e)) continue;
      if (isFoe(e.k)) {
        this.kill(e, 200);
        shot.k = 0;
        this.events.push(EV.SPLASH, shot.x, shot.y);
        return;
      }
      if (e.k === K.BOSS && this.bossOn) {
        shot.k = 0;
        this.damageBoss(e, 1);
        return;
      }
    }
  }

  damageBoss(e: Ent, amount: number): void {
    if (e.t2 > 0) return;
    e.hp -= amount;
    e.t2 = amount >= 4 ? 70 : 20;
    this.hitstop = amount >= 4 ? 8 : 2;
    this.shake = amount >= 4 ? 10 : 3;
    this.events.push(EV.BOSS_HIT, e.x + e.w / 2, e.y);
    if (e.hp <= 0) {
      e.state = -2;
      e.t = 0;
      e.vy = -3;
      e.vx = 0;
      this.bossBeaten(e);
    }
  }

  /** A bug is beaten: squashed by a stomp, or knocked off the screen. */
  kill(e: Ent, points: number, squash = false): void {
    if (e.state < 0) return;
    if (points > 0) this.addScore(points, e.x, e.y);
    e.state = squash ? -1 : -2;
    e.t = 0;
    e.vy = squash ? 0 : -2.4;
    e.vx = squash ? 0 : (this.body.x < e.x ? 0.8 : -0.8);
    this.events.push(EV.KILL, e.x + e.w / 2, e.y + e.h / 2);
  }

  private becomeShell(e: Ent): void {
    const bottom = e.y + e.h;
    e.k = K.SHELL;
    e.w = 8;
    e.h = 7;
    e.y = bottom - e.h;
    e.vx = 0;
    e.t = 0;
  }

  private becomeZip(e: Ent): void {
    const bottom = e.y + e.h;
    e.k = K.ZIP;
    e.h = 10;
    e.y = bottom - e.h;
    e.vx = 0;
    e.dir = this.body.x < e.x ? -1 : 1;
    e.t = 0;
  }

  /** What happens when the packet touches something. */
  private touch(e: Ent, b: Body): void {
    if (!overlapBody(b, e)) return;
    const k = e.k;
    if (isItem(k)) {
      if (e.state === 1) return;
      return this.collect(e);
    }
    if (k === K.CHECKPOINT) {
      if (e.state === 0) {
        e.state = 1;
        this.checkX = e.x;
        this.checkY = e.y + e.h;
        this.addScore(500, e.x, e.y);
        this.events.push(EV.CHECK, e.x, e.y);
      }
      return;
    }
    if (k === K.GOAL) {
      // Higher up the flag, more points.
      const height = Math.max(0, Math.min(1, (e.y + e.h - (b.y + b.h)) / e.h));
      const points = [100, 400, 800, 2000, 5000][Math.min(4, Math.floor(height * 5))] ?? 100;
      this.flagBonus = points;
      this.addScore(points, b.x, b.y);
      b.x = e.x - b.w + 2;
      this.events.push(EV.FLAG, e.x, b.y);
      return this.clear(this.level.kind === 'core' ? 2 : 0);
    }
    if (k === K.BACKDOOR) {
      this.addScore(5000, b.x, b.y);
      return this.clear(1);
    }
    if (isPlatform(k) || k === K.CRON || k === K.POP_BIT || k === K.POP_KEY || k === K.SHOT_PING) return;
    if (k === K.BOSS) return this.touchBoss(e, b);

    const falling = b.vy * b.gd > 0.2 && b.gd === 1;
    const fromAbove = b.y + b.h - b.vy <= e.y + Math.max(4, e.h * 0.5);
    if (this.star > 0 && (isFoe(k) || isShot(k))) {
      if (isFoe(k)) {
        this.combo += 1;
        this.kill(e, STOMP_SCORES[Math.min(STOMP_SCORES.length - 1, this.combo - 1)] ?? 8000);
      }
      return;
    }
    if (k === K.SHELL && e.vx === 0) {
      // Kick a resting shell away from the packet.
      e.vx = (b.x + b.w / 2 < e.x + e.w / 2 ? 1 : -1) * SHELL_SPEED;
      e.t2 = 12;
      this.addScore(400, e.x, e.y);
      this.events.push(EV.KICK, e.x, e.y);
      if (falling && fromAbove) this.bounce(e);
      return;
    }
    if (k === K.SHELL && e.t2 > 0) return;
    const stompable = !isSpiky(k) && k !== K.PHISH && k !== K.LEAK;
    if (stompable && falling && fromAbove) {
      this.combo += 1;
      const points = this.combo > STOMP_SCORES.length ? 0 : (STOMP_SCORES[this.combo - 1] ?? 8000);
      if (this.combo > STOMP_SCORES.length) this.oneUp(e.x, e.y);
      if (k === K.ZIP) {
        this.becomeShell(e);
        this.addScore(points, e.x, e.y);
        this.events.push(EV.STOMP, e.x + e.w / 2, e.y);
      } else if (k === K.SHELL) {
        e.vx = 0;
        e.t = 0;
        this.events.push(EV.STOMP, e.x + e.w / 2, e.y);
      } else if (k === K.SHOT_BULLET || k === K.MOTH || k === K.FLEA) {
        this.kill(e, points);
        this.events.push(EV.STOMP, e.x + e.w / 2, e.y);
      } else {
        this.kill(e, points, true);
        this.events.push(EV.STOMP, e.x + e.w / 2, e.y);
      }
      this.bounce(e);
      return;
    }
    if (isFoe(k) || isShot(k)) this.hurt();
  }

  private bounce(e: Ent): void {
    const b = this.body;
    b.y = e.y - b.h;
    b.vy = -(this.prevA ? this.level.tuning.stompHoldV : this.level.tuning.stompV);
    b.jumping = true;
    b.onGround = false;
    this.flapped = false;
    this.hitstop = Math.max(this.hitstop, 3);
    this.squash = 1.3;
  }

  private touchBoss(e: Ent, b: Body): void {
    // Underground (the Rootkit) it can't be touched either way.
    if (e.state < 0 || e.a === 1) return;
    const falling = b.vy > 0.2 && b.gd === 1;
    const fromAbove = b.y + b.h - b.vy <= e.y + 6;
    if (falling && fromAbove) {
      this.bounce(e);
      // A guarded boss shrugs a stomp off (the charger until it's dazed).
      if (e.c === 1) {
        this.events.push(EV.BUMP, e.x, e.y);
        return;
      }
      this.damageBoss(e, 4);
      return;
    }
    if (this.star > 0) {
      this.damageBoss(e, 2);
      return;
    }
    this.hurt();
  }

  private collect(e: Ent): void {
    const k = e.k;
    e.k = 0;
    if (k === K.LIFE) return this.oneUp(e.x, e.y);
    if (k === K.LOCK) {
      this.star = STAR_TICKS;
      this.addScore(1000, e.x, e.y);
      this.events.push(EV.LOCK, e.x, e.y);
      return;
    }
    this.addScore(1000, e.x, e.y);
    const was = this.power;
    if (k === K.RAM) this.power = Math.max(this.power, POWER.BIG);
    else if (k === K.PING) this.power = POWER.PING;
    else if (k === K.FAN) this.power = POWER.FAN;
    this.body.canGlide = this.power === POWER.FAN;
    if (was === POWER.SMALL && this.power > POWER.SMALL) {
      this.growing = 1;
      this.hitstop = 10;
      this.events.push(EV.GROW, this.body.x, this.body.y);
    } else {
      this.hitstop = 6;
      this.events.push(EV.POWER, this.body.x, this.body.y);
    }
  }

  private updateCamera(): void {
    const b = this.body;
    const room = this.level.rooms[this.room];
    if (!room) return;
    const worldW = room.w * TILE;
    const worldH = room.h * TILE;
    // Look the way the packet faces, more when it runs.
    this.lookAhead += (b.facing * (12 + Math.abs(b.vx) * 14) - this.lookAhead) * 0.04;
    let targetX = b.x + b.w / 2 - this.viewW / 2 + this.lookAhead;
    let minX = 0;
    let maxX = worldW - this.viewW;
    if (this.bossOn && this.gateX >= 0) minX = (this.gateX - 1) * TILE;
    if (maxX < minX) {
      minX = (worldW - this.viewW) / 2;
      maxX = minX;
    }
    targetX = Math.max(minX, Math.min(maxX, targetX));
    this.camX += (targetX - this.camX) * 0.18;
    if (Math.abs(targetX - this.camX) < 0.05) this.camX = targetX;
    if (worldH <= this.viewH) {
      this.camY = (worldH - this.viewH) / 2;
    } else {
      const targetY = Math.max(0, Math.min(worldH - this.viewH, b.y + b.h / 2 - this.viewH * 0.55));
      this.camY += (targetY - this.camY) * 0.15;
    }
  }

  snapCamera(): void {
    this.lookAhead = 0;
    this.camX = -1e9;
    this.camY = -1e9;
    const b = this.body;
    const room = this.level.rooms[this.room];
    if (!room) return;
    const worldW = room.w * TILE;
    const worldH = room.h * TILE;
    const maxX = worldW - this.viewW;
    this.camX = maxX < 0 ? maxX / 2 : Math.max(0, Math.min(maxX, b.x - this.viewW / 2));
    this.camY = worldH <= this.viewH ? (worldH - this.viewH) / 2 : Math.max(0, Math.min(worldH - this.viewH, b.y - this.viewH * 0.55));
  }
}

const HIT_WALL = 1;
const HIT_FLOOR = 2;
const HIT_CEILING = 4;

function overlap(a: Ent, b: Ent): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function overlapBody(b: Body, e: Ent): boolean {
  // A little forgiveness: bugs' boxes are a pixel smaller for hurting.
  return b.x < e.x + e.w - 1 && b.x + b.w > e.x + 1 && b.y < e.y + e.h - 1 && b.y + b.h > e.y + 1;
}

/** The live entities as flat rows of ENT_FIELDS (shots and items left out when `lasting`). */
export function writeEnts(ents: readonly Ent[], lasting = true): number[] {
  const out: number[] = [];
  for (const e of ents) {
    if (e.k === 0 || (lasting && (isShot(e.k) || isItem(e.k)))) continue;
    for (const field of ENT_FIELDS) out.push(Number(e[field]));
  }
  return out;
}

/** Puts rows written by writeEnts back into the pool. */
export function readEnts(ents: readonly Ent[], rows: readonly number[]): void {
  for (const e of ents) e.reset();
  const stride = ENT_FIELDS.length;
  for (let i = 0, slot = 0; i + stride <= rows.length && slot < ents.length; i += stride, slot += 1) {
    const e = ents[slot];
    if (e) readEnt(e, rows, i);
  }
}

/** Reads an entity's saved fields back (the inverse of ENT_FIELDS). */
export function readEnt(e: Ent, from: readonly number[], at: number): void {
  e.k = from[at] ?? 0;
  e.x = from[at + 1] ?? 0;
  e.y = from[at + 2] ?? 0;
  e.w = from[at + 3] ?? 8;
  e.h = from[at + 4] ?? 8;
  e.vx = from[at + 5] ?? 0;
  e.vy = from[at + 6] ?? 0;
  e.dir = from[at + 7] ?? -1;
  e.state = from[at + 8] ?? 0;
  e.t = from[at + 9] ?? 0;
  e.t2 = from[at + 10] ?? 0;
  e.hp = from[at + 11] ?? 1;
  e.a = from[at + 12] ?? 0;
  e.b = from[at + 13] ?? 0;
  e.c = from[at + 14] ?? 0;
  e.ox = from[at + 15] ?? 0;
  e.oy = from[at + 16] ?? 0;
  e.onGround = (from[at + 17] ?? 0) !== 0;
  e.active = (from[at + 18] ?? 0) !== 0;
}
