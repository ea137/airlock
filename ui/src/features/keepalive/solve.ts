// Tests only: works out where you can get to in an area with a given set
// of abilities, so the tests can check each puzzle can be solved with what
// the player has by then (and that some can't be without the ability they
// teach). It walks tiles, not pixels, using the sim's own numbers:
//
// - Blocks are pushed one tile at a time (heavy ones only with Sudo); one
//   pushed into the void fills it. Plates count as pressed under blocks.
// - Relays and lamps that stay lit are switched on by a ping from within
//   reach; a timed relay gives you as many tiles as you can walk before it
//   goes out (more with Cron holding time still).
// - Terminals (with Tel) set or flip the signals their scene names.
// - Float carries you over up to four tiles of void, again from a vent.
// - A gate that's open too briefly to walk through, or a sentry that never
//   looks away, needs time frozen (or the sentry switched off).
// - Things that move on a schedule (platforms, beams, crushers, turning
//   sentries) are timing, not walls: you can always wait for them.
//
// The search is over block positions, signals set, and walls broken.

import { HOVER_TICKS, PING_RADIUS, WALK } from './sim';
import type { Story } from './story';
import { type Ability, type Area, alwaysSolid, isConveyor, isVoid, T, TILE } from './world';

/** Ticks to cross a tile, with a little to spare. */
const TICKS_PER_TILE = Math.ceil(TILE / WALK) + 2;
/** Tiles of void Float carries you over. */
export const HOVER_TILES = Math.floor((HOVER_TICKS * WALK) / TILE) - 1;
const FREEZE_EXTRA = 240;
/** A gate open less than this can't be walked through without freezing it. */
const GATE_MIN_OPEN = 24;
/** Beams whose arms pass this often a second (arms times turns) can't be dodged. */
export const FAST_BEAMS = 1.6;

export type Effects = { sig: number; flip: number };

export type Problem = {
  area: Area;
  abilities: ReadonlySet<Ability>;
  /** Story flags, for signals held by `when` and `latch` and for exits' conditions. */
  story: Story;
  /** What each terminal's scene does to the signals. */
  terminal: (scene: string) => Effects;
  /** Leave the blocks out altogether (an upper bound on what can be reached). */
  noBlocks?: boolean;
};

/** Blocks (a filled pit is -tile - 1), signals forced by terminals, relays and lamps lit, walls broken. */
type State = { blocks: number[]; forced: number; lit: number[]; broken: number[] };

function key(s: State): string {
  return `${s.blocks.join(',')}|${s.forced}|${s.lit.join(',')}|${s.broken.join(',')}`;
}

export class Solver {
  readonly area: Area;
  private readonly can: ReadonlySet<Ability>;
  private readonly story: Story;
  private readonly terminalFx: (scene: string) => Effects;
  /** Signals held on by the story, and which latch when they come on. */
  private readonly held: number;

  constructor(p: Problem) {
    this.area = p.area;
    this.can = p.abilities;
    this.story = p.story;
    this.terminalFx = p.terminal;
    let held = 0;
    p.area.signals.forEach((options, s) => {
      if ((options.when && p.story.test(options.when)) || (options.latch && p.story.has(options.latch))) held |= 1 << s;
    });
    this.held = held;
    this.noBlocks = p.noBlocks === true;
    this.hasBlocks = p.area.placed.some((one) => one.spec.t === 'block');
    this.sweptTiles();
  }

  private readonly noBlocks: boolean;
  private readonly hasBlocks: boolean;

  private spec(i: number) {
    return this.area.placed[this.area.at[i] ?? -1]?.spec;
  }

  /** The signals on in a state: plates under blocks, relays and lamps lit, forced, held. */
  private signals(s: State): number {
    const area = this.area;
    let sources = 0;
    let off = 0;
    for (let i = 0; i < area.tiles.length; i += 1) {
      const sig = area.sig[i] ?? 255;
      if (sig >= 16) continue;
      const tile = area.tiles[i];
      let on: boolean;
      // With the blocks left out, a plate counts as pressed: some block could be on it.
      if (tile === T.PLATE) on = this.noBlocks || s.blocks.includes(i);
      else if (tile === T.NODE || tile === T.LAMP) on = s.lit.includes(i);
      else continue;
      sources |= 1 << sig;
      if (!on) off |= 1 << sig;
    }
    return (sources & ~off) | s.forced | this.held;
  }

  private latching(): number {
    let mask = 0;
    this.area.signals.forEach((options, sig) => {
      if (options.latch) mask |= 1 << sig;
    });
    return mask;
  }

