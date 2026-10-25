import { describe, expect, it } from 'vitest';

import { K } from './kinds';
import { isSaved, restore, snapshot, upgrade } from './save';
import { type Input, Play, POWER, START_LIVES } from './sim';
import { T, TILE } from './tiles';
import { BY_FLAG, hopNumber } from './world';

const IDLE: Input = { left: false, right: false, up: false, down: false, a: false, b: false };

function hold(play: Play, input: Partial<Input>, ticks: number): void {
  for (let i = 0; i < ticks; i += 1) play.step({ ...IDLE, ...input });
}

/** A scripted player: runs right, jumps every so often, sometimes holds back. */
function scripted(tick: number): Input {
  const phase = tick % 240;
  return {
    left: phase > 200 && phase < 215,
    right: phase < 200,
    up: false,
    down: phase === 230,
    a: tick % 47 < 14,
    b: phase < 150,
  };
}

/** Clears the level around the start, and puts what's wanted next to the packet. */
function arena(play: Play): { floor: number; x: number } {
  const g = play.grid;
  const x = Math.floor(play.body.x / TILE);
  const floor = Math.floor((play.body.y + play.body.h + 1) / TILE);
  for (let tx = x - 2; tx < x + 20; tx += 1) {
    for (let ty = 0; ty < g.h; ty += 1) g.tiles[ty * g.w + tx] = ty >= floor ? T.GROUND : T.EMPTY;
  }
  for (const e of play.ents) if (e.k !== K.GOAL) e.k = 0;
  return { floor, x };
}

