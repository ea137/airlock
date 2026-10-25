// Builds a level from (seed, zone, hop), the same every time. A level is a
// paced run of hand-made chunks: a calm start, a build-up, the zone's
// twists, a checkpoint, a harder stretch and the flag (or, on the fourth
// hop, the core and its boss). Chunks don't repeat within a level and are
// avoided across a zone's hops; each is raised or lowered, maybe mirrored,
// and its bug slots filled from the zone's own roster.

import { ARENAS, BONUS_ROOMS, CHUNKS, type ChunkDef, CLIMBS } from './chunks';
import { FOE_KIND, K } from './kinds';
import { BASE, type Tuning } from './physics';
import { hash, Rng } from './rng';
import { CHAR_TILE, F, FLAGS, MIRROR, T } from './tiles';
import { type BossKind, type Twist, type Zone, zoneFor } from './zones';

export const RUN_H = 18;
export const CLIMB_W = 20;

export type Spawn = { k: number; x: number; y: number; a: number; b: number; c: number };

export type Room = {
  w: number;
  h: number;
  tiles: Uint8Array;
  spawns: Spawn[];
  /** The start cell, in tiles. */
  startX: number;
  startY: number;
  kind: 'run' | 'climb' | 'bonus';
};

/** A warp pipe: entering it at (tx, ty) in `room` leads to room `to`. */
export type Warp = { room: number; tx: number; ty: number; to: number };

export type Level = {
  seed: number;
  zone: Zone;
  hop: number;
  kind: 'run' | 'climb' | 'core';
  rooms: Room[];
  warps: Warp[];
  keys: number;
  tuning: Tuning;
  /** Gust strength, in pixels a tick; 0 is calm. */
  wind: number;
  /** The light's radius in the dark, in pixels; 0 is lit. */
  dark: number;
  /** How fast the purge chases (a wall from the left, or liquid rising); 0 is none. */
  chase: number;
  /** Ticks each set of beat blocks stays solid. */
  beatTicks: number;
  /** Rows from here down are water (swim zones); -1 is dry. */
  waterLine: number;
  boss: BossKind | null;
  chunks: string[];
};

const CHUNK_TWISTS: Twist[] = ['conv', 'spring', 'move', 'switch', 'beat', 'flip', 'water', 'ice'];
const CLIMB_TWISTS: Twist[] = ['spring', 'move', 'switch', 'beat'];

function isSolidChar(ch: string): boolean {
  const tile = CHAR_TILE[ch];
  return tile !== undefined && ((FLAGS[tile] ?? 0) & F.SOLID) !== 0;
}

function mirrored(def: ChunkDef): string[] {
  return def.rows.map((row) =>
    [...row]
      .reverse()
      .map((ch) => MIRROR[ch] ?? ch)
      .join(''),
  );
}

/** How many solid rows stand at the bottom of a column. */
function edgeHeight(rows: string[], column: number): number {
  let height = 0;
  for (let r = rows.length - 1; r >= 0; r -= 1) {
    if (!isSolidChar(rows[r]?.[column] ?? '.')) break;
    height += 1;
  }
  return height;
}

class Builder {
  readonly tiles: Uint8Array;
  readonly spawns: Spawn[] = [];
  readonly keySpots: { x: number; y: number }[] = [];
  readonly warps: { tx: number; ty: number }[] = [];
  startX = 1;
  startY = 1;

  constructor(
    readonly w: number,
    readonly h: number,
    private readonly rng: Rng,
    private readonly zone: Zone,
    private readonly density: number,
  ) {
    this.tiles = new Uint8Array(w * h);
  }

  get(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return T.EMPTY;
    return this.tiles[y * this.w + x] ?? T.EMPTY;
  }

  set(x: number, y: number, tile: number): void {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    this.tiles[y * this.w + x] = tile;
  }

  spawn(k: number, tx: number, ty: number, a = 0, b = 0, c = 0): void {
    this.spawns.push({ k, x: tx * 8, y: ty * 8, a, b, c });
  }