  private tileOf(s: State, i: number, filled: Set<number>): number {
    const tile = this.area.tiles[i] ?? T.WALL;
    if (tile === T.CRACKED && s.broken.includes(i)) return T.RUBBLE;
    if (filled.has(i)) return T.FILLED;
    return tile;
  }

  /** Whether Echo can stand on a tile (not counting blocks), given the signals. */
  private standable(s: State, i: number, on: number, filled: Set<number>, frozen: boolean): boolean {
    if (!(frozen && this.can.has('freeze')) && this.fastBeams.has(i)) return false;
    return this.standableTile(s, i, on, filled, frozen);
  }

  /** Tiles swept by beams turning too fast to slip between (an arm every ~half second): only frozen. */
  private readonly fastBeams = new Set<number>();
  /** Tiles a sentry that never looks away is looking at, in the state being searched. */
  private sight = new Set<number>();

  private sweptTiles(): void {
    const w = this.area.w;
    for (const p of this.area.placed) {
      const s = p.spec;
      if (s.t !== 'sweeper' || s.arms * s.speed < FAST_BEAMS) continue;
      for (let i = 0; i < this.area.tiles.length; i += 1) if (Math.hypot((i % w) - p.x, Math.floor(i / w) - p.y) <= s.length + 0.3) this.fastBeams.add(i);
    }
  }

  private standableTile(s: State, i: number, on: number, filled: Set<number>, frozen: boolean): boolean {
    const tile = this.tileOf(s, i, filled);
    if (alwaysSolid(tile)) return false;
    const sig = this.area.sig[i] ?? 255;
    const lit = sig < 16 && (on & (1 << sig)) !== 0;
    switch (tile) {
      case T.PIT:
      case T.VENT:
        // With the blocks left out, the void might have been filled by one.
        return this.onPlatformPath(i) || (this.noBlocks && this.hasBlocks);
      case T.HAZARD:
        return false;
      case T.DOOR:
        return lit;
      case T.SHUT:
        return !lit;
      case T.BRIDGE:
      case T.GHOST:
        return lit || this.onPlatformPath(i);
      case T.GATE: {
        const g = this.spec(i);
        return g?.t === 'gate' && (g.open >= GATE_MIN_OPEN || (frozen && this.can.has('freeze')));
      }
      default:
        return frozen || !this.sight.has(i);
    }
  }

  private platformTiles: Set<number> | null = null;

  /** Tiles a moving platform passes over: you can ride it there. */
  private onPlatformPath(i: number): boolean {
    if (!this.platformTiles) {
      const set = new Set<number>();
      for (const p of this.area.placed) {
        if (p.spec.t !== 'mover') continue;
        let x = p.x;
        let y = p.y;
        set.add(y * this.area.w + x);
        const path = p.spec.path;
        for (let k = 0; k + 1 < path.length; k += 2) {
          const dir = path[k] ?? 0;
          for (let n = 0; n < (path[k + 1] ?? 0); n += 1) {
            x += [0, 1, 0, -1][dir] ?? 0;
            y += [-1, 0, 1, 0][dir] ?? 0;
            set.add(y * this.area.w + x);
          }
        }
      }
      this.platformTiles = set;
    }
    return this.platformTiles.has(i);
  }

  /** What sentries that never turn (and aren't switched off) see down their lines, until something's in the way. */
  private sightOf(state: State, on: number): Set<number> {
    const seen = new Set<number>();
    const w = this.area.w;
    for (const p of this.area.placed) {
      const s = p.spec;
      if (s.t !== 'sentry' || s.turn > 0) continue;
      if (s.sig >= 0 && (on & (1 << s.sig)) !== 0) continue;
      const dx = [0, 1, 0, -1][s.dir] ?? 0;
      const dy = [-1, 0, 1, 0][s.dir] ?? 0;
      for (let k = 1; k <= s.range; k += 1) {
        const x = p.x + dx * k;
        const y = p.y + dy * k;
        if (x < 0 || y < 0 || x >= w || y >= this.area.h) break;
        const at = y * w + x;
        if (alwaysSolid(this.area.tiles[at] ?? T.WALL) || state.blocks.includes(at)) break;
        seen.add(at);
      }
    }
    return seen;
  }

  /** Tiles blocked by something standing there: blocks, people, sentries, solid bosses. */
  private standing(s: State): Set<number> {
    const set = new Set<number>(s.blocks);
    const w = this.area.w;
    for (const p of this.area.placed) {
      const t = p.spec.t;
      if (t === 'sentry' || t === 'boss' || (t === 'npc' && this.story.test(p.spec.if))) set.add(p.y * w + p.x);
    }
    return set;
  }

