// Checks that a level can be finished, with the game's own physics. From
// every spot the packet can stand on, it tries a set of moves (walks, runs,
// jumps of different heights, turning in the air, swimming) and records
// where each lands. The level passes if the flag can be reached from the
// start, and the flag can still be reached from everywhere the packet can
// get to: no pit you can fall into alive and never leave.
//
// Moving and falling platforms count as standing room along their whole
// track (you can wait for them); beat blocks are tried in both phases; the
// on/off switch is part of each spot's state.

import type { Level, Room } from './generator';
import { K } from './kinds';
import { Body, emptyPad, fits, type Grid, hasHazards, solidAt, StepEvents, stepBody, surfaceAccel, tileAt, type Tuning } from './physics';
import * as tiles from './tiles';

const { F, FLAGS, T, TILE } = tiles;

export type Size = 'small' | 'big';
const HEIGHT: Record<Size, number> = { small: 7, big: 13 };
const WIDTH = 6;
const MAX_TICKS = 170;

type Script = { d1: number; d2: number; at: number; hold: number; speed: number; strokes: number; ticks: number };

/** The moves tried from each spot: walks, jumps of three heights at three
 * speeds, stopping or turning back in the air, and jumping up then steering. */
function scripts(): Script[] {
  const list: Script[] = [];
  const move = (d1: number, d2: number, at: number, hold: number, speed: number) =>
    list.push({ d1, d2, at, hold, speed, strokes: 0, ticks: MAX_TICKS });
  for (const dir of [1, -1]) {
    for (const speed of [0, 2]) move(dir, dir, 0, 0, speed);
    for (const hold of [4, 10, 60]) for (const speed of [0, 1, 2]) move(dir, dir, 0, hold, speed);
    for (const speed of [0, 2]) {
      move(dir, 0, 12, 60, speed);
      move(dir, -dir, 22, 60, speed);
    }
    move(0, dir, 10, 60, 0);
    move(0, dir, 22, 60, 0);
  }
  move(0, 0, 0, 60, 0);
  return list;
}

/** Swimming: sinking, holding about level, and stroking upwards, each way. */
function swimScripts(): Script[] {
  const list: Script[] = [];
  for (const dir of [1, 0, -1]) {
    list.push({ d1: dir, d2: dir, at: 0, hold: 0, speed: 0, strokes: 0, ticks: 40 });
    for (const strokes of [7, 14]) list.push({ d1: dir, d2: dir, at: 0, hold: 4, speed: 0, strokes, ticks: 40 });
  }
  return list;
}

const SCRIPTS = scripts();
const SWIM = swimScripts();

export type Report = {
  /** The flag (or the way out of a bonus room) can be reached from the start. */
  reached: boolean;
  /** Spots the packet can reach but can't finish from. */
  stuck: { x: number; y: number }[];
  /** Keys that some move touches. */
  keysReached: number;
  keysTotal: number;
  nodes: number;
  /** Every spot reached, for drawing a map when a check fails. */
  seen: { x: number; y: number }[];
};

type Node = { tx: number; ty: number; gd: number; on: boolean; float: boolean };

function keyOf(n: Node): number {
  return n.tx + n.ty * 4096 + (n.gd === 1 ? 0 : 1) * 16777216 + (n.on ? 0 : 1) * 33554432 + (n.float ? 1 : 0) * 67108864;
}

