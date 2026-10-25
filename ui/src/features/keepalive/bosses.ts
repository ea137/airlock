// The five bosses, each a small state machine on one entity, each beaten
// by abilities together rather than by hitting harder:
//
// - Spinlock turns its arms for ever; only while Cron holds time still can
//   Echo walk in between them and ping its core.
// - The OOM Killer dashes at Echo; dashing into one of Sudo's heavy blocks
//   stuns it, and a stunned Killer can be shoved.
// - Jitter surfaces in the void, out of reach of the shore; Float carries
//   Echo out to ping it before it dives (Cron keeps it up longer).
// - The Spoofer splits into copies of your friends; a ping shows the real
//   one, which then stands still for Sudo's shove (Tel can slow the rest).
// - The Watchdog hides behind firewalls (break them with Sudo, between its
//   beams held still by Cron), then drops the floor: Float and the relays
//   take Echo to its three timeout clocks. After that, it listens.
//
// Entity fields: hp, state (0 waiting, 1 fighting, 8 listening, 9 down),
// c the step it's on, t a timer, b and a for whatever else it needs.

import { EV, K } from './kinds';
import type { Ent, World } from './sim';
import { beamTouches, PING_RADIUS } from './sim';
import { markAt, T, TILE } from './world';

export type BossHooks = {
  /** Whether Echo can walk through it. */
  solid: boolean;
  spawn(w: World, e: Ent): void;
  update(w: World, e: Ent, frozen: boolean): void;
  ping(w: World, e: Ent): void;
  /** Sudo's shove landing at (x, y); true if it hit. */
  force(w: World, e: Ent, x: number, y: number): boolean;
};

export const BOSS_HP = 3;
/** Spinlock's arms: how many, how long, how fast (turns a second) in each phase. */
export const SPIN = { arms: [4, 4, 6], length: [4, 4, 4.5], speed: [0.1, -0.15, 0.19] };

function near(w: World, e: Ent, reach: number): boolean {
  return Math.hypot(w.pingX - e.x, w.pingY - e.y) <= reach;
}

/** A hit: one less point, a flash, and the boss beaten at none. */
function hit(w: World, e: Ent, kind: string): void {
  e.hp -= 1;
  e.b = 40;
  w.shake = 12;
  w.events.push(EV.BOSS_HIT, e.x, e.y, e.hp);
  if (e.hp <= 0) {
    e.state = 9;
    w.beat(kind);
  } else {
    w.events.push(EV.BOSS_PHASE, e.x, e.y, BOSS_HP - e.hp);
  }
}

function phase(e: Ent): number {
  return Math.max(0, Math.min(2, BOSS_HP - e.hp));
}

const spinlock: BossHooks = {
  solid: true,
  spawn(_w, e) {
    e.hp = BOSS_HP;
  },
  update(w, e, frozen) {
    if (e.b > 0) e.b -= 1;
    if (e.state !== 1 || frozen) return;
    const p = phase(e);
    e.a += ((SPIN.speed[p] ?? 0.1) * Math.PI * 2) / 60;
    e.t += 1;
    if (beamTouches(e.x, e.y, e.a, SPIN.arms[p] ?? 4, (SPIN.length[p] ?? 4) * TILE, w.x, w.y - 2)) w.hurt(e.x, e.y);
    // Sparks thrown out between the arms, once it's angry.
    if (p > 0 && e.t % (p === 1 ? 110 : 80) === 0) {
      const arms = SPIN.arms[p] ?? 4;
      for (let arm = 0; arm < arms; arm += 2) w.shoot(e.x, e.y, 0.9, e.a + ((arm + 0.5) * Math.PI * 2) / arms);
    }
  },
  ping(w, e) {
    if (e.state !== 1 || e.b > 0 || !near(w, e, PING_RADIUS + 10)) return;
    // Spinning, the lock throws a ping off; held still, it takes it.
    if (w.freeze > 0) hit(w, e, 'spinlock');
    else w.events.push(EV.BUMP, e.x, e.y);
  },
  force() {
    return false;
  },
};

/** The OOM Killer's steps. */
export const OOM = { STALK: 0, AIM: 1, DASH: 2, STUNNED: 3, RECOIL: 4 } as const;
const DASH_SPEED = 3.2;