  /**
   * Every tile reachable from `from` in a state: walking, hovering, riding,
   * and rushing across what a timed relay lights up.
   */
  reach(s: State, from: number[]): Set<number> {
    const filled = new Set<number>();
    for (const b of s.blocks) if (b < 0) filled.add(-b - 1);
    const blocks = this.standing(s);
    this.airborne = new Set();
    const on = this.signals(s);
    this.sight = this.sightOf(s, on);
    const seen = new Set<number>();
    const queue: number[] = [];
    for (const i of from) {
      if (!seen.has(i)) {
        seen.add(i);
        queue.push(i);
      }
    }
    const w = this.area.w;
    const h = this.area.h;
    const frozen = this.can.has('freeze');
    const neighbours = (i: number): number[] => {
      const x = i % w;
      const y = Math.floor(i / w);
      const out: number[] = [];
      if (x > 0) out.push(i - 1);
      if (x < w - 1) out.push(i + 1);
      if (y > 0) out.push(i - w);
      if (y < h - 1) out.push(i + w);
      return out;
    };
    const walk = (signals: number, limit: number, starts: number[]): number[] => {
      const found: number[] = [];
      const depth = new Map<number, number>();
      const q: number[] = [];
      for (const i of starts) {
        depth.set(i, 0);
        q.push(i);
      }
      for (let head = 0; head < q.length; head += 1) {
        const i = q[head] ?? 0;
        const d = depth.get(i) ?? 0;
        found.push(i);
        if (d >= limit) continue;
        for (const n of neighbours(i)) {
          if (depth.has(n) || blocks.has(n)) continue;
          if (!this.standable(s, n, signals, filled, frozen)) continue;
          depth.set(n, d + 1);
          q.push(n);
        }
      }
      return found;
    };
    const hovered = new Set<number>();
    let grew = true;
    while (grew) {
      grew = false;
      for (const i of walk(on, Infinity, queue.splice(0))) {
        if (!seen.has(i)) {
          seen.add(i);
          grew = true;
        }
      }
      const add = (i: number) => {
        if (seen.has(i)) return;
        seen.add(i);
        queue.push(i);
        grew = true;
      };
      // Float: over the void (and static), a vent lifts you again; from the edges, once each.
      if (this.can.has('hover')) {
        for (const start of [...seen]) {
          if (hovered.has(start)) continue;
          hovered.add(start);
          const edge = neighbours(start).some((n) => {
            const tile = this.tileOf(s, n, filled);
            return tile === T.PIT || tile === T.VENT || tile === T.HAZARD || tile === T.BRIDGE || tile === T.GHOST;
          });
          if (!edge) continue;
          const budget = new Map<number, number>([[start, HOVER_TILES + 1]]);
          const q = [start];
          for (let head = 0; head < q.length; head += 1) {
            const i = q[head] ?? 0;
            const left = budget.get(i) ?? 0;
            for (const n of neighbours(i)) {
              const tile = this.tileOf(s, n, filled);
              if (alwaysSolid(tile) || blocks.has(n)) continue;
              const overVoid = tile === T.PIT || tile === T.VENT || tile === T.HAZARD || ((tile === T.BRIDGE || tile === T.GHOST) && !this.standable(s, n, on, filled, frozen));
              const next = tile === T.VENT ? HOVER_TILES + 1 : left - 1;
              if (overVoid) {
                if (next > 0 && (budget.get(n) ?? -1) < next) {
                  budget.set(n, next);
                  q.push(n);
                  this.airborne.add(n);
                }
              } else if (this.standable(s, n, on, filled, frozen) && left > 0) {
                add(n);
              }
            }
          }
        }
      }
      // Timed relays: ping one in reach, then rush across what it lights.
      for (let i = 0; i < this.area.tiles.length; i += 1) {
        if (this.area.tiles[i] !== T.NODE) continue;
        const spec = this.spec(i);
        if (spec?.t !== 'node' || spec.time <= 0 || this.relaysOf(spec.sig).length > 1) continue;
        const from = [...seen].filter((t) => this.inPing(t, i));
        if (from.length === 0) continue;
        const limit = Math.floor((spec.time + (frozen ? FREEZE_EXTRA : 0)) / TICKS_PER_TILE);
        for (const t of walk(on | (1 << spec.sig), limit, from)) {
          // Only somewhere that stays solid once the relay goes out counts.
          if (this.standable(s, t, on, filled, frozen)) add(t);
        }
      }
    }
    return seen;
  }