describe('Play', () => {
  it('starts on the first hop of the first zone with five lives', () => {
    const play = new Play(42);
    expect(play.zone).toBe(1);
    expect(play.hop).toBe(1);
    expect(play.lives).toBe(START_LIVES);
    expect(play.power).toBe(POWER.SMALL);
  });

  it('squashes a bug that is jumped on, and bounces', () => {
    const play = new Play(1);
    const { floor, x } = arena(play);
    const bug = play.spawn(K.CRAWLER, (x + 3) * TILE, (floor - 1) * TILE);
    expect(bug).not.toBeNull();
    if (!bug) return;
    bug.active = true;
    bug.vx = 0;
    bug.dir = 0;
    // Drop the packet onto it from above.
    play.body.x = bug.x + 1;
    play.body.y = bug.y - 30;
    play.body.vy = 1;
    let bounced = false;
    for (let i = 0; i < 40; i += 1) {
      play.step(IDLE);
      if (play.body.vy < -1) bounced = true;
    }
    expect(bounced).toBe(true);
    expect(bug.k === 0 || bug.state < 0).toBe(true);
    expect(play.score).toBeGreaterThan(0);
  });

  it('grows with RAM, and shrinks back when hurt', () => {
    const play = new Play(1);
    const { floor, x } = arena(play);
    const ram = play.spawn(K.RAM, (x + 1) * TILE, (floor - 1) * TILE);
    if (ram) ram.active = true;
    hold(play, { right: true }, 40);
    expect(play.power).toBe(POWER.BIG);
    expect(play.body.h).toBe(13);
    play.hurt();
    expect(play.power).toBe(POWER.SMALL);
    expect(play.body.h).toBe(7);
    expect(play.invuln).toBeGreaterThan(0);
  });

  it('loses a life in a pit and starts the hop again', () => {
    const play = new Play(1);
    const g = play.grid;
    for (let tx = 0; tx < g.w; tx += 1) for (let ty = 0; ty < g.h; ty += 1) g.tiles[ty * g.w + tx] = T.EMPTY;
    hold(play, {}, 300);
    expect(play.lives).toBe(START_LIVES - 1);
    expect(play.mode).toBe('play');
    expect(play.hop).toBe(1);
  });

  it('moves on to the next hop at the flag, and to the next zone after the core', () => {
    const play = new Play(1);
    const goal = play.ents.find((e) => e.k === K.GOAL);
    expect(goal).toBeDefined();
    if (!goal) return;
    play.body.x = goal.x - 4;
    play.body.y = goal.y + 20;
    play.snapCamera();
    hold(play, { right: true }, 10);
    expect(play.mode).toBe('clear');
    hold(play, {}, 200);
    expect(play.hop).toBe(2);
    play.hop = 4;
    play.startHop(false);
    expect(play.level.kind).toBe('core');
    const boss = play.bossEnt;
    expect(boss).not.toBeNull();
  });

  it('goes down a warp pipe to a bonus room, and back out of the same pipe', () => {
    let play: Play | null = null;
    for (let zone = 1; zone < 30 && !play; zone += 1) {
      for (let hop = 1; hop <= 3 && !play; hop += 1) {
        const candidate = new Play(11);
        candidate.zone = zone;
        candidate.hop = hop;
        candidate.startHop(false);
        if (candidate.level.warps.length > 0) play = candidate;
      }
    }
    expect(play).not.toBeNull();
    if (!play) return;
    const warp = play.level.warps[0];
    if (!warp) return;
    const standOn = (p: Play, tx: number, ty: number) => {
      p.body.x = tx * TILE + 2;
      p.body.y = ty * TILE - p.body.h;
      p.body.vy = 0;
      p.snapCamera();
      hold(p, {}, 5);
      hold(p, { down: true }, 1);
    };
    standOn(play, warp.tx, warp.ty);
    expect(play.mode).toBe('pipe');
    hold(play, {}, 90);
    expect(play.room).toBe(warp.to);
    expect(play.mode).toBe('play');
    // The bonus room's own pipe leads back.
    const exit = play.grid.tiles.indexOf(T.WARP);
    standOn(play, exit % play.grid.w, Math.floor(exit / play.grid.w));
    hold(play, {}, 90);
    expect(play.room).toBe(0);
    expect(Math.abs(play.body.x - warp.tx * TILE)).toBeLessThan(12);
  });

  it('takes the backdoor straight on to the next zone', () => {
    const play = new Play(1);
    const door = play.spawn(K.BACKDOOR, play.body.x, play.body.y);
    if (door) door.active = true;
    hold(play, {}, 3);
    expect(play.mode).toBe('clear');
    hold(play, {}, 200);
    expect(play.zone).toBe(2);
    expect(play.hop).toBe(1);
    // On the map: the backdoor taken, the next zone open, the rest of this one not.
    expect(play.world.get(1, 1)).toMatchObject({ backdoor: true, cleared: false });
    expect(play.world.open(2, 1)).toBe(true);
    expect(play.world.open(1, 2)).toBe(false);
  });

  it('records a clear for the world map, with its keys and time, and opens the next hop', () => {
    const play = new Play(1);
    hold(play, {}, 90);
    play.keysGot = [7];
    const goal = play.ents.find((e) => e.k === K.GOAL);
    if (!goal) return;
    play.body.x = goal.x - 4;
    play.body.y = goal.y + 20;
    play.snapCamera();
    hold(play, { right: true }, 10);
    expect(play.mode).toBe('clear');
    expect(play.world.get(1, 1)).toMatchObject({ cleared: true, keys: [7] });
    expect(play.world.get(1, 1).time).toBeGreaterThanOrEqual(90);
    expect(play.opened).toEqual([{ zone: 1, hop: 2 }]);
    hold(play, {}, 200);
    // The next hop's clock starts again.
    expect(play.hop).toBe(2);
    expect(play.hopTicks).toBeLessThan(60);
  });

  it('starts a hop picked on the map from its start, keeping the world and the lives', () => {
    const play = new Play(1);
    play.world.clear(1, 1, BY_FLAG, [], 100);
    play.lives = 3;
    play.keysGot = [3];
    hold(play, { right: true }, 60);
    play.startLevel(1, 2);
    expect([play.zone, play.hop, play.lives, play.hopTicks]).toEqual([1, 2, 3, 0]);
    expect(play.keysGot).toEqual([]);
    expect(play.mode).toBe('play');
    expect(play.world.get(1, 1).cleared).toBe(true);
  });

  it('gives a life for all three keys of a hop', () => {
    const play = new Play(1);
    play.keysGot = [1, 2, 3];
    const lives = play.lives;
    const goal = play.ents.find((e) => e.k === K.GOAL);
    if (!goal) return;
    play.body.x = goal.x - 4;
    play.body.y = goal.y + 20;
    play.snapCamera();
    hold(play, { right: true }, 10);
    expect(play.lives).toBe(lives + 1);
  });

  it('steps the same way from the same start and the same buttons', () => {
    const a = new Play(7);
    const b = new Play(7);
    for (let tick = 0; tick < 900; tick += 1) {
      a.step(scripted(tick));
      b.step(scripted(tick));
    }
    expect(a.body.x).toBe(b.body.x);
    expect(a.score).toBe(b.score);
    expect(a.tick).toBe(b.tick);
  });
});