/** The room's tiles with platform tracks drawn in as one-way floors. */
function gridFor(level: Level, room: Room, hiddenSolid: boolean): Grid {
  const tiles = room.tiles.slice();
  const put = (tx: number, ty: number) => {
    if (tx < 0 || ty < 0 || tx >= room.w || ty >= room.h) return;
    const at = ty * room.w + tx;
    if (tiles[at] === T.EMPTY || tiles[at] === T.BIT || tiles[at] === T.WATER) tiles[at] = T.ONEWAY;
  };
  for (const spawn of room.spawns) {
    const tx = Math.floor(spawn.x / TILE);
    const ty = Math.floor(spawn.y / TILE);
    if (spawn.k === K.PLAT_H) {
      for (let x = Math.floor(spawn.a / TILE); x < Math.floor(spawn.b / TILE) + spawn.c; x += 1) put(x, ty);
    } else if (spawn.k === K.PLAT_V) {
      for (let y = Math.floor(spawn.a / TILE); y <= Math.floor(spawn.b / TILE); y += 1) {
        for (let x = tx; x < tx + spawn.c; x += 1) put(x, y);
      }
    } else if (spawn.k === K.PLAT_FALL) {
      for (let x = tx; x < tx + spawn.c; x += 1) put(x, ty);
    }
  }
  if (hiddenSolid) {
    tiles.forEach((tile, i) => {
      if (tile === T.HIDDEN_BIT || tile === T.HIDDEN_LIFE) tiles[i] = T.USED;
    });
  }
  return {
    w: room.w,
    h: room.h,
    tiles,
    switchOn: true,
    beat: 0,
    waterLine: room.kind === 'bonus' ? -1 : level.waterLine,
    hazards: hasHazards(tiles),
    platforms: new Float32Array(0),
    platformCount: 0,
  };
}

type Goal = { x: number; y: number; w: number; h: number };

function goalsFor(level: Level, room: Room, roomIndex: number): Goal[] {
  const goals: Goal[] = [];
  if (room.kind === 'bonus') {
    room.tiles.forEach((tile, i) => {
      if (tile === T.WARP) goals.push({ x: (i % room.w) * TILE, y: (Math.floor(i / room.w) - 1) * TILE, w: 16, h: 8 });
    });
    return goals;
  }
  for (const spawn of room.spawns) {
    if (spawn.k === K.GOAL || spawn.k === K.BACKDOOR) goals.push({ x: spawn.x, y: spawn.y - 9 * TILE, w: TILE, h: 10 * TILE });
  }
  if (level.kind === 'core' && roomIndex === 0) {
    // Past the gate is the boss; reaching the arena is the end of the run.
    const gate = room.tiles.indexOf(T.GATE);
    if (gate >= 0) goals.push({ x: ((gate % room.w) + 3) * TILE, y: 0, w: TILE, h: room.h * TILE });
  }
  return goals;
}

/** Whether a body of this size can stand at the node. */
function place(body: Body, n: Node, h: number, g: Grid): boolean {
  body.w = WIDTH;
  body.h = h;
  body.x = n.tx * TILE + (TILE - WIDTH) / 2;
  body.gd = n.gd;
  if (n.float) body.y = n.ty * TILE + TILE - h;
  else body.y = n.gd === 1 ? (n.ty + 1) * TILE - h : n.ty * TILE;
  body.vx = 0;
  body.vy = 0;
  body.onGround = !n.float;
  body.jumping = false;
  body.coyote = 0;
  body.buffer = 0;
  body.platform = -1;
  body.canGlide = false;
  const tx0 = Math.floor(body.x / TILE);
  const tx1 = Math.floor((body.x + body.w - 0.001) / TILE);
  const ty0 = Math.floor(body.y / TILE);
  const ty1 = Math.floor((body.y + body.h - 0.001) / TILE);
  for (let ty = ty0; ty <= ty1; ty += 1) {
    for (let tx = tx0; tx <= tx1; tx += 1) if (solidAt(g, tx, ty)) return false;
  }
  if (!n.float) {
    const under = n.gd === 1 ? n.ty + 1 : n.ty - 1;
    const tile = tileAt(g, n.tx, under);
    body.surface = tile;
    if (!solidAt(g, n.tx, under) && ((FLAGS[tile] ?? 0) & F.ONEWAY) === 0) return false;
  }
  return true;
}

