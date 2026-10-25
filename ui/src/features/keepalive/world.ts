// The places of Keepalive, written as rows of characters: '#' a wall, '.'
// floor, ' ' the void, and so on (LEGEND), plus each area's own letters for
// the things in it: a door on a signal, someone to talk to, a way out.
// parse() turns an area into tiles and a list of what stands on them; the
// sim plays it. Everything here is plain data, so the tests can walk it.

export const TILE = 16;

/** Tile kinds. A tile's signal (or other number) is kept beside it. */
export const T = {
  FLOOR: 0,
  FLOOR2: 1,
  RUG: 2,
  WALL: 3,
  DECOR: 4,
  DECOR2: 5,
  /** A wall Sudo can break, and what's left of one. */
  CRACKED: 6,
  RUBBLE: 7,
  /** The void: walk off into it and you're put back. */
  PIT: 8,
  /** Void with an updraft: hovering over it lifts you again. */
  VENT: 9,
  /** Static underfoot; it hurts unless you hover over it. */
  HAZARD: 10,
  /** Open while its signal is on; SHUT is the other way round. */
  DOOR: 11,
  SHUT: 12,
  /** Floor while its signal is on, void otherwise; a ghost shows nothing while off. */
  BRIDGE: 13,
  GHOST: 14,
  /** Opens and shuts on a schedule. */
  GATE: 15,
  CONV_U: 16,
  CONV_R: 17,
  CONV_D: 18,
  CONV_L: 19,
  PLATE: 20,
  /** A relay a ping switches on. */
  NODE: 21,
  /** A light a ping keeps lit. */
  LAMP: 22,
  TERMINAL: 23,
  BEACON: 24,
  SIGN: 25,
  /** A pit a block was pushed into. */
  FILLED: 26,
  /** A wall you see past: the edge of a raised floor, a railing. */
  LEDGE: 27,
} as const;

export type Tile = (typeof T)[keyof typeof T];

/** Directions, clockwise from up. */
export const UP = 0;
export const RIGHT = 1;
export const DOWN = 2;
export const LEFT = 3;
export const DX = [0, 1, 0, -1] as const;
export const DY = [-1, 0, 1, 0] as const;

export function dx(dir: number): number {
  return DX[dir & 3] ?? 0;
}

export function dy(dir: number): number {
  return DY[dir & 3] ?? 0;
}

const SOLID = new Set<number>([T.WALL, T.DECOR, T.DECOR2, T.CRACKED, T.NODE, T.LAMP, T.TERMINAL, T.BEACON, T.SIGN, T.LEDGE]);
const VOID = new Set<number>([T.PIT, T.VENT]);

/** Whether a tile stops you whatever its signal (walls, machines, signs). */
export function alwaysSolid(tile: number): boolean {
  return SOLID.has(tile);
}

/** Whether a tile is the void itself (not a bridge that may be off). */
export function isVoid(tile: number): boolean {
  return VOID.has(tile);
}

export function isConveyor(tile: number): boolean {
  return tile >= T.CONV_U && tile <= T.CONV_L;
}

/** What the default characters mean in every area. */
export const LEGEND: Record<string, number> = {
  '#': T.WALL,
  '.': T.FLOOR,
  ',': T.FLOOR2,
  ':': T.RUG,
  '"': T.DECOR,
  '&': T.DECOR2,
  '%': T.CRACKED,
  ' ': T.PIT,
  '~': T.VENT,
  '!': T.HAZARD,
  '^': T.CONV_U,
  '>': T.CONV_R,
  v: T.CONV_D,
  '<': T.CONV_L,
  '+': T.BEACON,
  '_': T.LEDGE,
};

/** The companions, in the order they join. */
export const COMPANIONS = ['cron', 'sudo', 'float', 'tel'] as const;
export type Companion = (typeof COMPANIONS)[number];

