import { describe, expect, it } from 'vitest';

import { emptyFrame, type Frame } from './input';
import { EV, K } from './kinds';
import { FREEZE_TICKS, HOVER_TICKS, World } from './sim';
import { type AreaSpec, block, crusher, door, gate, ghost, lamp, mover, node, plate, sentry, T, TILE } from './world';

/** A world with one area, Echo standing on its '@'. */
function world(map: string, key: AreaSpec['key'] = {}, extra: Partial<AreaSpec> = {}): World {
  const spec: AreaSpec = { id: 'test', name: 'Test', chapter: 1, map, key, ...extra };
  const w = new World([spec], 'test');
  w.enter('test', '@', 2, false);
  w.want = '';
  return w;
}

/** Runs ticks with the controls `drive` sets; returns the events seen. */
function run(w: World, ticks: number, drive: (f: Frame, tick: number) => void = () => {}): number[] {
  const seen: number[] = [];
  for (let tick = 0; tick < ticks; tick += 1) {
    const f = emptyFrame();
    drive(f, tick);
    w.step(f);
    for (let i = 0; i < w.events.count; i += 1) seen.push(w.events.data[i * 4] ?? 0);
  }
  return seen;
}

const tileX = (w: World) => Math.floor(w.x / TILE);
const tileY = (w: World) => Math.floor(w.y / TILE);

/** Holds a direction (0 up, 1 right, 2 down, 3 left). */
const hold = (dir: number) => (f: Frame) => {
  f.dir = dir;
};

/** Presses a button once, on the first tick. */
const tap = (button: 'a' | 'b' | 'switch') => (f: Frame, tick: number) => {
  f.pressed[button] = tick === 0;
};

describe('walking', () => {
  it('walks a tile in under a sixth of a second and stops at walls', () => {
    const w = world(`
#######
#@....#
#######`);
    run(w, 200, hold(1));
    expect(tileX(w)).toBe(5);
    expect(w.x).toBeLessThanOrEqual(6 * TILE - 5);
  });

  it('slips round a corner it nearly clears', () => {
    const w = world(`
#####
#@..#
##..#
##..#
#####`);
    // Six pixels short of the corridor: walking down nudges it in.
    w.x += 7;
    run(w, 60, hold(2));
    expect(tileY(w)).toBeGreaterThanOrEqual(3);
  });

  it('falls into the void, loses a heart and comes back to the edge', () => {
    const w = world(`
#######
#@.  .#
#######`);
    const events = run(w, 120, (f) => {
      if (w.fall === 0 && w.hp === w.maxHp) f.dir = 1;
    });
    expect(events).toContain(EV.FALL);
    expect(w.hp).toBe(w.maxHp - 1);
    expect(tileX(w)).toBeLessThanOrEqual(2);
  });

  it('times out at no hearts and starts the area again, healed', () => {
    const w = world(`
########
#@.  ..#
########`);
    w.hp = 1;
    let out = false;
    const events = run(w, 90, (f) => {
      if (w.fall > 0) out = true;
      if (!out) f.dir = 1;
    });
    expect(events).toContain(EV.TIMEOUT);
    expect(w.hp).toBe(w.maxHp);
    expect(tileX(w)).toBe(1);
  });
});

describe('the party', () => {
  it('follows in a line behind, a tile or so apart', () => {
    const w = world(`
##############
#@...........#
##############`);
    w.story.party.push('cron', 'sudo');
    w.lineUp();
    run(w, 120, hold(1));
    const first = w.follower(0, { x: 0, y: 0 });
    const second = w.follower(1, { x: 0, y: 0 });
    expect(w.x - first.x).toBeGreaterThan(10);
    expect(w.x - first.x).toBeLessThan(22);
    expect(first.x - second.x).toBeGreaterThan(10);
  });

  it('switches who walks in front', () => {
    const w = world(`
#####
#@..#
#####`);
    w.story.party.push('cron', 'sudo', 'float');
    run(w, 1, tap('switch'));
    expect(w.story.party).toEqual(['sudo', 'float', 'cron']);
  });
});