const oom: BossHooks = {
  solid: false,
  spawn(_w, e) {
    e.hp = BOSS_HP;
    e.c = OOM.STALK;
    e.t = 60;
  },
  update(w, e, frozen) {
    if (e.b > 0) e.b -= 1;
    if (e.state !== 1 || frozen) return;
    const ax = w.x - e.x;
    const ay = w.y - 4 - e.y;
    e.t -= 1;
    switch (e.c) {
      case OOM.STALK:
        e.x += Math.sign(ax) * Math.min(Math.abs(ax), 0.35);
        e.y += Math.sign(ay) * Math.min(Math.abs(ay), 0.35);
        if (e.t <= 0) {
          e.c = OOM.AIM;
          e.t = 40;
          // Locks on along the longer way to Echo.
          e.dir = Math.abs(ax) > Math.abs(ay) ? (ax > 0 ? 1 : 3) : ay > 0 ? 2 : 0;
        }
        break;
      case OOM.AIM:
        if (e.t <= 0) {
          e.c = OOM.DASH;
          e.t = 120;
        }
        break;
      case OOM.DASH: {
        const mx = e.dir === 1 ? 1 : e.dir === 3 ? -1 : 0;
        const my = e.dir === 2 ? 1 : e.dir === 0 ? -1 : 0;
        let stopped = false;
        for (let k = 0; k < DASH_SPEED * 4 && !stopped; k += 1) {
          const nx = e.x + mx * 0.25;
          const ny = e.y + my * 0.25;
          const i = w.tileIndex(nx + mx * 9, ny + my * 9);
          const tile = w.tiles[i] ?? T.WALL;
          const o = i >= 0 ? (w.occ[i] ?? 0) - 1 : -1;
          const blockAhead = o >= 0 && w.ents[o]?.k === K.BLOCK && w.ents[o]?.a === 1;
          if (i < 0 || tile === T.WALL || tile === T.DECOR || tile === T.DECOR2 || blockAhead) {
            stopped = true;
            w.shake = 8;
            w.events.push(EV.BUMP, e.x, e.y);
            if (blockAhead) {
              e.c = OOM.STUNNED;
              e.t = 170;
            } else {
              e.c = OOM.RECOIL;
              e.t = 50;
            }
          } else {
            e.x = nx;
            e.y = ny;
          }
        }
        if (!stopped && e.t <= 0) {
          e.c = OOM.RECOIL;
          e.t = 40;
        }
        break;
      }
      case OOM.STUNNED:
        if (e.t <= 0) {
          e.c = OOM.RECOIL;
          e.t = 30;
        }
        break;
      default:
        if (e.t <= 0) {
          // Angry, it throws kill signals as it comes round.
          const p = phase(e);
          if (p > 0) for (let k = -1; k <= 1; k += 1) w.shoot(e.x, e.y, 1.1 + p * 0.15, Math.atan2(ay, ax) + k * 0.35);
          e.c = OOM.STALK;
          e.t = 110 - p * 25;
        }
    }
    if (e.c !== OOM.STUNNED && Math.abs(ax) < 12 && Math.abs(ay) < 12) w.hurt(e.x, e.y);
  },
  ping() {},
  force(w, e, x, y) {
    if (e.state !== 1 || Math.abs(e.x - x) > 18 || Math.abs(e.y - y) > 18) return false;
    if (e.c !== OOM.STUNNED || e.b > 0) {
      w.events.push(EV.BUMP, e.x, e.y);
      return true;
    }
    hit(w, e, 'oom');
    // Knocked back the way the shove went.
    const ax = e.x - w.x;
    const ay = e.y - w.y;
    const length = Math.hypot(ax, ay) || 1;
    for (let k = 0; k < 20; k += 1) {
      const nx = e.x + (ax / length) * 1;
      const ny = e.y + (ay / length) * 1;
      if (w.solidAtPoint(nx, ny)) break;
      e.x = nx;
      e.y = ny;
    }
    e.c = OOM.RECOIL;
    e.t = 70;
    return true;
  },
};

/** Jitter's steps; its holes are the area's marks 1 to 6. */
export const JIT = { UNDER: 0, RISING: 1, UP: 2, DIVING: 3 } as const;
const HOLES = '123456';