export function isCompanion(value: string): value is Companion {
  return (COMPANIONS as readonly string[]).includes(value);
}

/** What each lends you. Talk works on terminals with Tel anywhere in the party. */
export const ABILITY: Record<Companion, Ability> = { cron: 'freeze', sudo: 'force', float: 'hover', tel: 'talk' };
export type Ability = 'ping' | 'freeze' | 'force' | 'hover' | 'talk';

/** A signal is a letter, a to p. */
export function signalOf(letter: string): number {
  const n = letter.charCodeAt(0) - 97;
  if (n < 0 || n > 15) throw new Error(`A signal is a letter from a to p, not "${letter}".`);
  return n;
}

export type Spec =
  | { t: 'tile'; tile: number; sig: number }
  | { t: 'gate'; period: number; open: number; phase: number }
  | { t: 'node'; sig: number; time: number }
  | { t: 'lamp'; sig: number }
  | { t: 'terminal'; scene: string }
  | { t: 'sign'; scene: string }
  | { t: 'npc'; id: string; talk: Rule[]; if: string; on: number }
  | { t: 'exit'; to: string; at: string; if: string; no: string }
  | { t: 'mark'; on: number }
  | { t: 'item'; flag: string; kind: ItemKind; hidden: boolean }
  | { t: 'trigger'; scene: string; if: string; on: number }
  | { t: 'mover'; path: number[]; speed: number; sig: number }
  | { t: 'sweeper'; arms: number; length: number; speed: number; angle: number }
  | { t: 'crusher'; period: number; phase: number }
  | { t: 'sentry'; dir: number; turn: number; range: number; sig: number }
  | { t: 'bug'; kind: number }
  | { t: 'boss'; kind: string }
  | { t: 'block'; heavy: boolean; on: number };

/** Which scene someone plays when talked to: the first rule whose condition holds. */
export type Rule = { if: string; scene: string };

export type ItemKind = 'log' | 'fragment' | 'letter' | 'heart' | 'key';

export function door(letter: string): Spec {
  return { t: 'tile', tile: T.DOOR, sig: signalOf(letter) };
}

/** A door that stands open until its signal comes on. */
export function shut(letter: string): Spec {
  return { t: 'tile', tile: T.SHUT, sig: signalOf(letter) };
}

export function bridge(letter: string): Spec {
  return { t: 'tile', tile: T.BRIDGE, sig: signalOf(letter) };
}

export function ghost(letter: string): Spec {
  return { t: 'tile', tile: T.GHOST, sig: signalOf(letter) };
}

export function plate(letter: string): Spec {
  return { t: 'tile', tile: T.PLATE, sig: signalOf(letter) };
}

/** A relay a ping switches on: for `time` ticks, or until you leave (0). */
export function node(letter: string, time = 0): Spec {
  return { t: 'node', sig: signalOf(letter), time };
}

export function lamp(letter = 'p'): Spec {
  return { t: 'lamp', sig: signalOf(letter) };
}

/** A gate open for `open` ticks of every `period`, starting `phase` ticks in. */
export function gate(period: number, open: number, phase = 0): Spec {
  return { t: 'gate', period, open, phase };
}

export function terminal(scene: string): Spec {
  return { t: 'terminal', scene };
}

export function sign(scene: string): Spec {
  return { t: 'sign', scene };
}

/**
 * Someone to talk to. `talk` is either one scene or rules tried in order
 * (`[condition, scene]`); `present` is when they're there at all.
 */
export function npc(id: string, talk: string | [string, string][], present = '', on: number = T.FLOOR): Spec {
  const rules = typeof talk === 'string' ? [{ if: '', scene: talk }] : talk.map(([cond, scene]) => ({ if: cond, scene }));
  return { t: 'npc', id, talk: rules, if: present, on };
}

/**
 * A way to another area: you arrive at the tile marked `at` there, one step
 * further the way you were going. `when` must hold to pass; `no` is the
 * scene that says why not.
 */