/** The node a body that just landed (or stopped swimming) stands at. */
function nodeAt(body: Body, g: Grid, on: boolean): Node | null {
  // Caught inside a block that appeared on it: the game pushes the packet
  // out, so this is no place to stand.
  if (!fits(body, g)) return null;
  if (body.inWater && !body.onGround) {
    const ty = Math.floor((body.y + body.h - 0.01) / TILE);
    // Sinking out of the bottom is a pit, not a place.
    if (ty >= g.h - 1) return null;
    return { tx: Math.floor((body.x + body.w / 2) / TILE), ty, gd: body.gd, on, float: true };
  }
  const ty = body.gd === 1 ? Math.round((body.y + body.h) / TILE) - 1 : Math.round(body.y / TILE);
  const under = body.gd === 1 ? ty + 1 : ty - 1;
  const supported = (tx: number) => solidAt(g, tx, under) || (body.gd === 1 && ((FLAGS[tileAt(g, tx, under)] ?? 0) & F.ONEWAY) !== 0);
  const mid = Math.floor((body.x + body.w / 2) / TILE);
  for (const tx of [mid, Math.floor(body.x / TILE), Math.floor((body.x + body.w - 0.01) / TILE)]) {
    if (supported(tx)) return { tx, ty, gd: body.gd, on, float: false };
  }
  return null;
}

/** How fast the packet can be going after a run-up to the node. */
function runUp(g: Grid, n: Node, dir: number, t: Tuning, h: number, run: boolean, body: Body): number {
  if (n.float || dir === 0) return 0;
  let steps = 0;
  const probe: Node = { ...n };
  for (let k = 1; k <= 8; k += 1) {
    probe.tx = n.tx - dir * k;
    if (!place(body, probe, h, g)) break;
    steps = k;
  }
  if (steps === 0) return 0;
  const accel = (run ? t.runAccel : t.accel) * surfaceAccel(tileAt(g, n.tx, n.gd === 1 ? n.ty + 1 : n.ty - 1));
  return Math.min(run ? t.runMax : t.walkMax, Math.sqrt(2 * accel * steps * TILE));
}

function overlaps(body: Body, goal: Goal): boolean {
  return body.x < goal.x + goal.w && body.x + body.w > goal.x && body.y < goal.y + goal.h && body.y + body.h > goal.y;
}