describe('bosses', () => {
  /** The first zone (from 1) whose boss is this kind. */
  function zoneWith(kind: string): number {
    for (let zone = 1; zone < 40; zone += 1) {
      const play = new Play(3);
      play.zone = zone;
      play.hop = 4;
      play.startHop(false);
      if (play.level.boss === kind) return zone;
    }
    throw new Error(`No zone has a ${kind}.`);
  }

  for (const kind of ['hopper', 'swooper', 'charger', 'burrower', 'swarm']) {
    it(`${kind}: the gate shuts, stomps wear it down, and the flag comes down after`, () => {
      const play = new Play(3);
      play.zone = zoneWith(kind);
      play.hop = 4;
      play.startHop(false);
      expect(play.gateX).toBeGreaterThan(0);
      // Walk in through the gate.
      play.body.x = (play.gateX + 4) * TILE;
      play.body.y = 0;
      play.snapCamera();
      hold(play, {}, 60);
      expect(play.bossOn).toBe(true);
      const boss = play.bossEnt;
      expect(boss).not.toBeNull();
      if (!boss) return;
      // Stomp it whenever it can be stomped, until it's beaten.
      play.star = 0;
      const full = boss.hp;
      let stomps = 0;
      let afterFirst = -1;
      for (let tick = 0; tick < 6000 && play.bossEnt && boss.state >= 0; tick += 1) {
        if (afterFirst < 0 && boss.hp < full) afterFirst = boss.hp;
        play.invuln = 999;
        play.lives = 5;
        if (play.mode !== 'play') break;
        // Drop onto it from above whenever it can be stomped.
        if (tick % 40 === 0 && boss.a !== 1 && boss.c !== 1 && boss.t2 === 0) {
          play.body.x = boss.x + boss.w / 2 - play.body.w / 2;
          play.body.y = boss.y - play.body.h - 6;
          play.body.vy = 2;
          play.body.gd = 1;
          stomps += 1;
        }
        play.step(IDLE);
      }
      expect(boss.state).toBeLessThan(0);
      expect(stomps).toBeGreaterThan(0);
      // One stomp is never enough.
      expect(afterFirst).toBeGreaterThan(0);
      expect(play.ents.some((e) => e.k === K.GOAL)).toBe(true);
    });
  }
});

describe('saving', () => {
  it('resumes exactly where it was saved', () => {
    const original = new Play(2024);
    let tick = 0;
    for (; tick < 1500; tick += 1) original.step(scripted(tick));
    const saved: unknown = JSON.parse(JSON.stringify(snapshot(original)));
    expect(isSaved(saved)).toBe(true);
    if (!isSaved(saved)) return;
    const resumed = new Play(1);
    restore(resumed, saved);
    expect(resumed.body.x).toBe(original.body.x);
    expect(resumed.zone).toBe(original.zone);
    for (let more = 0; more < 1500; more += 1, tick += 1) {
      original.step(scripted(tick));
      resumed.step(scripted(tick));
    }
    expect(resumed.body.x).toBe(original.body.x);
    expect(resumed.body.y).toBe(original.body.y);
    expect(resumed.score).toBe(original.score);
    expect(resumed.lives).toBe(original.lives);
    expect(resumed.hop).toBe(original.hop);
    expect(Array.from(resumed.grid.tiles)).toEqual(Array.from(original.grid.tiles));
  });

  it('keeps the world map through a save', () => {
    const original = new Play(5);
    original.world.clear(1, 1, BY_FLAG, [4, 9], 1234);
    original.startLevel(1, 2);
    const saved: unknown = JSON.parse(JSON.stringify(snapshot(original)));
    if (!isSaved(saved)) throw new Error('Not a save.');
    const resumed = new Play(1);
    restore(resumed, saved);
    expect(resumed.world.get(1, 1)).toEqual({ cleared: true, backdoor: false, secret: false, keys: [4, 9], time: 1234 });
    expect(resumed.world.open(1, 2)).toBe(true);
    expect(resumed.world.open(1, 3)).toBe(false);
  });

  it('brings a save from before the world map up to date, losing nothing', () => {
    const original = new Play(2024);
    original.zone = 2;
    original.hop = 3;
    original.startHop(false);
    for (let tick = 0; tick < 600; tick += 1) original.step(scripted(tick));
    const current = JSON.parse(JSON.stringify(snapshot(original))) as Record<string, unknown> & { n: Record<string, number> };
    // As version 1 wrote it: no world map, no hop clock.
    const { world: _world, ...rest } = current;
    const { hopTicks: _ticks, ...numbers } = current.n;
    const old = { ...rest, v: 1, n: numbers };
    expect(isSaved(old)).toBe(false);
    const saved = upgrade(old);
    expect(isSaved(saved)).toBe(true);
    if (!isSaved(saved)) return;
    const resumed = new Play(1);
    restore(resumed, saved);
    expect([resumed.zone, resumed.hop, resumed.score, resumed.lives, resumed.bits, resumed.best]).toEqual([
      original.zone,
      original.hop,
      original.score,
      original.lives,
      original.bits,
      original.best,
    ]);
    expect(resumed.body.x).toBe(original.body.x);
    expect(resumed.keysGot).toEqual(original.keysGot);
    expect(Array.from(resumed.grid.tiles)).toEqual(Array.from(original.grid.tiles));
    // Every hop before this one counts as cleared; this one is open, the next not yet.
    for (let n = 1; n < hopNumber(2, 3); n += 1) expect(resumed.world.get(Math.ceil(n / 4), ((n - 1) % 4) + 1).cleared).toBe(true);
    expect(resumed.world.open(2, 3)).toBe(true);
    expect(resumed.world.open(2, 4)).toBe(false);
  });

  it('rejects anything that is not a save', () => {
    expect(isSaved(null)).toBe(false);
    expect(isSaved({ v: 1 })).toBe(false);
    expect(isSaved(upgrade({ v: 1 }))).toBe(false);
    expect(isSaved('save')).toBe(false);
  });
});
