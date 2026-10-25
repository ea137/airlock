// The world map. A game's progress hop by hop (left by its flag or by its
// backdoor, the keys found, the fastest clear), what that opens, and the
// map of it: each zone a subnet along one cable, its four hops nodes on
// it, the packet flying between them. Clearing a hop opens the next; a
// core's boss opens the next zone, and so does a backdoor, ahead of the
// rest of its own zone. The zones go on for ever, so the map shows those
// reached and the next one, still shut. No canvas in here.

import { HOPS_PER_ZONE, zoneFor } from './zones';

export type HopRecord = {
  /** Left by its flag (a core: its boss beaten). */
  cleared: boolean;
  /** Left by its backdoor, the secret exit. */
  backdoor: boolean;
  /** It has a backdoor: known once it's been visited. */
  secret: boolean;
  /** The keys found in its clears, by where each was (as the play counts them). */
  keys: number[];
  /** The fastest clear, in ticks; 0 is none yet. */
  time: number;
};

/** How a hop was left, as the play counts it: its flag, its backdoor, or its boss. */
export const BY_FLAG = 0;
export const BY_BACKDOOR = 1;
export const BY_BOSS = 2;

export type Spot = { zone: number; hop: number };

function blank(): HopRecord {
  return { cleared: false, backdoor: false, secret: false, keys: [], time: 0 };
}

const BLANK: Readonly<HopRecord> = Object.freeze(blank());

/** A hop's number across the game: zone 2's first is 5. */
export function hopNumber(zone: number, hop: number): number {
  return (zone - 1) * HOPS_PER_ZONE + hop;
}

/** A time in ticks as minutes, seconds and tenths: 0:42.5. */
export function clock(ticks: number): string {
  const tenths = Math.floor(ticks / 6);
  const minutes = Math.floor(tenths / 600);
  const seconds = Math.floor((tenths % 600) / 10);
  return `${minutes}:${String(seconds).padStart(2, '0')}.${tenths % 10}`;
}

function isRecord(value: unknown): value is HopRecord {
  if (!value || typeof value !== 'object') return false;
  const r = value as Partial<HopRecord>;
  return (
    typeof r.cleared === 'boolean' &&
    typeof r.backdoor === 'boolean' &&
    typeof r.secret === 'boolean' &&
    Array.isArray(r.keys) &&
    r.keys.every((key) => Number.isInteger(key)) &&
    typeof r.time === 'number' &&
    Number.isFinite(r.time)
  );
}

export class World {
  /** By hop number, from 1 (index 0). */
  private readonly hops: HopRecord[] = [];

  get(zone: number, hop: number): Readonly<HopRecord> {
    return this.hops[hopNumber(zone, hop) - 1] ?? BLANK;
  }

  private edit(zone: number, hop: number): HopRecord {
    const at = hopNumber(zone, hop) - 1;
    while (this.hops.length <= at) this.hops.push(blank());
    return this.hops[at] ?? blank();
  }

  open(zone: number, hop: number): boolean {
    if (zone < 1 || hop < 1 || hop > HOPS_PER_ZONE) return false;
    if (zone === 1 && hop === 1) return true;
    const own = this.get(zone, hop);
    if (own.cleared || own.backdoor) return true;
    if (hop > 1) return this.get(zone, hop - 1).cleared;
    if (this.get(zone - 1, HOPS_PER_ZONE).cleared) return true;
    for (let earlier = 1; earlier < HOPS_PER_ZONE; earlier += 1) if (this.get(zone - 1, earlier).backdoor) return true;
    return false;
  }

  /** The furthest zone with a hop open (they're open from the first on). */
  reach(): number {
    let zone = 1;
    while (this.zoneOpen(zone + 1)) zone += 1;
    return zone;
  }

  private zoneOpen(zone: number): boolean {
    for (let hop = 1; hop <= HOPS_PER_ZONE; hop += 1) if (this.open(zone, hop)) return true;
    return false;
  }

  /** A hop was entered: whether it has a backdoor, for the map to show. */
  visit(zone: number, hop: number, secret: boolean): void {
    if (secret && !this.get(zone, hop).secret) this.edit(zone, hop).secret = true;
  }