/** Checks one room of a level for one size of packet. */
export function checkRoom(level: Level, roomIndex: number, size: Size, options: { hiddenSolid?: boolean } = {}): Report {
  const room = level.rooms[roomIndex];
  if (!room) throw new Error(`checkRoom: the level has no room ${roomIndex}.`);
  const g = gridFor(level, room, options.hiddenSolid ?? false);
  const h = HEIGHT[size];
  const t = level.tuning;
  const goals = goalsFor(level, room, roomIndex);
  // Near beat blocks, both phases are tried, and the packet can time a jump
  // to the beat so the blocks swap mid-air.
  const beatNear = new Uint8Array(room.w);
  if (level.beatTicks > 0) {
    g.tiles.forEach((tile, i) => {
      if (tile !== T.BEAT_A && tile !== T.BEAT_B) return;
      const x = i % room.w;
      for (let near = Math.max(0, x - 14); near <= Math.min(room.w - 1, x + 14); near += 1) beatNear[near] = 1;
    });
  }
  const STILL = [0];
  const BOTH = [0, 1];
  const NO_SWAP = [-1];
  const SWAPS = [-1, 8, 20, 34];
  const keySpots: number[] = [];
  g.tiles.forEach((tile, i) => {
    if (tile === T.KEY || tile === T.QKEY) keySpots.push(i);
  });
  const keysHit = new Set<number>();

  const body = new Body();
  const pad = emptyPad();
  const ev = new StepEvents();
  const nodes: Node[] = [];
  const index = new Map<number, number>();
  const edges: number[][] = [];
  const finishes: boolean[] = [];
  const add = (n: Node): number => {
    const key = keyOf(n);
    const known = index.get(key);
    if (known !== undefined) return known;
    index.set(key, nodes.length);
    nodes.push(n);
    edges.push([]);
    finishes.push(false);
    return nodes.length - 1;
  };

  const touchesGoal = (): boolean => {
    for (const goal of goals) if (overlaps(body, goal)) return true;
    return false;
  };

  /** Tries one move from a spot and records where it lands. */
  const tryMove = (at: number, from: Node, script: Script, phase: number, swap: number): void => {
    g.beat = phase;
    g.switchOn = from.on;
    let speed = 0;
    if (script.speed !== 0) {
      speed = runUp(g, from, script.d1, t, h, script.speed === 2, body);
      if (speed === 0) return;
    }
    if (!place(body, from, h, g)) return;
    const startX = body.x;
    const startY = body.y;
    body.vx = script.d1 * speed;
    let airborne = false;
    for (let tick = 0; tick < script.ticks; tick += 1) {
      const dir = tick < script.at ? script.d1 : script.d2;
      pad.left = dir < 0;
      pad.right = dir > 0;
      pad.run = script.speed === 2;
      pad.jump = tick < script.hold;
      pad.jumpPressed = (tick === 0 && script.hold > 0) || (script.strokes > 0 && tick % script.strokes === 0);
      if (tick === swap) g.beat = 1 - g.beat;
      stepBody(body, pad, t, g, ev);
      if (ev.bumpTx >= 0) {
        const bumped = tileAt(g, ev.bumpTx, ev.bumpTy);
        if (bumped === T.SWITCH) g.switchOn = !g.switchOn;
        if (bumped === T.QKEY) keysHit.add(ev.bumpTy * g.w + ev.bumpTx);
      }
      if (ev.hurt || ev.died) return;
      for (const spot of keySpots) {
        const kx = (spot % g.w) * TILE;
        const ky = Math.floor(spot / g.w) * TILE;
        if (body.x < kx + TILE && body.x + body.w > kx && body.y < ky + TILE && body.y + body.h > ky) keysHit.add(spot);
      }
      if (touchesGoal()) {
        finishes[at] = true;
        return;
      }
      if (!body.onGround) airborne = true;
      const walked = Math.abs(body.x - startX) >= TILE || Math.abs(body.y - startY) >= TILE;
      if ((body.onGround && tick > 0 && (airborne || (script.hold === 0 && walked))) || (body.inWater && tick === script.ticks - 1)) {
        const landed = nodeAt(body, g, g.switchOn);
        if (landed) edges[at]?.push(add(landed));
        return;
      }
    }
  };

  add({ tx: room.startX, ty: room.startY, gd: 1, on: true, float: false });
  for (let at = 0; at < nodes.length; at += 1) {
    const from = nodes[at] as Node;
    g.switchOn = from.on;
    g.beat = 0;
    const beat = beatNear[from.tx] === 1;
    if (!beat && !place(body, from, h, g)) continue;
    const inWater = from.float || (level.waterLine >= 0 && room.kind !== 'bonus' && from.ty >= level.waterLine);
    for (const phase of beat ? BOTH : STILL) {
      for (const swap of beat ? SWAPS : NO_SWAP) {
        for (const script of inWater ? SWIM : SCRIPTS) {
          if (swap < 0 || script.hold > 0) tryMove(at, from, script, phase, swap);
        }
      }
    }
  }

  // From where can the flag still be reached? Walk the moves backwards.
  const back: number[][] = nodes.map(() => []);
  edges.forEach((list, from) => {
    for (const to of list) back[to]?.push(from);
  });
  const canFinish = finishes.slice();
  const queue: number[] = [];
  canFinish.forEach((done, i) => {
    if (done) queue.push(i);
  });
  while (queue.length > 0) {
    const at = queue.pop() as number;
    for (const from of back[at] ?? []) {
      if (!canFinish[from]) {
        canFinish[from] = true;
        queue.push(from);
      }
    }
  }
  const stuck = nodes.filter((_, i) => !canFinish[i]).map((n) => ({ x: n.tx, y: n.ty }));
  return {
    reached: canFinish[0] === true,
    stuck,
    keysReached: keysHit.size,
    keysTotal: keySpots.length,
    nodes: nodes.length,
    seen: nodes.map((n) => ({ x: n.tx, y: n.ty })),
  };
}
