// How the packet moves: walking and running with momentum, a jump that is
// as high as you hold it, a little forgiveness at ledges and corners, and
// what the zone changes (ice, low gravity, water, flipped gravity). The
// game and the level checks in the tests run this same step, so a level
// that passes the checks can be played.

import * as tiles from './tiles';

// Read once into constants: these are used many times a tick, and reading
// another module's bindings can cost a call each time (it does under the
// test runner).
const { CONVEYOR_SPEED, F, FLAGS, T, TILE } = tiles;
const dynamicSolid = tiles.dynamicSolid;

/** Everything that sets the feel, in pixels and ticks (60 a second). */
export type Tuning = {
  walkMax: number;
  runMax: number;
  accel: number;
  runAccel: number;
  decel: number;
  skid: number;
  airAccel: number;
  airDecel: number;
  jumpV: number;
  runJumpBonus: number;
  /** Gravity while rising with jump held, rising without it, and falling. */
  gravHold: number;
  gravRise: number;
  gravFall: number;
  maxFall: number;
  coyote: number;
  buffer: number;
  stompV: number;
  stompHoldV: number;
  springV: number;
  springHoldV: number;
  swimV: number;
  waterGrav: number;
  waterMaxFall: number;
  waterMax: number;
  glideFall: number;
  /** Zone changes: 1 is normal. */
  gravityScale: number;
};

export const BASE: Tuning = {
  walkMax: 0.85,
  runMax: 1.4,
  accel: 0.045,
  runAccel: 0.055,
  decel: 0.07,
  skid: 0.13,
  airAccel: 0.045,
  airDecel: 0.006,
  jumpV: 3.0,
  runJumpBonus: 0.3,
  gravHold: 0.125,
  gravRise: 0.34,
  gravFall: 0.2,
  maxFall: 3.4,
  coyote: 6,
  buffer: 7,
  stompV: 2.3,
  stompHoldV: 3.2,
  springV: 4.3,
  springHoldV: 5.3,
  swimV: 1.15,
  waterGrav: 0.06,
  waterMaxFall: 0.9,
  waterMax: 0.8,
  glideFall: 0.55,
  gravityScale: 1,
};

/** On ice the packet gets going at half pace, and hardly stops or turns. */
export function surfaceAccel(tile: number): number {
  return tile === T.ICE ? 0.5 : 1;
}
export function surfaceGrip(tile: number): number {
  return tile === T.ICE ? 0.12 : 1;
}

/** One tick's buttons. `jumpPressed` is true only on the tick jump went down. */
export type Pad = {
  left: boolean;
  right: boolean;
  up: boolean;
  down: boolean;
  jump: boolean;
  jumpPressed: boolean;
  run: boolean;
};

export function emptyPad(): Pad {
  return { left: false, right: false, up: false, down: false, jump: false, jumpPressed: false, run: false };
}

/** The tiles the body moves through, and whether the switch and the beat make
 * their blocks solid. Moving platforms are one-way rectangles: x, y, width,
 * and how far each moved this tick. */
export type Grid = {
  w: number;
  h: number;
  tiles: Uint8Array;
  switchOn: boolean;
  beat: number;
  /** Rows from here down are water, in a swim zone; -1 is dry. */
  waterLine: number;
  /** Whether the room has spikes or liquid at all (if not, nobody looks for them). */
  hazards: boolean;
  platforms: Float32Array;
  platformCount: number;
};

export const PLATFORM_STRIDE = 5;

export function tileAt(g: Grid, tx: number, ty: number): number {
  if (tx < 0 || tx >= g.w) return T.HARD;
  if (ty < 0 || ty >= g.h) return T.EMPTY;
  return g.tiles[ty * g.w + tx] ?? T.EMPTY;
}

export function hasHazards(tiles: Uint8Array): boolean {
  for (const tile of tiles) if (tile === T.SPIKE || tile === T.LIQUID) return true;
  return false;
}

export function solidAt(g: Grid, tx: number, ty: number): boolean {
  const id = tileAt(g, tx, ty);
  const flags = FLAGS[id] ?? 0;
  if (flags & F.SOLID) return true;
  return (flags & F.DYNAMIC) !== 0 && dynamicSolid(id, g.switchOn, g.beat);
}