function hole(w: World, n: number): { x: number; y: number } | null {
  const at = markAt(w.area, HOLES[n] ?? '1');
  return at ? { x: at.x * TILE + 8, y: at.y * TILE + 8 } : null;
}

function holeCount(w: World): number {
  let n = 0;
  while (n < HOLES.length && markAt(w.area, HOLES[n] ?? '') !== null) n += 1;
  return n;
}

const jitter: BossHooks = {
  solid: false,
  spawn(w, e) {
    e.hp = BOSS_HP;
    e.c = JIT.UNDER;
    e.t = 90;
    e.a = 0;
    const first = hole(w, 0);
    if (first) {
      e.x = first.x;
      e.y = first.y;
    }
  },
  update(w, e, frozen) {
    if (e.b > 0) e.b -= 1;
    if (e.state !== 1) return;
    // Held still, it can't dive.
    if (frozen) return;
    e.t -= 1;
    switch (e.c) {
      case JIT.UNDER:
        if (e.t <= 0) {
          const count = Math.max(1, holeCount(w));
          // Never the same hole twice running.
          e.a = (e.a + 1 + w.rng.int(Math.max(1, count - 1))) % count;
          const next = hole(w, e.a);
          if (next) {
            e.x = next.x;
            e.y = next.y;
          }
          e.c = JIT.RISING;
          e.t = 24;
        }
        break;
      case JIT.RISING:
        if (e.t <= 0) {
          e.c = JIT.UP;
          e.t = 170 - phase(e) * 30;
        }
        break;
      case JIT.UP:
        if (e.t % (70 - phase(e) * 15) === 0) w.shoot(e.x, e.y - 6, 1 + phase(e) * 0.2);
        if (e.t <= 0) {
          e.c = JIT.DIVING;
          e.t = 24;
        }
        break;
      default:
        if (e.t <= 0) {
          e.c = JIT.UNDER;
          e.t = 80 - phase(e) * 15;
        }
    }
  },
  ping(w, e) {
    if (e.state !== 1 || e.b > 0 || (e.c !== JIT.UP && e.c !== JIT.RISING) || !near(w, e, PING_RADIUS + 8)) return;
    hit(w, e, 'jitter');
    e.c = JIT.DIVING;
    e.t = 24;
  },
  force() {
    return false;
  },
};

/** The Spoofer: copies turning round a centre; `c` is which copy is real, `a` the angle. */
export const SPOOF = { COPIES: 4, RADIUS: 44 } as const;

/** Where copy n of the Spoofer stands. */
export function spoofCopy(e: Ent, n: number, out: { x: number; y: number }): { x: number; y: number } {
  const angle = e.a + (n * Math.PI * 2) / SPOOF.COPIES;
  out.x = e.vx + Math.cos(angle) * SPOOF.RADIUS;
  out.y = e.vy + Math.sin(angle) * SPOOF.RADIUS * 0.8;
  return out;
}

const copy = { x: 0, y: 0 };