  /** Draws a chunk with its top row at map row `top`, starting at column `x0`. */
  stamp(rows: string[], x0: number, top: number, fillBelow: boolean): void {
    const rng = this.rng;
    rows.forEach((row, r) => {
      const y = top + r;
      for (let c = 0; c < row.length; c += 1) {
        const ch = row[c] ?? '.';
        const x = x0 + c;
        const tile = CHAR_TILE[ch];
        if (tile !== undefined) {
          this.set(x, y, tile);
          if (tile === T.WARP) this.warps.push({ tx: x, ty: y });
          continue;
        }
        this.set(x, y, T.EMPTY);
        switch (ch) {
          case '@':
            this.startX = x;
            this.startY = y;
            break;
          case 'C':
            this.spawn(K.CHECKPOINT, x, y);
            break;
          case 'F':
            this.spawn(K.GOAL, x, y);
            break;
          case '$':
            this.spawn(K.BACKDOOR, x, y);
            break;
          case 'e':
            if (rng.chance(this.density)) this.spawn(FOE_KIND[rng.pick(this.zone.ground)], x, y);
            break;
          case 'E':
            if (rng.chance(this.density)) this.spawn(FOE_KIND[rng.pick(this.zone.air)], x, y);
            break;
          case 'd':
            if (rng.chance(this.density * 0.85)) this.spawn(K.LEAK, x, y);
            break;
          case 'c':
            this.spawn(K.CRAWLER, x, y);
            break;
          case 'z':
            this.spawn(K.ZIP, x, y);
            break;
          case 'v':
            this.spawn(K.VIRUS, x, y);
            break;
          case 'j':
            this.spawn(K.FLEA, x, y);
            break;
          case 'y':
            this.spawn(K.MOTH, x, y);
            break;
          case 't':
            this.spawn(K.SPAMMER, x, y);
            break;
          case 'p':
            this.spawn(K.PHISH, x, y);
            break;
          case 'r':
            this.set(x, y, T.HARD);
            this.spawn(K.CRON, x, y);
            break;
          case 'k':
            this.keySpots.push({ x, y });
            break;
          default:
            break;
        }
      }
      this.platforms(row, rows, r, x0, y, top);
    });
    if (!fillBelow) return;
    const bottom = rows[rows.length - 1] ?? '';
    for (let c = 0; c < bottom.length; c += 1) {
      const ch = bottom[c] ?? '.';
      const fill = ch === '~' ? T.LIQUID : ch === ':' ? T.WATER : ch === 'X' ? T.HARD : isSolidChar(ch) && ch !== '^' ? T.GROUND : T.EMPTY;
      for (let y = top + rows.length; y < this.h; y += 1) this.set(x0 + c, y, fill);
    }
  }

  /** Moving, lifting and falling platforms drawn as runs of m, M and f. */
  private platforms(row: string, rows: string[], r: number, x0: number, y: number, top: number): void {
    for (let c = 0; c < row.length; c += 1) {
      const ch = row[c];
      if ((ch !== 'm' && ch !== 'M' && ch !== 'f') || row[c - 1] === ch) continue;
      let width = 0;
      while (row[c + width] === ch) width += 1;
      const x = (x0 + c) * 8;
      if (ch === 'f') {
        this.spawns.push({ k: K.PLAT_FALL, x, y: y * 8, a: 0, b: 0, c: width });
      } else if (ch === 'm') {
        let from = c;
        let to = c + width - 1;
        while (row[from - 1] === ',') from -= 1;
        while (row[to + 1] === ',') to += 1;
        this.spawns.push({ k: K.PLAT_H, x, y: y * 8, a: (x0 + from) * 8, b: (x0 + to - width + 1) * 8, c: width });
      } else {
        // The track is a column of commas above or below any of the lift's tiles.
        let column = c;
        for (let k = 0; k < width; k += 1) {
          if (rows[r - 1]?.[c + k] === ',' || rows[r + 1]?.[c + k] === ',') column = c + k;
        }
        let up = r;
        let down = r;
        while (rows[up - 1]?.[column] === ',') up -= 1;
        while (rows[down + 1]?.[column] === ',') down += 1;
        this.spawns.push({ k: K.PLAT_V, x, y: y * 8, a: (top + up) * 8, b: (top + down) * 8, c: width });
      }
    }
  }