describe('ping', () => {
  it('lights relays and lamps within three tiles, not further', () => {
    const w = world(
      `
##########
#@..a..b.#
##########`,
      { a: node('a'), b: lamp('b') },
    );
    run(w, 1, tap('b'));
    const near = w.area.marks.get('a') ?? 0;
    const far = w.area.marks.get('b') ?? 0;
    expect(w.lit[near]).not.toBe(0);
    expect(w.lit[far]).toBe(0);
    expect(w.on(0)).toBe(true);
  });

  it('a timed relay goes out, and holds while time is frozen', () => {
    const w = world(
      `
#######
#@.a..#
#######`,
      { a: node('a', 60) },
    );
    w.story.party.push('cron');
    w.story.flags.add('can.freeze');
    run(w, 1, tap('b'));
    run(w, 1, tap('a'));
    expect(w.freeze).toBeGreaterThan(0);
    run(w, 120);
    expect(w.on(0)).toBe(true);
    run(w, FREEZE_TICKS);
    expect(w.on(0)).toBe(false);
  });
});

describe('freeze', () => {
  it('needs Cron in front, wound', () => {
    const w = world(`
####
#@.#
####`);
    w.story.party.push('cron');
    run(w, 1, tap('a'));
    expect(w.freeze).toBe(0);
    w.story.flags.add('can.freeze');
    run(w, 1, tap('a'));
    expect(w.freeze).toBe(FREEZE_TICKS - 0);
  });

  it('stops a moving platform and the clock; gates hold as they were', () => {
    const w = world(
      `
#########
#@g.  . #
#########`,
      { g: gate(120, 40), ' ': ' ' as never },
    );
    w.story.party.push('cron');
    w.story.flags.add('can.freeze');
    const clock = w.clock;
    run(w, 1, tap('a'));
    run(w, 100);
    expect(w.clock).toBe(clock + 1);
    const i = w.area.marks.get('g') ?? 0;
    expect(w.gateOpen(i)).toBe(true);
  });
});

describe('hover', () => {
  const gap = (pits: number) => `
${'#'.repeat(pits + 6)}
#@.${' '.repeat(pits)}..#
${'#'.repeat(pits + 6)}`;

  for (const pits of [1, 2, 3, 4]) {
    it(`carries Echo over ${pits} tile${pits > 1 ? 's' : ''} of void`, () => {
      const w = world(gap(pits));
      w.story.party.push('float');
      // Walk to the edge, then hover and keep walking.
      run(w, 200, (f, tick) => {
        f.dir = 1;
        f.pressed.a = tick === 8;
      });
      expect(w.hp).toBe(w.maxHp);
      expect(tileX(w)).toBe(pits + 4);
    });
  }

  it('does not reach over six tiles', () => {
    const w = world(gap(6));
    w.story.party.push('float');
    const events = run(w, 200, (f, tick) => {
      f.dir = 1;
      f.pressed.a = tick === 8;
    });
    expect(events).toContain(EV.FALL);
  });

  it('a vent lifts Echo again', () => {
    const w = world(`
############
#@.   ~   .#
############`);
    w.story.party.push('float');
    run(w, 260, (f, tick) => {
      f.dir = 1;
      f.pressed.a = tick === 4;
    });
    expect(w.hp).toBe(w.maxHp);
    expect(tileX(w)).toBe(10);
    expect(HOVER_TICKS).toBeGreaterThan(40);
  });
});

describe('blocks', () => {
  it('a crate slides a tile when pushed, and a heavy block needs Sudo', () => {
    const w = world(`
########
#@oO...#
########`);
    run(w, 30, hold(1));
    const crate = w.ents.find((e) => e.k === K.BLOCK && e.a === 0);
    // The crate is stopped by the heavy block behind it.
    expect(crate?.b).toBe(w.area.w + 2);
    w.story.party.push('sudo');
    const w2 = world(`
#######
#@O...#
#######`);
    run(w2, 30, hold(1));
    expect(w2.ents.find((e) => e.k === K.BLOCK)?.b).toBe(w2.area.w + 2);
    w2.story.party.push('sudo');
    run(w2, 30, hold(1));
    expect(w2.ents.find((e) => e.k === K.BLOCK)?.b).toBeGreaterThan(w2.area.w + 2);
  });

  it('pushed into the void, a block fills it and Echo can cross', () => {
    const w = world(`
#######
#@o ..#
#######`);
    const events = run(w, 120, hold(1));
    expect(events).toContain(EV.FILL);
    expect(w.tileAt(3, 1)).toBe(T.FILLED);
    expect(tileX(w)).toBeGreaterThanOrEqual(3);
  });

  it('on a plate, a block holds a door open', () => {
    const w = world(
      `
#########
#@.o.p..#
######d##
######..#
#########`,
      { p: plate('a'), d: door('a') },
    );
    expect(w.on(0)).toBe(false);
    run(w, 80, hold(1));
    expect(w.on(0)).toBe(true);
  });

  it('a conveyor carries a block along', () => {
    const w = world(
      `
#########
#@.b>>>.#
#########`,
      { b: block(false, T.CONV_R) },
    );
    run(w, 200);
    expect(w.ents.find((e) => e.k === K.BLOCK)?.b).toBe(w.area.w + 7);
  });
});