/** A moving thing with a box: the packet, and in the level checks a stand-in for it. */
export class Body {
  x = 0;
  y = 0;
  w = 6;
  h = 7;
  vx = 0;
  vy = 0;
  /** Gravity's way: 1 is down, -1 is up. */
  gd = 1;
  facing = 1;
  onGround = false;
  jumping = false;
  coyote = 0;
  buffer = 0;
  /** The tile under the feet while on the ground. */
  surface: number = T.EMPTY;
  /** The moving platform being ridden, or -1. */
  platform = -1;
  inWater = false;
  canGlide = false;
  gliding = false;
}

/** What one step did, for the game to answer (sounds, blocks, damage). */
export class StepEvents {
  jumped = false;
  landed = false;
  landSpeed = 0;
  bumpTx = -1;
  bumpTy = -1;
  hurt = false;
  died = false;
  sprung = false;
  swam = false;
  skidding = false;
  flipped = false;
  wall = false;

  reset(): void {
    this.jumped = false;
    this.landed = false;
    this.landSpeed = 0;
    this.bumpTx = -1;
    this.bumpTy = -1;
    this.hurt = false;
    this.died = false;
    this.sprung = false;
    this.swam = false;
    this.skidding = false;
    this.flipped = false;
    this.wall = false;
  }
}

const EPS = 0.001;
/** A head that clips a block's corner by this much slides past it. */
const CORNER = 3;
/** Feet that clip a ledge by this much are lifted onto it. */
const LEDGE = 3;

function overlapsSolid(g: Grid, x: number, y: number, w: number, h: number): boolean {
  const tx0 = Math.floor(x / TILE);
  const tx1 = Math.floor((x + w - EPS) / TILE);
  const ty0 = Math.floor(y / TILE);
  const ty1 = Math.floor((y + h - EPS) / TILE);
  for (let ty = ty0; ty <= ty1; ty += 1) {
    for (let tx = tx0; tx <= tx1; tx += 1) {
      if (solidAt(g, tx, ty)) return true;
    }
  }
  return false;
}

function moveX(b: Body, dx: number, g: Grid, ev: StepEvents): void {
  if (dx === 0) return;
  b.x += dx;
  const ty0 = Math.floor(b.y / TILE);
  const ty1 = Math.floor((b.y + b.h - EPS) / TILE);
  const tx = dx > 0 ? Math.floor((b.x + b.w - EPS) / TILE) : Math.floor(b.x / TILE);
  let blocked = false;
  for (let ty = ty0; ty <= ty1; ty += 1) {
    if (solidAt(g, tx, ty)) {
      blocked = true;
      break;
    }
  }
  if (!blocked) return;
  // Feet just short of a ledge, in the air: lift onto it instead of stopping.
  if (!b.onGround && b.vy * b.gd >= 0) {
    for (let lift = 1; lift <= LEDGE; lift += 1) {
      if (!overlapsSolid(g, b.x, b.y - lift * b.gd, b.w, b.h)) {
        b.y -= lift * b.gd;
        return;
      }
    }
  }
  b.x = dx > 0 ? tx * TILE - b.w : (tx + 1) * TILE;
  if (b.vx * dx > 0) b.vx = 0;
  ev.wall = true;
}

function hiddenFromBelow(g: Grid, tx: number, ty: number, prevTop: number): boolean {
  const flags = FLAGS[tileAt(g, tx, ty)] ?? 0;
  return (flags & F.HIDDEN) !== 0 && prevTop >= (ty + 1) * TILE - EPS;
}

function onewayAt(g: Grid, tx: number, ty: number): boolean {
  return ((FLAGS[tileAt(g, tx, ty)] ?? 0) & F.ONEWAY) !== 0;
}

/** Lands the body on a moving platform it fell onto this step, if any. */
function landOnPlatform(b: Body, g: Grid, prevBottom: number): boolean {
  for (let i = 0; i < g.platformCount; i += 1) {
    const at = i * PLATFORM_STRIDE;
    const px = g.platforms[at] ?? 0;
    const py = g.platforms[at + 1] ?? 0;
    const pw = g.platforms[at + 2] ?? 0;
    const dy = g.platforms[at + 4] ?? 0;
    if (b.x + b.w <= px || b.x >= px + pw) continue;
    if (prevBottom <= py - dy + EPS + 0.5 && b.y + b.h >= py) {
      b.y = py - b.h;
      b.platform = i;
      return true;
    }
  }
  return false;
}