  /**
   * A hop was left by one of its exits (BY_FLAG, BY_BACKDOOR or BY_BOSS),
   * with the keys found on the way and the time it took. Keeps the keys
   * of every clear and the fastest time, and returns the hops it opened.
   */
  clear(zone: number, hop: number, by: number, keys: readonly number[], ticks: number): Spot[] {
    const next: Spot[] = by === BY_BACKDOOR || hop >= HOPS_PER_ZONE ? [{ zone: zone + 1, hop: 1 }] : [{ zone, hop: hop + 1 }];
    const shut = next.filter((spot) => !this.open(spot.zone, spot.hop));
    const record = this.edit(zone, hop);
    if (by === BY_BACKDOOR) {
      record.backdoor = true;
      record.secret = true;
    } else {
      record.cleared = true;
    }
    for (const key of keys) if (!record.keys.includes(key) && record.keys.length < 3) record.keys.push(key);
    if (ticks > 0 && (record.time === 0 || ticks < record.time)) record.time = ticks;
    return shut.filter((spot) => this.open(spot.zone, spot.hop));
  }

  keys(): number {
    return this.hops.reduce((sum, record) => sum + record.keys.length, 0);
  }

  save(): HopRecord[] {
    return this.hops.map((record) => ({ ...record, keys: record.keys.slice() }));
  }

  /** A world from a save, or null if it isn't one. */
  static from(saved: unknown): World | null {
    if (!Array.isArray(saved) || !saved.every(isRecord)) return null;
    const world = new World();
    for (const record of saved) world.hops.push({ ...record, keys: record.keys.slice(0, 3) });
    return world;
  }

  /**
   * The world of a game saved before there was a map: it had got as far
   * as this hop, so every hop before it counts as cleared.
   */
  static upTo(zone: number, hop: number): World {
    const world = new World();
    for (let n = 1; n < hopNumber(zone, hop); n += 1) world.hops.push({ ...blank(), cleared: true });
    return world;
  }
}

/** How wide each zone's stretch of the map is, in pixels. */
export const ZONE_W = 120;
/** The map stops here; below is the panel about the picked hop. */
export const PANEL_Y = 106;
/** Each hop's node within its zone: x, then y in zones 1, 3, 5… and in 2, 4, 6… */
const NODE_X = [18, 46, 74, 102];
const NODE_Y = [
  [74, 52, 76, 50],
  [52, 76, 50, 72],
];
const TAP_SLOP = 14;
const NEW_TICKS = 150;
/** The pause before the packet sets off for a hop a clear just opened. */
const ARRIVE_DELAY = 36;

export type MapNode = Spot & { x: number; y: number; open: boolean };
export type MapZone = { index: number; name: string; hue: number; boss: string; open: boolean };

/** What a press or a tap on the map asks for. */
export type MapAction = null | 'moved' | 'locked' | 'back' | Spot;

export type MapButton = 'left' | 'right' | 'up' | 'down' | 'a' | 'b';

export function nodeSpot(zone: number, hop: number): { x: number; y: number } {
  const row = NODE_Y[(zone - 1) % 2] ?? NODE_Y[0] ?? [];
  return { x: (zone - 1) * ZONE_W + (NODE_X[hop - 1] ?? 0), y: row[hop - 1] ?? 60 };
}

/**
 * The map on screen: its nodes, which one the packet is on (or flying
 * to), and the camera. Left and right go hop by hop, up and down zone by
 * zone, A plays the hop (if it's open) and B goes back; a tap picks a
 * node, and a tap on the picked one, or on the panel, plays it.
 */
export class WorldMap {
  readonly nodes: MapNode[] = [];
  readonly zones: MapZone[] = [];
  /** The node the packet is on, or flying to. */
  at = 0;
  /** Where the flight set off from. */
  private fromX = 0;
  private fromY = 0;
  private flight = 0;
  private flightTicks = 1;
  private facing = 1;
  /** Hops a clear just opened, marked new for a while. */
  readonly fresh = new Set<number>();
  private freshLeft = 0;
  /** A hop to fly to once the map has been seen (after a clear). */
  private next = -1;
  private wait = 0;
  /** A direction held from before the map came up doesn't walk until it's let go. */
  private armed = false;
  /** Ticks left of the shake that says a hop is locked. */
  denied = 0;
  camX = 0;
  ticks = 0;

  constructor(
    readonly world: World,
    seed: number,
    here: Spot,
    opened: readonly Spot[] = [],
    from: Spot | null = null,
  ) {
    const last = Math.max(world.reach(), here.zone) + 1;
    for (let zone = 1; zone <= last; zone += 1) {
      const info = zoneFor(seed, zone);
      let open = false;
      for (let hop = 1; hop <= HOPS_PER_ZONE; hop += 1) {
        const node = { zone, hop, ...nodeSpot(zone, hop), open: world.open(zone, hop) || (zone === here.zone && hop === here.hop) };
        open ||= node.open;
        this.nodes.push(node);
      }
      this.zones.push({ index: zone, name: info.name, hue: info.hue, boss: info.boss, open });
    }
    this.at = this.indexOf(from ?? here);
    for (const spot of opened) this.fresh.add(this.indexOf(spot));
    this.freshLeft = this.fresh.size > 0 ? NEW_TICKS : 0;
    if (from) {
      this.next = this.indexOf(here);
      this.wait = ARRIVE_DELAY;
    }
  }

