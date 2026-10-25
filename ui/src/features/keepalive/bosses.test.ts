import { describe, expect, it } from 'vitest';

import { DOG, JIT, OOM, spoofCopy } from './bosses';
import { PART as BUFFER } from './chapters/buffer';
import { PART as CRONTAB } from './chapters/crontab';
import { PART as LOOPBACK } from './chapters/loopback';
import { PART as NULL } from './chapters/null';
import { PART as PORTS } from './chapters/ports';
import { PART as STACKS } from './chapters/stacks';
import { emptyFrame, type Frame } from './input';
import { EV, K } from './kinds';
import { type Ent, World } from './sim';
import { type Companion, T, TILE } from './world';

const AREAS = [LOOPBACK, CRONTAB, STACKS, BUFFER, PORTS, NULL].flatMap((part) => part.areas);

/** A world in a boss's arena, the fight on, with these companions (the first in front). */
function arena(id: string, party: Companion[]): { w: World; boss: Ent } {
  const w = new World(AREAS, 'gran');
  w.story.flags.add('can.freeze');
  w.story.party.push(...party);
  w.enter(id, id === 'c5-core' ? 's' : id === 'c1-core' ? 'w' : id === 'c3-maw' || id === 'c4-gallery' ? 'e' : 's', 0, true);
  w.want = '';
  const boss = w.ents.find((e) => e.k === K.BOSS);
  if (!boss) throw new Error(`No boss in ${id}.`);
  boss.state = 1;
  w.invuln = 1_000_000;
  return { w, boss };
}

function step(w: World, drive: (f: Frame) => void = () => {}, ticks = 1): number[] {
  const seen: number[] = [];
  for (let t = 0; t < ticks; t += 1) {
    const f = emptyFrame();
    drive(f);
    w.step(f);
    for (let i = 0; i < w.events.count; i += 1) seen.push(w.events.data[i * 4] ?? 0);
  }
  return seen;
}

const press = (button: 'a' | 'b') => (f: Frame) => {
  f.pressed[button] = true;
};

/** Puts Echo at a point, facing a way. */
function stand(w: World, x: number, y: number, facing: number): void {
  w.x = x;
  w.y = y;
  w.facing = facing;
  w.lineUp();
}

describe('Spinlock', () => {
  it('throws pings off while it spins, and takes them while time stands still', () => {
    const { w, boss } = arena('c1-core', ['cron']);
    stand(w, boss.x, boss.y + 30, 0);
    expect(step(w, press('b'))).toContain(EV.BUMP);
    expect(boss.hp).toBe(3);
    w.pingCool = 0;
    step(w, press('a'));
    expect(w.freeze).toBeGreaterThan(0);
    w.pingCool = 0;
    step(w, press('b'));
    expect(boss.hp).toBe(2);
  });

  it('is beaten in three hits, and plays its scene', () => {
    const { w, boss } = arena('c1-core', ['cron']);
    for (let hit = 0; hit < 3; hit += 1) {
      stand(w, boss.x, boss.y + 30, 0);
      w.freeze = 100;
      w.pingCool = 0;
      boss.b = 0;
      step(w, press('b'));
    }
    expect(w.story.has('beat.spinlock')).toBe(true);
    expect(w.want).toBe('spinlock.down');
  });
});

describe('the OOM Killer', () => {
  it('dashes, is stunned by a heavy block in its way, and only then takes a shove', () => {
    const { w, boss } = arena('c2-arena', ['sudo', 'cron']);
    // A block well down the heap, with room above it for the Killer.
    const block = w.ents.filter((e) => e.k === K.BLOCK && e.a === 1).sort((a, b) => b.y - a.y)[0];
    if (!block) throw new Error('No block.');
    // Echo behind a block, the Killer on the far side, lined up.
    const bx = block.x + 8;
    const by = block.y + 8;
    boss.x = bx;
    boss.y = by - 48;
    stand(w, bx, by + 22, 0);
    // A shove while it isn't stunned does nothing.
    boss.c = OOM.STALK;
    boss.t = 1;
    for (let t = 0; t < 200 && boss.c !== OOM.STUNNED; t += 1) step(w);
    expect(boss.c).toBe(OOM.STUNNED);
    stand(w, boss.x, boss.y + 18, 0);
    const before = boss.hp;
    w.forceCool = 0;
    step(w, press('a'));
    expect(boss.hp).toBe(before - 1);
  });
});