function moveY(b: Body, dy: number, g: Grid, t: Tuning, pad: Pad, ev: StepEvents): void {
  if (dy === 0) return;
  const prevTop = b.y;
  const prevBottom = b.y + b.h;
  b.y += dy;
  const tx0 = Math.floor(b.x / TILE);
  const tx1 = Math.floor((b.x + b.w - EPS) / TILE);
  if (dy > 0) {
    const ty = Math.floor((b.y + b.h - EPS) / TILE);
    let hit = false;
    let spring = false;
    for (let tx = tx0; tx <= tx1; tx += 1) {
      if (solidAt(g, tx, ty) || (b.gd === 1 && onewayAt(g, tx, ty) && prevBottom <= ty * TILE + EPS)) {
        hit = true;
        if (tileAt(g, tx, ty) === T.SPRING) spring = true;
      }
    }
    if (hit) {
      b.y = ty * TILE - b.h;
      if (b.gd === 1 && spring) {
        b.vy = -(pad.jump ? t.springHoldV : t.springV);
        b.jumping = true;
        ev.sprung = true;
      } else {
        if (b.gd === 1) {
          ev.landed = !b.onGround;
          ev.landSpeed = b.vy;
        }
        b.vy = 0;
      }
      return;
    }
    if (b.gd === 1 && landOnPlatform(b, g, prevBottom)) {
      ev.landed = !b.onGround;
      ev.landSpeed = b.vy;
      b.vy = 0;
    }
    return;
  }
  const ty = Math.floor(b.y / TILE);
  let blockedLeft = false;
  let blockedRight = false;
  for (let tx = tx0; tx <= tx1; tx += 1) {
    if (solidAt(g, tx, ty) || (b.gd === 1 && hiddenFromBelow(g, tx, ty, prevTop))) {
      if (tx === tx0) blockedLeft = true;
      if (tx === tx1) blockedRight = true;
    }
  }
  if (!blockedLeft && !blockedRight) return;
  if (b.gd === 1 && tx0 !== tx1 && blockedLeft !== blockedRight) {
    // A head clipping one block's corner slides past it.
    const overlap = blockedLeft ? (tx0 + 1) * TILE - b.x : b.x + b.w - tx1 * TILE;
    if (overlap <= CORNER) {
      const nx = blockedLeft ? (tx0 + 1) * TILE : tx1 * TILE - b.w;
      if (!overlapsSolid(g, nx, b.y, b.w, b.h)) {
        b.x = nx;
        return;
      }
    }
  }
  b.y = (ty + 1) * TILE;
  if (b.gd === -1) {
    ev.landed = !b.onGround;
    ev.landSpeed = -b.vy;
    b.vy = 0;
    return;
  }
  // A bonk: the block nearest the head's middle takes the hit.
  const mid = Math.floor((b.x + b.w / 2) / TILE);
  const target = (mid === tx0 && blockedLeft) || (mid === tx1 && blockedRight) ? mid : blockedLeft ? tx0 : tx1;
  ev.bumpTx = target;
  ev.bumpTy = ty;
  b.vy = 0.4;
}