  /** Picks which key spots hold the level's three keys, one from each part
   * of the way; the rest hold bits. */
  placeKeys(): number {
    const along = (spot: { x: number; y: number }) => (this.w > this.h ? spot.x : -spot.y);
    const spots = this.keySpots.slice().sort((a, b) => along(a) - along(b));
    const chosen = new Set<number>();
    for (let third = 0; third < 3; third += 1) {
      const from = Math.floor((spots.length * third) / 3);
      const to = Math.floor((spots.length * (third + 1)) / 3);
      if (to > from) chosen.add(from + this.rng.int(to - from));
    }
    spots.forEach((spot, i) => this.set(spot.x, spot.y, chosen.has(i) ? T.KEY : T.BIT));
    let placed = chosen.size;
    // Too few spots: a few bit blocks hold the rest, or failing those, bits.
    for (const [from, to] of [
      [T.QBIT, T.QKEY],
      [T.BIT, T.KEY],
    ] as const) {
      if (placed >= 3) break;
      const found: number[] = [];
      this.tiles.forEach((tile, i) => {
        if (tile === from) found.push(i);
      });
      for (const i of this.rng.shuffle(found)) {
        if (placed >= 3) break;
        this.tiles[i] = to;
        placed += 1;
      }
    }
    return placed;
  }

  /** Bushes, cables and the like on top of the ground. */
  decorate(waterLine: number): void {
    for (let x = 0; x < this.w; x += 1) {
      for (let y = 1; y < this.h; y += 1) {
        const tile = this.get(x, y);
        if (tile === T.EMPTY) continue;
        if ((tile === T.GROUND || tile === T.HARD) && this.get(x, y - 1) === T.EMPTY && (waterLine < 0 || y - 1 < waterLine) && this.rng.chance(0.16)) {
          this.set(x, y - 1, [T.DECOR_A, T.DECOR_B, T.DECOR_C][this.rng.int(3)] ?? T.DECOR_A);
        }
        break;
      }
    }
  }

  /** Ice zones: the top of the ground freezes. */
  freeze(share: number): void {
    for (let x = 0; x < this.w; x += 1) {
      for (let y = 0; y < this.h; y += 1) {
        const tile = this.get(x, y);
        if (tile === T.EMPTY || tile >= T.DECOR_A) continue;
        if (tile === T.GROUND && this.rng.chance(share)) this.set(x, y, T.ICE);
        break;
      }
    }
  }
}

type Picker = {
  rng: Rng;
  target: number;
  used: Set<string>;
  earlier: Set<string>;
};

function pick(list: readonly ChunkDef[], category: string, picker: Picker, twist: boolean): ChunkDef | null {
  const fits = list.filter((chunk) => (twist ? chunk.tags.includes(category) : chunk.tags[0] === category));
  if (fits.length === 0) return null;
  const weight = (chunk: ChunkDef) => {
    if (picker.used.has(chunk.id)) return 0;
    if (chunk.diff > picker.target + 1) return 0;
    return (picker.earlier.has(chunk.id) ? 0.15 : 1) / (1 + Math.abs(chunk.diff - picker.target) * 1.5);
  };
  if (fits.every((chunk) => weight(chunk) === 0)) {
    const unused = fits.filter((chunk) => !picker.used.has(chunk.id));
    const easiest = (unused.length > 0 ? unused : fits).slice().sort((a, b) => a.diff - b.diff);
    return easiest[0] ?? null;
  }
  return picker.rng.weighted(fits, weight);
}