describe('Jitter', () => {
  it('surfaces out of reach of the shore, and takes a ping from someone floated out to it', () => {
    const { w, boss } = arena('c3-maw', ['float', 'cron']);
    // Wait for it to come up.
    for (let t = 0; t < 400 && boss.c !== JIT.UP; t += 1) step(w);
    expect(boss.c).toBe(JIT.UP);
    // Floated out over the void beside it, Echo pings.
    w.hover = 60;
    stand(w, boss.x + 24, boss.y + 4, 3);
    w.pingCool = 0;
    step(w, press('b'));
    expect(boss.hp).toBe(2);
    expect(boss.c).toBe(JIT.DIVING);
  });

  it('stays up while time is held still', () => {
    const { w, boss } = arena('c3-maw', ['cron', 'float']);
    for (let t = 0; t < 400 && boss.c !== JIT.UP; t += 1) step(w);
    w.freeze = 240;
    const left = boss.t;
    step(w, () => {}, 120);
    expect(boss.c).toBe(JIT.UP);
    expect(boss.t).toBe(left);
  });
});

describe('the Spoofer', () => {
  it('shows its real self to a ping, and only the real one takes a shove', () => {
    const { w, boss } = arena('c4-gallery', ['sudo', 'tel']);
    const real = { x: 0, y: 0 };
    spoofCopy(boss, boss.c, real);
    // A shove at a fake: no hit.
    const fake = { x: 0, y: 0 };
    spoofCopy(boss, (boss.c + 1) % 4, fake);
    stand(w, fake.x, fake.y + 20, 0);
    w.forceCool = 0;
    w.freeze = 240;
    step(w, press('a'));
    expect(boss.hp).toBe(3);
    // A ping beside the real one shows it, and holds it still.
    stand(w, real.x, real.y + 20, 0);
    w.pingCool = 0;
    step(w, press('b'));
    expect(boss.dir).toBeGreaterThan(0);
    spoofCopy(boss, boss.c, real);
    stand(w, real.x, real.y + 20, 0);
    w.forceCool = 0;
    step(w, press('a'));
    expect(boss.hp).toBe(2);
  });
});

describe('the Watchdog', () => {
  it('drops its floor when its shield is broken, and listens once its three clocks are reset', () => {
    const { w, boss } = arena('c5-core', ['sudo', 'cron', 'float', 'tel']);
    expect(boss.c).toBe(DOG.SHIELD);
    // Break every cracked tile of the shield.
    for (let i = 0; i < w.tiles.length; i += 1) if (w.tiles[i] === T.CRACKED) w.breakWall(i);
    step(w);
    expect(boss.c).toBe(DOG.FLOOR);
    expect(w.story.has('wd.drop')).toBe(true);
    expect(w.want).toBe('watchdog.drop');
    w.want = '';
    // The middle floor is gone.
    const mid = w.tileIndex(10 * TILE + 8, 8 * TILE + 8);
    expect(w.floorAt(mid)).toBe(false);
    // Reset the clocks, each from beside it.
    for (let i = 0; i < w.tiles.length; i += 1) {
      if (w.tiles[i] !== T.NODE) continue;
      stand(w, (i % w.area.w) * TILE + 8 + 18, Math.floor(i / w.area.w) * TILE + 12, 3);
      w.hover = 60;
      w.pingCool = 0;
      step(w, press('b'));
    }
    step(w);
    expect(boss.c).toBe(DOG.LISTENING);
    expect(w.want).toBe('watchdog.talk');
  });

  it('remembers where the fight was, after a fall back to the start', () => {
    const { w } = arena('c5-core', ['sudo', 'cron', 'float', 'tel']);
    for (let i = 0; i < w.tiles.length; i += 1) if (w.tiles[i] === T.CRACKED) w.breakWall(i);
    step(w);
    w.sendBack();
    const boss = w.boss;
    expect(boss?.c).toBe(DOG.FLOOR);
  });
});