  private indexOf(spot: Spot): number {
    const found = this.nodes.findIndex((node) => node.zone === spot.zone && node.hop === spot.hop);
    return found >= 0 ? found : 0;
  }

  get picked(): MapNode {
    return this.nodes[this.at] ?? { zone: 1, hop: 1, x: 0, y: 0, open: true };
  }

  get flying(): boolean {
    return this.flight > 0;
  }

  get width(): number {
    return this.zones.length * ZONE_W;
  }

  /** Where the packet is drawn: x, y (its feet on the node's top), and the way it faces. */
  packet(): { x: number; y: number; facing: number } {
    const to = this.picked;
    if (this.flight <= 0) return { x: to.x, y: to.y, facing: this.facing };
    const done = 1 - this.flight / this.flightTicks;
    // A hop of an arc on the way.
    const lift = Math.sin(done * Math.PI) * Math.min(14, Math.abs(to.x - this.fromX) * 0.3 + 4);
    return { x: this.fromX + (to.x - this.fromX) * done, y: this.fromY + (to.y - this.fromY) * done - lift, facing: this.facing };
  }

  private fly(to: number): void {
    const target = this.nodes[to];
    if (!target || to === this.at) return;
    const start = this.packet();
    this.fromX = start.x;
    this.fromY = start.y;
    this.at = to;
    this.facing = target.x >= start.x ? 1 : -1;
    const distance = Math.hypot(target.x - start.x, target.y - start.y);
    this.flightTicks = Math.max(8, Math.min(30, Math.round(distance / 3)));
    this.flight = this.flightTicks;
  }

  /** The first node of the zone `step` zones on from the picked one. */
  private zoneStep(step: number): number {
    const zone = Math.max(1, Math.min(this.zones.length, this.picked.zone + step));
    return this.indexOf({ zone, hop: 1 });
  }

  press(button: MapButton): MapAction {
    this.next = -1;
    this.armed = true;
    if (button === 'b') return 'back';
    if (button === 'a') {
      const node = this.picked;
      if (node.open) return { zone: node.zone, hop: node.hop };
      this.denied = 16;
      return 'locked';
    }
    const before = this.at;
    if (button === 'left') this.fly(this.at - 1);
    else if (button === 'right') this.fly(this.at + 1);
    else this.fly(this.zoneStep(button === 'down' ? 1 : -1));
    return this.at !== before ? 'moved' : null;
  }

  tap(x: number, y: number): MapAction {
    if (y >= PANEL_Y) return this.press('a');
    const mx = x + this.camX;
    let best = -1;
    let bestDistance = TAP_SLOP;
    this.nodes.forEach((node, i) => {
      const distance = Math.hypot(node.x - mx, node.y - y);
      if (distance <= bestDistance) {
        best = i;
        bestDistance = distance;
      }
    });
    if (best < 0) return null;
    if (best === this.at && !this.flying) return this.press('a');
    this.next = -1;
    this.fly(best);
    return 'moved';
  }

  /** One tick: the flight, the camera, and a direction held keeps going. */
  tick(held: { left: boolean; right: boolean }, view: number): MapAction {
    this.ticks += 1;
    if (this.freshLeft > 0) {
      this.freshLeft -= 1;
      if (this.freshLeft === 0) this.fresh.clear();
    }
    if (this.denied > 0) this.denied -= 1;
    if (!held.left && !held.right) this.armed = true;
    let action: MapAction = null;
    if (this.flight > 0) {
      this.flight -= 1;
    } else if (this.next >= 0) {
      if (this.wait > 0) this.wait -= 1;
      else {
        this.fly(this.next);
        this.next = -1;
        action = 'moved';
      }
    } else if (this.armed && held.left !== held.right) {
      action = this.press(held.left ? 'left' : 'right');
    }
    const target = Math.max(0, Math.min(this.width - view, this.packet().x - view / 2));
    const goal = this.width <= view ? (this.width - view) / 2 : target;
    this.camX = this.ticks === 1 ? goal : this.camX + (goal - this.camX) * 0.18;
    if (Math.abs(goal - this.camX) < 0.5) this.camX = goal;
    return action;
  }
}