/** The categories of a hop's chunks, in order. */
function plan(zone: Zone, hop: number, rng: Rng): string[] {
  const twists = zone.twists.filter((twist) => CHUNK_TWISTS.includes(twist));
  let secrets = 0;
  const generic = (): string => {
    const options = ['gap', 'stair', 'block', 'pipe', 'plat', 'foe', 'secret', 'easy'];
    const choice = rng.weighted(options, (option) => {
      if (option === 'secret') return secrets < (hop === 3 ? 2 : 1) ? 1.3 : 0;
      if (option === 'foe') return 2 + hop * 0.5;
      if (option === 'gap') return 3;
      if (option === 'easy') return hop === 1 ? 1.5 : 0.6;
      return 2;
    });
    if (choice === 'secret') secrets += 1;
    return choice;
  };
  const twist = (): string => (twists.length > 0 ? `+${rng.pick(twists)}` : generic());
  if (hop === 4) return ['start', 'fort', twist(), 'fort', 'foe', 'check', 'fort', twist(), 'fort', 'arena'];
  if (hop === 1) return ['start', 'easy', generic(), twist(), generic(), 'check', generic(), twist(), generic(), 'easy', 'goal'];
  if (hop === 2) return ['start', 'easy', twist(), generic(), generic(), 'check', twist(), generic(), twist(), generic(), 'goal'];
  return ['start', generic(), twist(), generic(), generic(), 'check', twist(), generic(), twist(), generic(), generic(), 'goal'];
}

function targetDifficulty(zone: Zone, hop: number): number {
  return Math.min(5, zone.tier + (hop >= 3 ? 1 : 0));
}

/** The chunk ids this zone's earlier hops used, so later hops avoid them. */
function earlierChunks(seed: number, zone: Zone, hop: number): Set<string> {
  const ids = new Set<string>();
  for (let earlier = 1; earlier < hop; earlier += 1) {
    for (const id of levelFor(seed, zone.index, earlier).chunks) ids.add(id);
  }
  return ids;
}

function tuningFor(zone: Zone): Tuning {
  return { ...BASE, gravityScale: zone.twists.includes('lowgrav') ? 0.68 : 1 };
}

function bonusRoom(rng: Rng): Room {
  const def = rng.pick(BONUS_ROOMS);
  const rows = rng.chance(0.5) ? def.rows : mirrored(def);
  const builder = new Builder(def.w, rows.length, rng, zoneFor(1, 1), 0);
  builder.stamp(rows, 0, 0, false);
  for (const spot of builder.keySpots) builder.set(spot.x, spot.y, T.BIT);
  return { w: def.w, h: rows.length, tiles: builder.tiles, spawns: builder.spawns, startX: builder.startX, startY: builder.startY, kind: 'bonus' };
}

