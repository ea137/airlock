import { describe, expect, it } from 'vitest';

import { BY_BACKDOOR, BY_BOSS, BY_FLAG, clock, nodeSpot, PANEL_Y, World, WorldMap } from './world';

const STILL = { left: false, right: false };

/** Ticks the map until the packet has landed. */
function land(map: WorldMap, held = STILL): void {
  for (let i = 0; i < 120 && map.flying; i += 1) map.tick(held, 160);
}

describe('what a clear opens', () => {
  it('a new game has only its first hop open', () => {
    const world = new World();
    expect(world.open(1, 1)).toBe(true);
    expect(world.open(1, 2)).toBe(false);
    expect(world.open(2, 1)).toBe(false);
    expect(world.reach()).toBe(1);
  });

  it('a flag opens the next hop, and the core opens the next zone', () => {
    const world = new World();
    expect(world.clear(1, 1, BY_FLAG, [], 600)).toEqual([{ zone: 1, hop: 2 }]);
    expect(world.open(1, 2)).toBe(true);
    expect(world.open(1, 3)).toBe(false);
    world.clear(1, 2, BY_FLAG, [], 600);
    world.clear(1, 3, BY_FLAG, [], 600);
    expect(world.open(2, 1)).toBe(false);
    expect(world.clear(1, 4, BY_BOSS, [], 600)).toEqual([{ zone: 2, hop: 1 }]);
    expect(world.open(2, 1)).toBe(true);
    expect(world.reach()).toBe(2);
    // Cleared again, nothing new opens.
    expect(world.clear(1, 1, BY_FLAG, [], 600)).toEqual([]);
  });

  it("a backdoor opens the next zone, but not the rest of its own", () => {
    const world = World.upTo(3, 2);
    expect(world.clear(3, 2, BY_BACKDOOR, [], 900)).toEqual([{ zone: 4, hop: 1 }]);
    expect(world.open(4, 1)).toBe(true);
    expect(world.open(3, 3)).toBe(false);
    expect(world.get(3, 2)).toMatchObject({ backdoor: true, secret: true, cleared: false });
    // Its flag later opens the way on through the zone as well.
    world.clear(3, 2, BY_FLAG, [], 900);
    expect(world.open(3, 3)).toBe(true);
  });

  it('keeps the keys of every clear and the fastest time', () => {
    const world = new World();
    world.clear(1, 1, BY_FLAG, [11, 12], 900);
    world.clear(1, 1, BY_FLAG, [12, 13], 1200);
    world.clear(1, 1, BY_FLAG, [], 700);
    expect(world.get(1, 1)).toMatchObject({ keys: [11, 12, 13], time: 700 });
    expect(world.keys()).toBe(3);
    expect(clock(700)).toBe('0:11.6');
    expect(clock(60 * 83 + 30)).toBe('1:23.5');
  });

  it('remembers a backdoor once its hop has been visited', () => {
    const world = new World();
    world.visit(1, 1, false);
    world.visit(1, 2, true);
    expect(world.get(1, 1).secret).toBe(false);
    expect(world.get(1, 2).secret).toBe(true);
  });

  it('survives a save, and refuses anything that is not one', () => {
    const world = new World();
    world.clear(1, 1, BY_FLAG, [5], 640);
    const back = World.from(JSON.parse(JSON.stringify(world.save())));
    expect(back?.get(1, 1)).toEqual(world.get(1, 1));
    expect(back?.open(1, 2)).toBe(true);
    expect(World.from([{ cleared: 'yes' }])).toBeNull();
    expect(World.from(null)).toBeNull();
  });

  it('a game from before the map has every hop before its own cleared', () => {
    const world = World.upTo(2, 3);
    expect(world.open(2, 3)).toBe(true);
    expect(world.get(2, 2).cleared).toBe(true);
    expect(world.get(1, 4).cleared).toBe(true);
    expect(world.open(2, 4)).toBe(false);
  });
});

describe('the map', () => {
  it('shows the zones reached and the next one, shut', () => {
    const world = World.upTo(2, 2);
    const map = new WorldMap(world, 1, { zone: 2, hop: 2 });
    expect(map.zones.map((zone) => [zone.index, zone.open])).toEqual([
      [1, true],
      [2, true],
      [3, false],
    ]);
    expect(map.nodes).toHaveLength(12);
    expect(map.picked).toMatchObject({ zone: 2, hop: 2, open: true });
  });

  it('walks hop by hop and zone by zone, and plays only an open hop', () => {
    const map = new WorldMap(World.upTo(1, 3), 1, { zone: 1, hop: 3 });
    expect(map.press('left')).toBe('moved');
    land(map);
    expect(map.picked).toMatchObject({ zone: 1, hop: 2 });
    expect(map.press('a')).toEqual({ zone: 1, hop: 2 });
    map.press('right');
    map.press('right');
    land(map);
    expect(map.picked).toMatchObject({ zone: 1, hop: 4, open: false });
    expect(map.press('a')).toBe('locked');
    expect(map.press('down')).toBe('moved');
    land(map);
    expect(map.picked).toMatchObject({ zone: 2, hop: 1 });
    // The last zone shown is as far as it goes.
    expect(map.press('down')).toBe(null);
    map.press('up');
    land(map);
    expect(map.picked).toMatchObject({ zone: 1, hop: 1 });
    expect(map.press('left')).toBe(null);
    expect(map.press('b')).toBe('back');
  });

  it('keeps walking while a direction is held, to the end of the map', () => {
    const map = new WorldMap(World.upTo(2, 1), 1, { zone: 1, hop: 1 });
    map.tick(STILL, 160);
    for (let i = 0; i < 400; i += 1) map.tick({ left: false, right: true }, 160);
    expect(map.picked).toMatchObject({ zone: 3, hop: 4 });
    expect(map.camX).toBe(map.width - 160);
  });

  it('a tap picks a hop, and a tap on the picked one plays it', () => {
    const map = new WorldMap(World.upTo(1, 3), 1, { zone: 1, hop: 1 });
    map.tick(STILL, 160);
    const spot = nodeSpot(1, 2);
    expect(map.tap(spot.x - map.camX + 3, spot.y - 2)).toBe('moved');
    expect(map.picked).toMatchObject({ zone: 1, hop: 2 });
    land(map);
    expect(map.tap(spot.x - map.camX, spot.y)).toEqual({ zone: 1, hop: 2 });
    // Nowhere near a hop: nothing; on the panel: as A.
    expect(map.tap(spot.x - map.camX, 30)).toBe(null);
    expect(map.tap(10, PANEL_Y + 10)).toEqual({ zone: 1, hop: 2 });
  });

  it('after a clear, the packet flies to the hop it opened, and a direction held from before waits for a fresh press', () => {
    const world = new World();
    const opened = world.clear(1, 1, BY_FLAG, [], 600);
    const map = new WorldMap(world, 1, { zone: 1, hop: 2 }, opened, { zone: 1, hop: 1 });
    expect(map.picked).toMatchObject({ zone: 1, hop: 1 });
    expect(map.fresh.size).toBe(1);
    const running = { left: false, right: true };
    for (let i = 0; i < 120; i += 1) map.tick(running, 160);
    expect(map.picked).toMatchObject({ zone: 1, hop: 2 });
    // Let go, then held again: now it walks.
    map.tick(STILL, 160);
    map.tick(running, 160);
    expect(map.picked).toMatchObject({ zone: 1, hop: 3 });
  });
});