  /** Whether a tile has walls on two sides at a right angle (a block there is stuck for good). */
  private corner(i: number): boolean {
    const w = this.area.w;
    const wall = (n: number, ok: boolean) => !ok || alwaysSolid(this.area.tiles[n] ?? T.WALL);
    const x = i % w;
    const y = Math.floor(i / w);
    const left = wall(i - 1, x > 0);
    const right = wall(i + 1, x < w - 1);
    const up = wall(i - w, y > 0);
    const down = wall(i + w, y < this.area.h - 1);
    return (left || right) && (up || down);
  }

  /** Spots over the void Float can carry you to, in the last reach (a ping works from there too). */
  airborne = new Set<number>();
  /** Every relay and lamp lit in any state the search found. */
  readonly litEver = new Set<number>();
  /** Every latching signal turned on in any state the search found. */
  readonly latchedEver = new Set<number>();

  private relaysOf(sig: number): number[] {
    const out: number[] = [];
    for (let i = 0; i < this.area.tiles.length; i += 1) {
      const spec = this.area.tiles[i] === T.NODE ? this.spec(i) : undefined;
      if (spec?.t === 'node' && spec.time > 0 && spec.sig === sig) out.push(i);
    }
    return out;
  }

  inPing(t: number, n: number): boolean {
    const w = this.area.w;
    const dx = ((t % w) - (n % w)) * TILE;
    const dy = (Math.floor(t / w) - Math.floor(n / w)) * TILE - 4;
    return Math.hypot(dx, dy) <= PING_RADIUS + 6;
  }

  /**
   * Like explore(), but quicker for rooms of blocks: tries moving one block
   * at a time, then two, then three (no puzzle here needs more moved).
   * Returns everything reached on the way.
   */
  search(start: number[], done: (reached: Set<number>) => boolean, maxStates = 20_000): Set<number> {
    // Only blocks that can move at all: light ones, and heavy ones with Sudo.
    const blocks = this.area.placed.filter((p) => p.spec.t === 'block');
    const free = blocks.flatMap((p, index) => (p.spec.t === 'block' && p.spec.heavy && !this.can.has('force') ? [] : [index]));
    const all = new Set<number>();
    const tries: number[][] = [[]];
    for (const a of free) tries.push([a]);
    for (const a of free) for (const b of free) if (a < b) tries.push([a, b]);
    for (const a of free) for (const b of free) for (const c of free) if (a < b && b < c) tries.push([a, b, c]);
    for (const movable of tries) {
      for (const i of this.explore(start, done, maxStates, movable)) all.add(i);
      if (done(all)) return all;
    }
    return all;
  }