function buildRun(seed: number, zone: Zone, hop: number, rng: Rng, density: number): { builder: Builder; ids: string[] } {
  const picker: Picker = { rng, target: targetDifficulty(zone, hop), used: new Set(), earlier: earlierChunks(seed, zone, hop) };
  const placed: { rows: string[]; base: number }[] = [];
  const ids: string[] = [];
  let prevOut = 2;
  let base = 1;
  for (const category of plan(zone, hop, rng)) {
    const twist = category.startsWith('+');
    const name = twist ? category.slice(1) : category;
    const list = name === 'arena' ? ARENAS : CHUNKS;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const chunk = pick(list, name, picker, twist);
      if (!chunk) break;
      const flip = !['start', 'goal', 'arena'].includes(name) && !chunk.tags.includes('nomirror') && rng.chance(0.4);
      const rows = flip ? mirrored(chunk) : chunk.rows;
      const inH = edgeHeight(rows, 0);
      const outH = edgeHeight(rows, chunk.w - 1);
      const maxBase = Math.max(0, Math.min(4, RUN_H - 1 - rows.length));
      // A gentle walk up and down; never a step taller than a jump.
      const wanted = name === 'arena' || name === 'start' ? [base] : [base - 1, base, base, base + 1];
      const options = wanted.map((b) => Math.max(0, Math.min(maxBase, b))).filter((b) => b + inH - prevOut <= 3);
      if (options.length === 0) {
        picker.used.add(chunk.id);
        continue;
      }
      base = rng.pick(options);
      picker.used.add(chunk.id);
      placed.push({ rows, base });
      ids.push(chunk.id);
      prevOut = base + outH;
      break;
    }
  }
  const tail = 4;
  const width = placed.reduce((sum, part) => sum + (part.rows[0]?.length ?? 0), 0) + tail;
  const builder = new Builder(width, RUN_H, rng, zone, density);
  let x = 0;
  for (const part of placed) {
    builder.stamp(part.rows, x, RUN_H - part.base - part.rows.length, true);
    x += part.rows[0]?.length ?? 0;
  }
  // A little ground past the end.
  for (let c = x; c < width; c += 1) {
    for (let y = RUN_H - 1 - base; y < RUN_H; y += 1) builder.set(c, y, T.GROUND);
  }
  return { builder, ids };
}

const CLIMB_START = ['....................', '.@..................', '####################'];
const CLIMB_GOAL = ['....................', '....................', '.........F..........', '......--------......', '....................', '....................'];

function buildClimb(zone: Zone, hop: number, rng: Rng, density: number, earlier: Set<string>): { builder: Builder; ids: string[] } {
  const twists = zone.twists.filter((twist) => CLIMB_TWISTS.includes(twist));
  const picker: Picker = { rng, target: targetDifficulty(zone, hop), used: new Set(), earlier };
  const parts: string[][] = [];
  const ids: string[] = [];
  const count = 6 + Math.min(3, zone.tier - 1);
  for (let i = 0; i < count; i += 1) {
    const twist = twists.length > 0 && i % 2 === 1;
    let chunk = pick(CLIMBS, twist ? rng.pick(twists) : 'climb', picker, twist);
    if (!chunk || picker.used.has(chunk.id)) chunk = pick(CLIMBS, 'climb', picker, false);
    if (!chunk) break;
    picker.used.add(chunk.id);
    ids.push(chunk.id);
    parts.push(rng.chance(0.5) && !chunk.tags.includes('nomirror') ? mirrored(chunk) : chunk.rows);
  }
  const stack = [CLIMB_GOAL, ...parts.reverse(), CLIMB_START];
  const height = stack.reduce((sum, rows) => sum + rows.length, 0);
  const builder = new Builder(CLIMB_W, height, rng, zone, density);
  let y = 0;
  for (const rows of stack) {
    builder.stamp(rows, 0, y, false);
    y += rows.length;
  }
  return { builder, ids };
}

const TEST_START = ['......', '......', '......', '.@....', '######'];
const TEST_GOAL = ['.....', '.....', '..F..', '#####'];

/**
 * One chunk between a short start and the flag, at ground level, for
 * checking chunks one by one. Climb chunks get a climb's start and top.
 */
