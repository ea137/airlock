// Saving the story exactly as it is, in this browser, under its own key:
// the flags, trust and party; what each area remembers; and the area you're
// in as it stands (tiles changed, relays lit, everything that moves, the
// conversation you were in). Storage can be missing or full (private
// browsing): then the game plays on without saving.

import { ENT_FIELDS, type Memory, TRAIL, type World } from './sim';
import { type Companion, COMPANIONS, isCompanion } from './world';

const KEY = 'airlock.keepalive';
export const SAVE_VERSION = 1;

/** Echo's own numbers, in order. */
const ECHO = ['x', 'y', 'facing', 'hp', 'maxHp', 'invuln', 'entryX', 'entryY', 'entryDir', 'safeX', 'safeY', 'knock', 'knockX', 'knockY', 'fall', 'push'] as const;
const TIMERS = ['tick', 'clock', 'freeze', 'freezeCool', 'hover', 'hoverCool', 'ping', 'pingCool', 'pingX', 'pingY', 'forceCool', 'head', 'banner'] as const;

export type Saved = {
  v: number;
  area: string;
  echo: number[];
  timers: number[];
  rng: number;
  flags: string[];
  trust: Record<Companion, number>;
  party: Companion[];
  chapter: number;
  reached: number;
  memory: [string, number[], number[], number][];
  /** The area as it stands: tiles changed (index, tile, ...), relays lit (index, time, ...), the entities. */
  tiles: number[];
  lit: number[];
  ents: number[];
  forced: number;
  trail: number[];
  /** The conversation going on: its scene and node, or none. */
  talk: [string, number] | null;
  log: [string, string][];
  played: number;
};

export function snapshot(world: World, talk: [string, number] | null, log: [string, string][], played: number): Saved {
  const area = world.area;
  const tiles: number[] = [];
  for (let i = 0; i < world.tiles.length; i += 1) if (world.tiles[i] !== area.tiles[i]) tiles.push(i, world.tiles[i] ?? 0);
  const lit: number[] = [];
  for (let i = 0; i < world.lit.length; i += 1) if ((world.lit[i] ?? 0) !== 0) lit.push(i, world.lit[i] ?? 0);
  const ents: number[] = [];
  for (const e of world.ents) if (e.k !== 0) for (const field of ENT_FIELDS) ents.push(e[field]);
  const memory: Saved['memory'] = [];
  for (const [id, m] of world.memory) memory.push([id, m.broken.slice(), m.lit.slice(), m.forced]);
  return {
    v: SAVE_VERSION,
    area: area.id,
    echo: ECHO.map((name) => world[name]),
    timers: TIMERS.map((name) => world[name]),
    rng: world.rng.state,
    flags: [...world.story.flags],
    trust: { ...world.story.trust },
    party: world.story.party.slice(),
    chapter: world.story.chapter,
    reached: world.story.reached,
    memory,
    tiles,
    lit,
    ents,
    forced: world.forced,
    trail: Array.from(world.trail),
    talk,
    log: log.slice(-80),
    played: Math.round(played),
  };
}

function numbers(value: unknown, length = -1): value is number[] {
  return Array.isArray(value) && (length < 0 || value.length === length) && value.every((n) => typeof n === 'number' && Number.isFinite(n));
}

/** Whether something read from storage has the shape of a save. */
export function isSaved(value: unknown): value is Saved {
  if (!value || typeof value !== 'object') return false;
  const s = value as Partial<Saved>;
  if (s.v !== SAVE_VERSION || typeof s.area !== 'string') return false;
  if (!numbers(s.echo, ECHO.length) || !numbers(s.timers, TIMERS.length) || typeof s.rng !== 'number') return false;
  if (!Array.isArray(s.flags) || !s.flags.every((f) => typeof f === 'string')) return false;
  if (!s.trust || !COMPANIONS.every((c) => typeof s.trust?.[c] === 'number')) return false;
  if (!Array.isArray(s.party) || !s.party.every((c) => typeof c === 'string' && isCompanion(c))) return false;
  if (typeof s.chapter !== 'number' || typeof s.reached !== 'number' || typeof s.forced !== 'number' || typeof s.played !== 'number') return false;
  if (!Array.isArray(s.memory) || !s.memory.every((m) => Array.isArray(m) && typeof m[0] === 'string' && numbers(m[1]) && numbers(m[2]) && typeof m[3] === 'number')) return false;
  if (!numbers(s.tiles) || !numbers(s.lit) || !numbers(s.ents) || s.ents.length % ENT_FIELDS.length !== 0 || !numbers(s.trail, TRAIL * 2)) return false;
  if (s.talk !== null && !(Array.isArray(s.talk) && typeof s.talk[0] === 'string' && typeof s.talk[1] === 'number')) return false;
  return Array.isArray(s.log) && s.log.every((line) => Array.isArray(line) && typeof line[0] === 'string' && typeof line[1] === 'string');
}

/** Puts a save back into a world; false if its area no longer exists. */
export function restore(world: World, s: Saved): boolean {
  if (!world.hasArea(s.area)) return false;
  const story = world.story;
  story.flags = new Set(s.flags);
  story.trust = { ...s.trust };
  story.party = s.party.slice();
  story.chapter = s.chapter;
  story.reached = s.reached;
  world.memory = new Map(s.memory.map(([id, broken, lit, forced]): [string, Memory] => [id, { broken: broken.slice(), lit: lit.slice(), forced }]));
  const area = world.build(s.area);
  world.area = area;
  world.tiles = area.tiles.slice();
  for (let i = 0; i + 1 < s.tiles.length; i += 2) {
    const at = s.tiles[i] ?? -1;
    if (at >= 0 && at < world.tiles.length) world.tiles[at] = s.tiles[i + 1] ?? 0;
  }
  world.occ = new Int16Array(area.w * area.h);
  world.lit = new Int16Array(area.w * area.h);
  for (let i = 0; i + 1 < s.lit.length; i += 2) {
    const at = s.lit[i] ?? -1;
    if (at >= 0 && at < world.lit.length) world.lit[at] = s.lit[i + 1] ?? 0;
  }
  for (const e of world.ents) e.reset();
  const stride = ENT_FIELDS.length;
  for (let n = 0; n * stride < s.ents.length && n < world.ents.length; n += 1) {
    const e = world.ents[n];
    if (!e) break;
    ENT_FIELDS.forEach((field, k) => {
      e[field] = s.ents[n * stride + k] ?? 0;
    });
  }
  world.boss = world.ents.find((e) => e.k === 8) ?? null;
  world.forced = s.forced;
  ECHO.forEach((name, i) => {
    world[name] = s.echo[i] ?? 0;
  });
  TIMERS.forEach((name, i) => {
    world[name] = s.timers[i] ?? 0;
  });
  world.rng.state = s.rng >>> 0;
  world.trail.set(s.trail);
  world.onTile = world.tileIndex(world.x, world.y);
  world.want = '';
  world.wantRest = false;
  world.refresh();
  return true;
}

export function readSave(): Saved | null {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    return isSaved(saved) ? saved : null;
  } catch {
    return null;
  }
}

export function writeSave(saved: Saved): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(saved));
  } catch {
    // Not saved (private browsing, or storage full); the game goes on.
  }
}

export function clearSave(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing to clear.
  }
}

// The sound switch is the secret games' one, shared with Hop Count and Settings.
export { readSettings, type Settings, writeSettings } from '../game/settings';
