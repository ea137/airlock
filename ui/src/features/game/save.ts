// Saving the game exactly as it is, in this browser. A level is rebuilt
// from its seed, zone and hop, so a save holds only what changed in its
// tiles, plus the packet, the bugs, the scores and the world map's record
// of every hop. A save from before the map (version 1) is brought up to
// date as it's read. Storage can be missing or full (private browsing):
// then the game plays on without saving.

import { levelFor } from './generator';
import { Rng } from './rng';
import { type Mode, type Play, readEnts, writeEnts } from './sim';
import { type HopRecord, World } from './world';

const KEY = 'airlock.game';
const VERSION = 2;

const BODY_FIELDS = ['x', 'y', 'w', 'h', 'vx', 'vy', 'gd', 'facing', 'onGround', 'jumping', 'coyote', 'buffer', 'surface', 'platform', 'inWater', 'canGlide', 'gliding'] as const;

const NUMBERS = [
  'seed',
  'zone',
  'hop',
  'room',
  'power',
  'invuln',
  'star',
  'combo',
  'shotCool',
  'growing',
  'squash',
  'score',
  'bits',
  'lives',
  'keysTotal',
  'best',
  'tick',
  'beat',
  'chase',
  'camX',
  'camY',
  'checkX',
  'checkY',
  'modeT',
  'hitstop',
  'shake',
  'bossAt',
  'gateX',
  'pipeTo',
  'pipeX',
  'pipeY',
  'clearedBy',
  'flagBonus',
  'lookAhead',
  'hopTicks',
] as const;

/** What version 2 added to the numbers, and their value in an older save. */
const ADDED: Partial<Record<(typeof NUMBERS)[number], number>> = { hopTicks: 0 };

const FLAGS = ['flapped', 'switchOn', 'bossOn', 'prevA', 'prevB', 'prevDown'] as const;

const MODES: Mode[] = ['play', 'dying', 'clear', 'pipe', 'over'];

export type Saved = {
  v: number;
  n: Record<(typeof NUMBERS)[number], number>;
  f: Record<(typeof FLAGS)[number], boolean>;
  mode: Mode;
  rng: number;
  body: number[];
  ents: number[];
  mainEnts: number[];
  keysGot: number[];
  /** Per room, the tiles that changed: index, tile, index, tile… */
  tiles: number[][];
  /** Each hop's record, by hop number from 1. */
  world: HopRecord[];
};

export function snapshot(play: Play): Saved {
  const n = {} as Saved['n'];
  for (const name of NUMBERS) n[name] = play[name];
  const f = {} as Saved['f'];
  for (const name of FLAGS) f[name] = play[name];
  const tiles = play.level.rooms.map((room, index) => {
    const now = play.roomTiles[index];
    const changed: number[] = [];
    if (!now) return changed;
    for (let at = 0; at < room.tiles.length; at += 1) {
      if (now[at] !== room.tiles[at]) changed.push(at, now[at] ?? 0);
    }
    return changed;
  });
  return {
    v: VERSION,
    n,
    f,
    mode: play.mode,
    rng: play.rng.state,
    body: BODY_FIELDS.map((name) => Number(play.body[name])),
    ents: writeEnts(play.ents, false),
    mainEnts: play.mainEnts.slice(),
    keysGot: play.keysGot.slice(),
    tiles,
    world: play.world.save(),
  };
}

function isNumberList(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'number' && Number.isFinite(item));
}

/** Whether something read from storage has the shape of a save. */
export function isSaved(value: unknown): value is Saved {
  if (!value || typeof value !== 'object') return false;
  const s = value as Partial<Saved>;
  if (s.v !== VERSION || !s.n || !s.f || typeof s.rng !== 'number' || !MODES.includes(s.mode as Mode)) return false;
  if (!NUMBERS.every((name) => typeof s.n?.[name] === 'number' && Number.isFinite(s.n[name]))) return false;
  if (!FLAGS.every((name) => typeof s.f?.[name] === 'boolean')) return false;
  if (!isNumberList(s.body) || s.body.length !== BODY_FIELDS.length) return false;
  if (!isNumberList(s.ents) || !isNumberList(s.mainEnts) || !isNumberList(s.keysGot)) return false;
  return Array.isArray(s.tiles) && s.tiles.every(isNumberList) && World.from(s.world) !== null;
}

/**
 * A save from an older version as this version's, keeping everything it
 * held: version 1 had no world map, so every hop before the one it was
 * in counts as cleared, and the new numbers start at nothing. Anything
 * else comes back as it was, for isSaved to judge.
 */
export function upgrade(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value;
  const old = value as { v?: unknown; n?: unknown };
  if (old.v !== 1 || !old.n || typeof old.n !== 'object') return value;
  const n = { ...ADDED, ...(old.n as Record<string, unknown>) };
  const zone = typeof n.zone === 'number' ? n.zone : 1;
  const hop = typeof n.hop === 'number' ? n.hop : 1;
  return { ...old, v: VERSION, n, world: World.upTo(zone, hop).save() };
}

export function restore(play: Play, s: Saved): void {
  for (const name of NUMBERS) play[name] = s.n[name];
  for (const name of FLAGS) play[name] = s.f[name];
  play.mode = s.mode;
  play.rng = new Rng(s.rng);
  play.level = levelFor(play.seed, play.zone, play.hop);
  play.roomTiles = play.level.rooms.map((room, index) => {
    const tiles = room.tiles.slice();
    const changed = s.tiles[index] ?? [];
    for (let i = 0; i + 1 < changed.length; i += 2) {
      const at = changed[i] ?? -1;
      if (at >= 0 && at < tiles.length) tiles[at] = changed[i + 1] ?? 0;
    }
    return tiles;
  });
  play.useRoom(Math.min(play.room, play.level.rooms.length - 1));
  const body = play.body;
  BODY_FIELDS.forEach((name, i) => {
    const value = s.body[i] ?? 0;
    if (typeof body[name] === 'boolean') (body as unknown as Record<string, boolean>)[name] = value !== 0;
    else (body as unknown as Record<string, number>)[name] = value;
  });
  readEnts(play.ents, s.ents);
  play.mainEnts = s.mainEnts.slice();
  play.keysGot = s.keysGot.slice();
  play.world = World.from(s.world) ?? new World();
  play.opened = [];
}

export function readSave(): Saved | null {
  try {
    const saved = upgrade(JSON.parse(localStorage.getItem(KEY) ?? 'null'));
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

// The settings live on their own, so Settings reads them without the game.
export { readSettings, type Settings, writeSettings } from './settings';