export function chunkLevel(def: ChunkDef, flip: boolean, zoneIndex = 1): Level {
  const zone = zoneFor(1, zoneIndex);
  const rng = new Rng(hash(def.w, def.rows.length));
  const rows = flip ? mirrored(def) : def.rows;
  const climb = def.tags.includes('climb');
  const bonus = def.tags.includes('bonus');
  const parts = climb
    ? [CLIMB_GOAL, rows, CLIMB_START]
    : bonus
      ? [rows]
      : [TEST_START, rows, TEST_GOAL];
  const vertical = climb || bonus;
  const width = vertical ? def.w : parts.reduce((sum, part) => sum + (part[0]?.length ?? 0), 0);
  const height = vertical ? parts.reduce((sum, part) => sum + part.length, 0) : RUN_H;
  const builder = new Builder(width, height, rng, zone, 1);
  let at = 0;
  for (const part of parts) {
    if (vertical) {
      builder.stamp(part, 0, at, false);
      at += part.length;
    } else {
      builder.stamp(part, at, RUN_H - 1 - part.length, true);
      at += part[0]?.length ?? 0;
    }
  }
  const keys = builder.placeKeys();
  const room: Room = {
    w: width,
    h: height,
    tiles: builder.tiles,
    spawns: builder.spawns,
    startX: builder.startX,
    startY: builder.startY,
    kind: climb ? 'climb' : def.tags.includes('bonus') ? 'bonus' : 'run',
  };
  const water = def.tags.includes('water') && zone.twists.includes('water');
  return {
    seed: 1,
    zone,
    hop: 1,
    kind: climb ? 'climb' : def.tags.includes('arena') ? 'core' : 'run',
    rooms: [room],
    warps: [],
    keys,
    tuning: tuningFor(zone),
    wind: 0,
    dark: 0,
    chase: 0,
    beatTicks: def.tags.includes('beat') ? 100 : 0,
    waterLine: water ? 2 : -1,
    boss: null,
    chunks: [def.id],
  };
}

/** The level for this seed, zone and hop (1 to 4; 4 is the core). */
export function levelFor(seed: number, zoneIndex: number, hop: number): Level {
  const zone = zoneFor(seed, zoneIndex);
  const rng = new Rng(hash(seed, zoneIndex, hop, 1));
  const density = Math.min(0.95, 0.5 + zone.tier * 0.09 + hop * 0.03);
  const kind: Level['kind'] = hop === 4 ? 'core' : (zone.kinds[hop - 1] ?? 'run');
  const water = zone.twists.includes('water') && kind !== 'climb';
  const { builder, ids } =
    kind === 'climb' ? buildClimb(zone, hop, rng, density, earlierChunks(seed, zone, hop)) : buildRun(seed, zone, hop, rng, density);
  if (zone.twists.includes('ice')) builder.freeze(hop === 1 ? 0.45 : 0.85);
  const keys = builder.placeKeys();
  const waterLine = water ? 2 : -1;
  builder.decorate(waterLine);

  const main: Room = {
    w: builder.w,
    h: builder.h,
    tiles: builder.tiles,
    spawns: builder.spawns,
    startX: builder.startX,
    startY: builder.startY,
    kind: kind === 'climb' ? 'climb' : 'run',
  };
  const rooms = [main];
  const warps: Warp[] = [];
  for (const warp of builder.warps) {
    const room = bonusRoom(rng);
    rooms.push(room);
    warps.push({ room: 0, tx: warp.tx, ty: warp.ty, to: rooms.length - 1 });
  }
  if (kind === 'core') {
    // The boss waits in the arena's far half.
    const gate = main.tiles.indexOf(T.GATE);
    const gx = gate >= 0 ? gate % main.w : main.w - 24;
    main.spawns.push({ k: K.BOSS, x: (gx + 18) * 8, y: (RUN_H - 6) * 8, a: 0, b: 0, c: 0 });
  }

  const beat = zone.twists.includes('beat');
  const chase = zone.twists.includes('chase') ? (kind === 'climb' ? 0.2 + zone.tier * 0.015 : 0.58 + zone.tier * 0.03) : 0;
  return {
    seed,
    zone,
    hop,
    kind,
    rooms,
    warps,
    keys,
    tuning: tuningFor(zone),
    wind: zone.twists.includes('wind') ? 0.3 + zone.tier * 0.02 : 0,
    dark: zone.twists.includes('dark') ? (hop === 1 ? 68 : hop === 4 ? 60 : 52) : 0,
    chase: kind === 'core' ? 0 : chase,
    beatTicks: beat ? Math.round((4 * 3600) / zone.song.bpm) : 0,
    waterLine,
    boss: kind === 'core' ? zone.boss : null,
    chunks: ids,
  };
}
