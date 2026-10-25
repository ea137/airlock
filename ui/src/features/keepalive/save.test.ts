import { beforeEach, describe, expect, it } from 'vitest';

import { PART as BUFFER } from './chapters/buffer';
import { PART as CRONTAB } from './chapters/crontab';
import { PART as LOOPBACK } from './chapters/loopback';
import { PART as NULL } from './chapters/null';
import { PART as PORTS } from './chapters/ports';
import { PART as STACKS } from './chapters/stacks';
import { emptyFrame } from './input';
import { K } from './kinds';
import { worldMap } from './map';
import { clearSave, isSaved, readSave, restore, snapshot, writeSave } from './save';
import { ENT_FIELDS, World } from './sim';

const AREAS = [LOOPBACK, CRONTAB, STACKS, BUFFER, PORTS, NULL].flatMap((part) => part.areas);

/** A world part-way through the Crontab, with things moved, lit and broken. */
function played(): World {
  const w = new World(AREAS, 'gran');
  w.newGame('gran', '@');
  w.story.flags.add('p.woke');
  w.story.flags.add('loop.lit');
  w.story.party.push('cron', 'sudo');
  w.story.flags.add('can.freeze');
  w.story.trust.cron = 6;
  w.enter('loopback', 'x', 2, false);
  w.enter('c1-gate', 'x', 1, false);
  w.enter('c1-escape', 'w', 1, true);
  w.want = '';
  // Walk in, push about, ping.
  for (let t = 0; t < 120; t += 1) {
    const f = emptyFrame();
    f.dir = t < 60 ? 1 : 0;
    f.pressed.b = t === 70;
    w.step(f);
  }
  w.remember('c1-gears').broken.push(7 * 24 + 2);
  return w;
}

class Storage {
  private readonly items = new Map<string, string>();
  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.items.set(key, value);
  }
  removeItem(key: string): void {
    this.items.delete(key);
  }
}

beforeEach(() => {
  (globalThis as unknown as { localStorage: Storage }).localStorage = new Storage();
});

describe('saving', () => {
  it('puts back exactly what was saved', () => {
    const w = played();
    const saved = JSON.parse(JSON.stringify(snapshot(w, ['c1.escape', 3], [['cron', 'Hello.']], 123))) as unknown;
    expect(isSaved(saved)).toBe(true);
    if (!isSaved(saved)) return;
    const back = new World(AREAS, 'gran');
    expect(restore(back, saved)).toBe(true);
    expect(back.area.id).toBe(w.area.id);
    expect([back.x, back.y, back.facing, back.hp, back.maxHp]).toEqual([w.x, w.y, w.facing, w.hp, w.maxHp]);
    expect([back.tick, back.clock, back.freeze, back.pingCool]).toEqual([w.tick, w.clock, w.freeze, w.pingCool]);
    expect([...back.story.flags].sort()).toEqual([...w.story.flags].sort());
    expect(back.story.trust).toEqual(w.story.trust);
    expect(back.story.party).toEqual(w.story.party);
    expect(Array.from(back.tiles)).toEqual(Array.from(w.tiles));
    expect(Array.from(back.lit)).toEqual(Array.from(w.lit));
    expect(Array.from(back.trail)).toEqual(Array.from(w.trail));
    expect(back.memory.get('c1-gears')?.broken).toEqual([7 * 24 + 2]);
    const live = (world: World) => world.ents.filter((e) => e.k !== K.NONE).map((e) => ENT_FIELDS.map((f) => e[f]));
    expect(live(back)).toEqual(live(w));
    expect(saved.talk).toEqual(['c1.escape', 3]);
    expect(saved.log).toEqual([['cron', 'Hello.']]);
  });

  it('carries on the same afterwards, tick for tick', () => {
    const w = played();
    const saved = JSON.parse(JSON.stringify(snapshot(w, null, [], 0))) as unknown;
    if (!isSaved(saved)) throw new Error('Not a save.');
    const back = new World(AREAS, 'gran');
    restore(back, saved);
    for (let t = 0; t < 90; t += 1) {
      const f = emptyFrame();
      f.dir = t % 30 < 15 ? 2 : 1;
      w.step(f);
      back.step(f);
    }
    expect([back.x, back.y, back.hp]).toEqual([w.x, w.y, w.hp]);
  });

  it('keeps the world map as it was: places been, secrets found', () => {
    const w = played();
    w.story.flags.add('log.2');
    const before = worldMap(AREAS, w.story, w.area.id);
    const saved = JSON.parse(JSON.stringify(snapshot(w, null, [], 0))) as unknown;
    if (!isSaved(saved)) throw new Error('Not a save.');
    const back = new World(AREAS, 'gran');
    restore(back, saved);
    expect(worldMap(AREAS, back.story, back.area.id)).toEqual(before);
    expect(before.nodes.filter((n) => n.visited).map((n) => n.id)).toEqual(expect.arrayContaining(['loopback', 'c1-gate', 'c1-escape']));
  });

  it('writes to and reads from this browser, and forgets on a new game', () => {
    const w = played();
    writeSave(snapshot(w, null, [], 5));
    expect(readSave()?.area).toBe('c1-escape');
    clearSave();
    expect(readSave()).toBeNull();
  });

  it('ignores what isn’t a save, and a save of an area that no longer exists', () => {
    expect(isSaved(null)).toBe(false);
    expect(isSaved({ v: 1 })).toBe(false);
    const saved = snapshot(played(), null, [], 0);
    expect(isSaved({ ...saved, echo: [1, 2] })).toBe(false);
    expect(isSaved({ ...saved, party: ['nobody'] })).toBe(false);
    expect(restore(new World(AREAS, 'gran'), { ...saved, area: 'gone' })).toBe(false);
    localStorage.setItem('airlock.keepalive', '{not json');
    expect(readSave()).toBeNull();
  });
});