const spoofer: BossHooks = {
  solid: false,
  spawn(w, e) {
    e.hp = BOSS_HP;
    // The centre it turns about is where it was placed.
    e.vx = e.x;
    e.vy = e.y;
    e.c = w.rng.int(SPOOF.COPIES);
    e.t = 0;
  },
  update(w, e, frozen) {
    if (e.b > 0) e.b -= 1;
    if (e.state !== 1 || frozen) return;
    // `dir` counts down while the real one is shown, standing still.
    if (e.dir > 0) {
      e.dir -= 1;
    } else {
      // Tel's word with the terminal slows the dance.
      const slow = w.on(1) ? 0.5 : 1;
      e.a += (0.011 + phase(e) * 0.004) * slow;
    }
    e.t += 1;
    spoofCopy(e, e.c, copy);
    e.x = copy.x;
    e.y = copy.y;
    if (e.t % (100 - phase(e) * 20) === 0) w.shoot(e.x, e.y, 1 + phase(e) * 0.15);
    for (let n = 0; n < SPOOF.COPIES; n += 1) {
      spoofCopy(e, n, copy);
      if (Math.abs(copy.x - w.x) < 10 && Math.abs(copy.y - (w.y - 4)) < 10) w.hurt(copy.x, copy.y);
    }
  },
  ping(w, e) {
    if (e.state !== 1) return;
    for (let n = 0; n < SPOOF.COPIES; n += 1) {
      spoofCopy(e, n, copy);
      if (Math.hypot(w.pingX - copy.x, w.pingY - copy.y) > PING_RADIUS + 16) continue;
      // Only the real one answers a ping.
      if (n === e.c) {
        e.dir = 190;
        w.events.push(EV.NODE, copy.x, copy.y, 3);
      }
    }
  },
  force(w, e, x, y) {
    if (e.state !== 1) return false;
    for (let n = 0; n < SPOOF.COPIES; n += 1) {
      spoofCopy(e, n, copy);
      if (Math.abs(copy.x - x) > 16 || Math.abs(copy.y - y) > 16) continue;
      if (n === e.c && e.dir > 0 && e.b === 0) {
        hit(w, e, 'spoofer');
        e.dir = 0;
        e.c = (e.c + 1 + w.rng.int(SPOOF.COPIES - 1)) % SPOOF.COPIES;
      } else {
        // A copy: it scatters, and the real one answers with a shot.
        w.events.push(EV.WHIFF, copy.x, copy.y);
        spoofCopy(e, e.c, copy);
        w.shoot(copy.x, copy.y, 1.3);
      }
      return true;
    }
    return false;
  },
};

/** The Watchdog's steps. Its shield is the cracked walls round it; its clocks, the relays on signal b. */
export const DOG = { SHIELD: 0, FLOOR: 1, LISTENING: 2 } as const;

function shieldLeft(w: World, e: Ent): number {
  let n = 0;
  const tx = Math.floor(e.x / TILE);
  const ty = Math.floor(e.y / TILE);
  for (let y = ty - 2; y <= ty + 2; y += 1) for (let x = tx - 2; x <= tx + 2; x += 1) if (w.tileAt(x, y) === T.CRACKED) n += 1;
  return n;
}

const watchdog: BossHooks = {
  solid: true,
  spawn(w, e) {
    e.hp = BOSS_HP;
    // Picks up where the fight was: shield broken, floor dropped, clocks found.
    e.c = w.story.has('wd.drop') ? DOG.FLOOR : DOG.SHIELD;
  },
  update(w, e, frozen) {
    if (e.b > 0) e.b -= 1;
    if (e.state !== 1 || frozen) return;
    e.t += 1;
    if (e.c === DOG.SHIELD) {
      if (e.t % 75 === 0) w.shoot(e.x, e.y + 10, 1.15);
      if (shieldLeft(w, e) === 0) {
        e.c = DOG.FLOOR;
        e.t = 0;
        w.story.flags.add('wd.drop');
        w.refresh();
        w.shake = 30;
        w.freeze = 0;
        w.events.push(EV.BOSS_PHASE, e.x, e.y, 1);
        if (!w.story.has('seen.watchdog.drop')) w.want = 'watchdog.drop';
      }
    } else if (e.c === DOG.FLOOR) {
      if (e.t % 95 === 0) w.shoot(e.x, e.y + 10, 1.05);
      // Its three timeout clocks, all pinged: signal b.
      if (w.on(1)) {
        e.c = DOG.LISTENING;
        e.state = 8;
        w.story.flags.add('wd.clocks');
        w.events.push(EV.BOSS_PHASE, e.x, e.y, 2);
        for (const shot of w.ents) if (shot.k === K.SHOT) shot.k = K.NONE;
        w.want = 'watchdog.talk';
      }
    }
  },
  ping(w, e) {
    if (e.state === 1 && near(w, e, PING_RADIUS + 16)) w.events.push(EV.BUMP, e.x, e.y);
  },
  force(w, e, x, y) {
    if (e.state !== 1 || Math.abs(e.x - x) > 20 || Math.abs(e.y - y) > 20) return false;
    w.events.push(EV.BUMP, e.x, e.y);
    return true;
  },
};

const NONE: BossHooks = {
  solid: false,
  spawn() {},
  update() {},
  ping() {},
  force() {
    return false;
  },
};

export const BOSSES: Record<string, BossHooks> = { spinlock, oom, jitter, spoofer, watchdog };

export function bossHooks(kind: string): BossHooks {
  return BOSSES[kind] ?? NONE;
}