/** Sets whether the body stands on something in gravity's direction, and on what. */
function probeGround(b: Body, g: Grid): void {
  b.onGround = false;
  b.surface = T.EMPTY;
  const tx0 = Math.floor(b.x / TILE);
  const tx1 = Math.floor((b.x + b.w - EPS) / TILE);
  if (b.gd === -1) {
    if (b.vy > 0) return;
    const ty = Math.floor((b.y - 0.05) / TILE);
    if (b.y < (ty + 1) * TILE - 0.05) return;
    for (let tx = tx0; tx <= tx1; tx += 1) {
      if (solidAt(g, tx, ty)) {
        b.onGround = true;
        b.surface = tileAt(g, tx, ty);
        return;
      }
    }
    return;
  }
  if (b.vy < 0) return;
  const foot = b.y + b.h;
  const ty = Math.floor((foot + 0.05) / TILE);
  if (foot <= ty * TILE + 0.05) {
    const mid = Math.floor((b.x + b.w / 2) / TILE);
    for (let tx = tx0; tx <= tx1; tx += 1) {
      if (solidAt(g, tx, ty) || onewayAt(g, tx, ty)) {
        // The tile under the body's middle decides ice and conveyors.
        if (!b.onGround || tx === mid) b.surface = tileAt(g, tx, ty);
        b.onGround = true;
      }
    }
    if (b.onGround) {
      b.platform = -1;
      return;
    }
  }
  if (b.platform >= 0 && b.platform < g.platformCount) {
    const at = b.platform * PLATFORM_STRIDE;
    const px = g.platforms[at] ?? 0;
    const py = g.platforms[at + 1] ?? 0;
    const pw = g.platforms[at + 2] ?? 0;
    if (b.x + b.w > px && b.x < px + pw && foot >= py - 1 && foot <= py + 2.5) {
      b.y = py - b.h;
      b.vy = 0;
      b.onGround = true;
      b.surface = T.HARD;
      return;
    }
    b.platform = -1;
  }
}

function touchesSpike(b: Body, g: Grid): boolean {
  const tx0 = Math.floor((b.x - 0.5) / TILE);
  const tx1 = Math.floor((b.x + b.w + 0.5) / TILE);
  const ty0 = Math.floor((b.y - 0.5) / TILE);
  const ty1 = Math.floor((b.y + b.h + 0.5) / TILE);
  for (let ty = ty0; ty <= ty1; ty += 1) {
    for (let tx = tx0; tx <= tx1; tx += 1) {
      if (tileAt(g, tx, ty) === T.SPIKE) {
        // Only an edge that touches counts, not a diagonal corner.
        const sideways = ty >= Math.floor(b.y / TILE) && ty <= Math.floor((b.y + b.h - EPS) / TILE);
        const endways = tx >= Math.floor(b.x / TILE) && tx <= Math.floor((b.x + b.w - EPS) / TILE);
        if (sideways || endways) return true;
      }
    }
  }
  return false;
}

/** Whether the body is in liquid deep enough to count. */
function inLiquid(b: Body, g: Grid): boolean {
  const cx = Math.floor((b.x + b.w / 2) / TILE);
  const feet = b.gd === 1 ? b.y + b.h - 2 : b.y + 2;
  return tileAt(g, cx, Math.floor(feet / TILE)) === T.LIQUID || tileAt(g, cx, Math.floor((b.y + b.h / 2) / TILE)) === T.LIQUID;
}

/**
 * One tick of movement. `pushX` and `pushY` move the body without being its
 * speed: wind, and the platform it rides.
 */