  /**
   * Searches the states reachable from a start, and returns all the tiles
   * you can reach; it stops early once `done` says what's reached is enough.
   * With `movable`, only those blocks (by order) are pushed.
   */
  explore(start: number[], done: (reached: Set<number>) => boolean = () => false, maxStates = 20_000, movable?: number[]): Set<number> {
    const area = this.area;
    const w = area.w;
    const initial: State = {
      blocks: this.noBlocks ? [] : area.placed.filter((p) => p.spec.t === 'block').map((p) => p.y * w + p.x),
      forced: 0,
      lit: [],
      broken: [],
    };
    const heavy = new Set(area.placed.filter((p) => p.spec.t === 'block' && p.spec.heavy).map((p) => p.y * w + p.x));
    // Heavy blocks keep their weight as they move: track by index.
    const weights = initial.blocks.map((b) => heavy.has(b));
    const all = new Set<number>();
    const seen = new Set<string>();
    const queue: State[] = [initial];
    seen.add(key(initial));
    const latching = this.latching();
    while (queue.length > 0 && seen.size < maxStates) {
      const next = queue.shift();
      if (!next) break;
      // A latching signal that's come on is held from now on, as the game does.
      const on = this.signals(next) & latching;
      for (let sig = 0; sig < 16; sig += 1) if ((on & (1 << sig)) !== 0) this.latchedEver.add(sig);
      const s = (next.forced & on) === on ? next : { ...next, forced: next.forced | on };
      const reach = this.reach(s, start);
      for (const i of reach) all.add(i);
      for (const i of s.lit) this.litEver.add(i);
      if (done(all)) break;
      // A ping reaches from wherever you can stand, or float.
      const pingFrom = [...reach, ...this.airborne];
      const push = (next: State) => {
        const k = key(next);
        if (seen.has(k)) return;
        seen.add(k);
        queue.push(next);
      };
      for (let i = 0; i < area.tiles.length; i += 1) {
        const tile = area.tiles[i];
        if (tile !== T.NODE && tile !== T.LAMP) continue;
        const spec = this.spec(i);
        if (tile === T.NODE && spec?.t === 'node' && spec.time > 0) continue;
        if (s.lit.includes(i)) continue;
        if (!pingFrom.some((t) => this.inPing(t, i))) continue;
        this.litEver.add(i);
        push({ ...s, lit: [...s.lit, i].sort((a, b) => a - b) });
      }
      // Several timed relays on one latching signal: all lit at once, by one
      // ping that reaches them all, or one after another with time frozen.
      for (let sig = 0; sig < 16; sig += 1) {
        const relays = this.relaysOf(sig);
        if (relays.length < 2 || (latching & (1 << sig)) === 0 || (s.forced & (1 << sig)) !== 0) continue;
        const inReach = relays.every((r) => pingFrom.some((t) => this.inPing(t, r)));
        const together = pingFrom.some((t) => relays.every((r) => this.inPing(t, r)));
        if (inReach && (together || this.can.has('freeze'))) {
          for (const r of relays) this.litEver.add(r);
          push({ ...s, forced: s.forced | (1 << sig) });
        }
      }
      // Break cracked walls next to where you can stand.
      if (this.can.has('force')) {
        for (let i = 0; i < area.tiles.length; i += 1) {
          if (area.tiles[i] !== T.CRACKED || s.broken.includes(i)) continue;
          if (!beside(area, i).some((n) => reach.has(n))) continue;
          push({ ...s, broken: [...s.broken, i].sort((a, b) => a - b) });
        }
      }
      // Terminals: Tel has a word, and the signals change.
      if (this.can.has('talk')) {
        for (const p of area.placed) {
          if (p.spec.t !== 'terminal') continue;
          const i = p.y * w + p.x;
          if (!beside(area, i).some((n) => reach.has(n))) continue;
          const fx = this.terminalFx(p.spec.scene);
          push({ ...s, forced: (s.forced | fx.sig) ^ fx.flip });
        }
      }
      // Push blocks: stand behind one, push it a tile.
      s.blocks.forEach((b, index) => {
        if (b < 0 || (movable && !movable.includes(index))) return;
        if (weights[index] && !this.can.has('force')) return;
        for (const [d, back] of [
          [1, -1],
          [-1, 1],
          [w, -w],
          [-w, w],
        ] as const) {
          const stand = b + back;
          const to = b + d;
          if (!reach.has(stand)) continue;
          if ((d === 1 || d === -1) && Math.floor(to / w) !== Math.floor(b / w)) continue;
          if (to < 0 || to >= area.tiles.length) continue;
          const tile = this.tileOf(s, to, new Set(s.blocks.filter((x) => x < 0).map((x) => -x - 1)));
          if (alwaysSolid(tile) || s.blocks.includes(to) || this.standing(s).has(to)) continue;
          // A block pushed into a corner never comes out: only worth it onto a plate.
          if (tile !== T.PLATE && !isVoid(tile) && this.corner(to)) continue;
          const on = this.signals(s);
          const intoVoid = tile === T.PIT || tile === T.VENT || ((tile === T.BRIDGE || tile === T.GHOST) && (on & (1 << (area.sig[to] ?? 31))) === 0);
          if (tile === T.DOOR && (on & (1 << (area.sig[to] ?? 31))) === 0) continue;
          if (tile === T.GATE) continue;
          const blocks = s.blocks.slice();
          // A block in the void fills it: it stays in the list as a filled tile.
          blocks[index] = intoVoid ? -to - 1 : to;
          push({ ...s, blocks });
        }
      });
    }
    return all;
  }

}

/** The tiles beside one, inside the area (never wrapping round an edge). */
export function beside(area: Area, i: number): number[] {
  const x = i % area.w;
  const y = Math.floor(i / area.w);
  const out: number[] = [];
  if (x > 0) out.push(i - 1);
  if (x < area.w - 1) out.push(i + 1);
  if (y > 0) out.push(i - area.w);
  if (y < area.h - 1) out.push(i + area.w);
  return out;
}

/** Tiles where an area can be walked into: the tiles next to its ways in, and its '@'. */
export function entrances(area: Area): number[] {
  const out: number[] = [];
  const w = area.w;
  for (const p of area.placed) {
    if (p.spec.t !== 'exit') continue;
    const i = p.y * w + p.x;
    for (const n of beside(area, i)) {
      const tile = area.tiles[n];
      if (tile !== undefined && !alwaysSolid(tile) && tile !== T.PIT) out.push(n);
    }
  }
  const at = area.marks.get('@');
  if (at !== undefined) out.push(at);
  return out;
}

export function isFloorish(tile: number): boolean {
  return !alwaysSolid(tile) && tile !== T.PIT && tile !== T.VENT && !isConveyor(tile);
}