export function exit(to: string, at: string, when = '', no = ''): Spec {
  return { t: 'exit', to, at, if: when, no };
}

/** A place to arrive at, on any floor. */
export function mark(on: number = T.FLOOR): Spec {
  return { t: 'mark', on };
}

export function item(flag: string, kind: ItemKind, hidden = false): Spec {
  return { t: 'item', flag, kind, hidden };
}

/** A scene that plays once, the first time you step here while `when` holds. */
export function trigger(scene: string, when = '', on: number = T.FLOOR): Spec {
  return { t: 'trigger', scene, if: when, on };
}

/**
 * A platform over the void, moving along `path` (steps like 'r4 d2', in
 * tiles) and back, `speed` pixels a tick; with a signal, only while it's on.
 */
export function mover(path: string, speed = 0.5, letter = ''): Spec {
  const steps: number[] = [];
  for (const step of path.trim().split(/\s+/)) {
    const dir = 'urdl'.indexOf(step[0] ?? '');
    const count = Number(step.slice(1));
    if (dir < 0 || !Number.isInteger(count) || count <= 0) throw new Error(`A mover's step is like "r4", not "${step}".`);
    steps.push(dir, count);
  }
  return { t: 'mover', path: steps, speed, sig: letter ? signalOf(letter) : -1 };
}

/** Beams turning about a pillar: `arms` of them, `length` tiles long, `speed` turns a second. */
export function sweeper(arms: number, length: number, speed: number, angle = 0): Spec {
  return { t: 'sweeper', arms, length, speed, angle };
}

export function crusher(period: number, phase = 0): Spec {
  return { t: 'crusher', period, phase };
}

/**
 * A watcher looking `range` tiles: turning a quarter every `turn` ticks, or
 * fixed (0). Seen, you're sent back to where you came in. Its signal turns it off.
 */
export function sentry(dir: number, turn: number, range = 5, letter = ''): Spec {
  return { t: 'sentry', dir, turn, range, sig: letter ? signalOf(letter) : -1 };
}

export function bug(kind = 0): Spec {
  return { t: 'bug', kind };
}

export function boss(kind: string): Spec {
  return { t: 'boss', kind };
}

export function block(heavy = false, on: number = T.FLOOR): Spec {
  return { t: 'block', heavy, on };
}

/** Area options for its signals: a story flag that holds it on, and whether it stays on once on. */
export type SignalSpec = { when?: string; latch?: string };

export type AreaSpec = {
  id: string;
  /** Shown as you come in. */
  name: string;
  chapter: number;
  map: string;
  key?: Record<string, Spec | Spec[]>;
  signals?: Record<string, SignalSpec>;
  /** Unlit: you see only what your light (and the lamps) reach. */
  dark?: boolean;
  /** A song other than the chapter's ('boss', 'calm', 'null', ...). */
  song?: string;
  /** Played each time you come in while its condition holds (once per flag it sets). */
  enter?: Rule[];
  /** What the companions say when asked for a hint here. */
  hint?: string;
  /** Where it sits on the world map (0 to 255 across, 0 to 143 down); inside places share their town's. */
  at?: [number, number];
  /** The place on the map it belongs to, if not its own (a house in a town). */
  region?: string;
  /** The tile the map's travel brings you to, if you can travel here. */
  travel?: string;
};

export type Placed = { spec: Spec; x: number; y: number; ch: string };

export type Area = {
  spec: AreaSpec;
  id: string;
  w: number;
  h: number;
  /** The tiles as built, before anything is broken, pushed or opened. */
  tiles: Uint8Array;
  /** Each tile's signal (doors, bridges, plates, nodes, lamps), or 255. */
  sig: Uint8Array;
  /** Each tile's spec in `placed`, or -1 (gates, terminals, signs, exits, triggers). */
  at: Int16Array;
  placed: Placed[];
  /** Where each character first appears, as y * w + x. */
  marks: Map<string, number>;
  signals: SignalSpec[];
};