export function stepBody(b: Body, pad: Pad, t: Tuning, g: Grid, ev: StepEvents, pushX = 0, pushY = 0): void {
  ev.reset();
  const cx = Math.floor((b.x + b.w / 2) / TILE);
  const cy = Math.floor((b.y + b.h / 2) / TILE);
  const around = tileAt(g, cx, cy);
  b.inWater = around === T.WATER || (g.waterLine >= 0 && cy >= g.waterLine);
  const gd = around === T.FLIP ? -1 : 1;
  if (gd !== b.gd) {
    b.gd = gd;
    b.onGround = false;
    b.jumping = false;
    b.coyote = 0;
    b.platform = -1;
    ev.flipped = true;
  }

  // Sideways: momentum, with less grip on ice.
  const dir = (pad.right ? 1 : 0) - (pad.left ? 1 : 0);
  const max = b.inWater ? t.waterMax : pad.run ? t.runMax : t.walkMax;
  const grip = b.onGround ? surfaceGrip(b.surface) : 1;
  if (dir !== 0) {
    b.facing = dir;
    if (b.onGround && b.vx * dir < -0.2) {
      b.vx += dir * t.skid * grip;
      ev.skidding = true;
    } else if (b.vx * dir < max) {
      const accel = b.onGround ? (pad.run ? t.runAccel : t.accel) * surfaceAccel(b.surface) : t.airAccel;
      b.vx += dir * accel;
      if (b.vx * dir > max) b.vx = dir * max;
    } else {
      // Faster than allowed (run let go): ease back down to it.
      const ease = b.onGround ? t.decel * grip : t.airDecel;
      b.vx -= dir * ease;
      if (b.vx * dir < max) b.vx = dir * max;
    }
  } else {
    const ease = b.onGround ? t.decel * grip : t.airDecel;
    if (Math.abs(b.vx) <= ease) b.vx = 0;
    else b.vx -= Math.sign(b.vx) * ease;
  }

  // Up and down: jumps that are as high as they're held, coyote time and a buffer.
  b.buffer = pad.jumpPressed ? t.buffer : Math.max(0, b.buffer - 1);
  if (b.onGround) {
    b.coyote = t.coyote;
    b.jumping = false;
  } else {
    b.coyote = Math.max(0, b.coyote - 1);
  }
  b.gliding = false;
  if (b.inWater) {
    if (pad.jumpPressed) {
      b.vy = -b.gd * t.swimV;
      b.buffer = 0;
      ev.swam = true;
      b.onGround = false;
    }
    b.vy += b.gd * t.waterGrav;
    if (b.vy * b.gd > t.waterMaxFall) b.vy = b.gd * t.waterMaxFall;
  } else {
    if (b.buffer > 0 && (b.onGround || b.coyote > 0)) {
      // A jump off a belt or a moving platform keeps its push.
      if (b.onGround && b.gd === 1) {
        if (b.surface === T.CONV_R) b.vx += CONVEYOR_SPEED;
        else if (b.surface === T.CONV_L) b.vx -= CONVEYOR_SPEED;
        else if (b.platform >= 0 && b.platform < g.platformCount) b.vx += g.platforms[b.platform * PLATFORM_STRIDE + 3] ?? 0;
      }
      const speed = Math.min(1, Math.abs(b.vx) / t.runMax);
      b.vy = -b.gd * (t.jumpV + t.runJumpBonus * speed);
      b.jumping = true;
      b.onGround = false;
      b.coyote = 0;
      b.buffer = 0;
      b.platform = -1;
      ev.jumped = true;
    }
    const rising = b.vy * b.gd < 0;
    const pull = rising ? (pad.jump && b.jumping ? t.gravHold : t.gravRise) : t.gravFall;
    b.vy += b.gd * pull * t.gravityScale;
    let fall = t.maxFall;
    if (b.canGlide && pad.jump && !rising && !b.onGround) {
      fall = t.glideFall;
      b.gliding = true;
    }
    if (b.vy * b.gd > fall) b.vy = b.vy * b.gd > fall + 0.4 ? b.vy - b.gd * 0.4 : b.gd * fall;
  }

  // The platform under the feet carries the body.
  let carryX = pushX;
  let carryY = pushY;
  if (b.onGround && b.platform >= 0 && b.platform < g.platformCount) {
    carryX += g.platforms[b.platform * PLATFORM_STRIDE + 3] ?? 0;
    carryY += g.platforms[b.platform * PLATFORM_STRIDE + 4] ?? 0;
  } else if (!b.onGround) {
    b.platform = -1;
  }
  if (b.onGround && b.gd === 1) {
    if (b.surface === T.CONV_R) carryX += CONVEYOR_SPEED;
    else if (b.surface === T.CONV_L) carryX -= CONVEYOR_SPEED;
  }

  moveX(b, b.vx + carryX, g, ev);
  moveY(b, b.vy + carryY, g, t, pad, ev);
  probeGround(b, g);

  if (g.hazards) {
    if (touchesSpike(b, g)) ev.hurt = true;
    if (inLiquid(b, g)) ev.died = true;
  }
  if (b.gd === 1 ? b.y > g.h * TILE + 12 : b.y + b.h < -12) ev.died = true;
}

/** Whether the body fits where it is (for growing, and for resuming a save). */
export function fits(b: Body, g: Grid, h = b.h): boolean {
  return !overlapsSolid(g, b.x, b.gd === 1 ? b.y + b.h - h : b.y, b.w, h);
}