describe('force', () => {
  it('Sudo breaks a cracked wall, for good', () => {
    const w = world(`
#####
#@%.#
#####`);
    w.facing = 1;
    run(w, 1, tap('a'));
    expect(w.tileAt(2, 1)).toBe(T.CRACKED);
    w.story.party.push('sudo');
    run(w, 1, tap('a'));
    expect(w.tileAt(2, 1)).toBe(T.RUBBLE);
    w.enter('test', '@', 1, false);
    expect(w.tileAt(2, 1)).toBe(T.RUBBLE);
  });
});

describe('hazards', () => {
  it('a sentry that sees Echo sends it back to the way in', () => {
    const w = world(
      `
#########
#@......#
#....s..#
#########`,
      { s: sentry(0, 0, 3) },
    );
    const seen: number[] = [];
    for (let tick = 0; tick < 120 && !seen.includes(EV.CAUGHT); tick += 1) seen.push(...run(w, 1, hold(1)));
    expect(seen).toContain(EV.CAUGHT);
    expect(tileX(w)).toBe(1);
  });

  it('a frozen sentry sees nothing', () => {
    const w = world(
      `
#########
#@......#
#....s..#
#########`,
      { s: sentry(0, 0, 3) },
    );
    w.story.party.push('cron');
    w.story.flags.add('can.freeze');
    run(w, 1, tap('a'));
    const events = run(w, 100, hold(1));
    expect(events).not.toContain(EV.CAUGHT);
    expect(tileX(w)).toBeGreaterThanOrEqual(6);
  });

  it('a crusher coming down on Echo hurts and pushes it out', () => {
    const w = world(
      `
######
#@c..#
######`,
      { c: crusher(60, 0) },
    );
    // Standing right under it, as it comes down.
    w.x = 2 * TILE + 8;
    const events = run(w, 60);
    expect(events).toContain(EV.HURT);
    expect(tileX(w)).not.toBe(2);
  });

  it('a platform carries Echo over the void and back', () => {
    const w = world(
      `
#########
#@.m   .#
#########`,
      { m: mover('r3', 0.5) },
    );
    // On the platform, riding it out and back without falling.
    run(w, 1);
    const platform = w.ents.find((e) => e.k === K.MOVER);
    w.x = platform?.x ?? 0;
    w.y = (platform?.y ?? 0) + 2;
    let furthest = 0;
    for (let tick = 0; tick < 240; tick += 1) {
      run(w, 1);
      furthest = Math.max(furthest, w.x);
    }
    expect(w.fall).toBe(0);
    expect(w.hp).toBe(w.maxHp);
    expect(furthest).toBeGreaterThan(5 * TILE);
  });

  it('a ghost floor holds Echo up while its relay is lit', () => {
    const w = world(
      `
#########
###a#####
#@..~~~.#
#########`,
      { a: node('a', 300), '~': ghost('a') },
    );
    run(w, 1, tap('b'));
    run(w, 120, hold(1));
    expect(w.hp).toBe(w.maxHp);
    expect(tileX(w)).toBe(7);
  });

  it('a ghost floor with its relay out is the void', () => {
    const w = world(
      `
#########
###a#####
#@..~~~.#
#########`,
      { a: node('a', 300), '~': ghost('a') },
    );
    const events = run(w, 60, hold(1));
    expect(events).toContain(EV.FALL);
  });
});