const NONE = 255;

function base(spec: Spec): number {
  switch (spec.t) {
    case 'tile':
      return spec.tile;
    case 'gate':
      return T.GATE;
    case 'node':
      return T.NODE;
    case 'lamp':
      return T.LAMP;
    case 'terminal':
      return T.TERMINAL;
    case 'sign':
      return T.SIGN;
    case 'mover':
      return T.PIT;
    case 'sweeper':
      return T.DECOR;
    case 'npc':
    case 'mark':
    case 'trigger':
    case 'block':
      return spec.on;
    default:
      return T.FLOOR;
  }
}

/** The rows of a map, trimmed of the blank first and last lines a template literal leaves. */
export function rows(map: string): string[] {
  const lines = map.split('\n');
  while (lines.length > 0 && (lines[0] ?? '').trim() === '') lines.shift();
  while (lines.length > 0 && (lines[lines.length - 1] ?? '').trim() === '') lines.pop();
  return lines;
}

/** Builds an area from its spec; a mistake in the map throws, naming the area. */
export function parse(spec: AreaSpec): Area {
  const lines = rows(spec.map);
  const h = lines.length;
  const w = Math.max(0, ...lines.map((line) => line.length));
  if (w === 0 || h === 0) throw new Error(`Area ${spec.id} has no map.`);
  const tiles = new Uint8Array(w * h);
  const sig = new Uint8Array(w * h).fill(NONE);
  const at = new Int16Array(w * h).fill(-1);
  const placed: Placed[] = [];
  const marks = new Map<string, number>();
  for (let y = 0; y < h; y += 1) {
    const line = lines[y] ?? '';
    for (let x = 0; x < w; x += 1) {
      // Short rows are padded with wall.
      const ch = x < line.length ? (line[x] ?? '#') : '#';
      const i = y * w + x;
      if (!marks.has(ch)) marks.set(ch, i);
      const own = spec.key?.[ch];
      if (own) {
        const list = Array.isArray(own) ? own : [own];
        let tile = -1;
        for (const one of list) {
          const under = base(one);
          // The first spec that isn't standing on plain floor decides the tile.
          if (tile < 0 || (tile === T.FLOOR && under !== T.FLOOR)) tile = under;
          if (one.t === 'tile' || one.t === 'node' || one.t === 'lamp') sig[i] = one.sig;
          if (one.t === 'tile' && one.tile === T.PLATE) sig[i] = one.sig;
          if (one.t !== 'tile') {
            at[i] = placed.length;
            placed.push({ spec: one, x, y, ch });
          }
        }
        tiles[i] = tile < 0 ? T.FLOOR : tile;
        continue;
      }
      if (ch === 'o' || ch === 'O') {
        tiles[i] = T.FLOOR;
        placed.push({ spec: { t: 'block', heavy: ch === 'O', on: T.FLOOR }, x, y, ch });
        continue;
      }
      if (ch === '@') {
        tiles[i] = T.FLOOR;
        continue;
      }
      const tile = LEGEND[ch];
      if (tile === undefined) throw new Error(`Area ${spec.id}: "${ch}" at ${x},${y} means nothing (add it to the key).`);
      tiles[i] = tile;
    }
  }
  const signals: SignalSpec[] = [];
  for (let s = 0; s < 16; s += 1) signals.push({});
  for (const [letter, options] of Object.entries(spec.signals ?? {})) signals[signalOf(letter)] = options;
  return { spec, id: spec.id, w, h, tiles, sig, at, placed, marks, signals };
}

/** Where a character first appears in an area, as tile x and y. */
export function markAt(area: Area, ch: string): { x: number; y: number } | null {
  const i = area.marks.get(ch);
  if (i === undefined) return null;
  return { x: i % area.w, y: Math.floor(i / area.w) };
}
