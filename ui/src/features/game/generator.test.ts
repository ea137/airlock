import { describe, expect, it } from 'vitest';

import { levelFor } from './generator';
import { HOPS_PER_ZONE, zoneFor } from './zones';

describe('levelFor', () => {
  it('builds the same level from the same seed, zone and hop', () => {
    const a = levelFor(1234, 3, 2);
    const b = levelFor(1234, 3, 2);
    expect(a.chunks).toEqual(b.chunks);
    expect(Array.from(a.rooms[0]?.tiles ?? [])).toEqual(Array.from(b.rooms[0]?.tiles ?? []));
    expect(a.rooms[0]?.spawns).toEqual(b.rooms[0]?.spawns);
  });

  it('builds different levels from different seeds', () => {
    expect(levelFor(1, 2, 1).chunks).not.toEqual(levelFor(2, 2, 1).chunks);
  });

  it('never repeats a chunk within a level, and mostly avoids the zone’s earlier hops', () => {
    for (let zone = 1; zone <= 12; zone += 1) {
      const seen = new Set<string>();
      let repeats = 0;
      let total = 0;
      for (let hop = 1; hop <= HOPS_PER_ZONE; hop += 1) {
        const ids = levelFor(77, zone, hop).chunks;
        expect(new Set(ids).size, `zone ${zone} hop ${hop}: ${ids.join(' ')}`).toBe(ids.length);
        for (const id of ids) {
          if (id.startsWith('start') || id.startsWith('goal') || id.startsWith('check') || id.startsWith('arena')) continue;
          total += 1;
          if (seen.has(id)) repeats += 1;
          seen.add(id);
        }
      }
      expect(repeats / total, `zone ${zone}: ${repeats} of ${total} chunks repeat`).toBeLessThan(0.25);
    }
  });

  it('places three keys in every level', () => {
    for (let zone = 1; zone <= 12; zone += 1) {
      for (let hop = 1; hop <= HOPS_PER_ZONE; hop += 1) {
        const level = levelFor(5, zone, hop);
        expect(level.keys, `zone ${zone} hop ${hop} [${level.chunks.join(' ')}]`).toBe(3);
      }
    }
  });

  it('ends every fourth hop with a boss', () => {
    for (let zone = 1; zone <= 15; zone += 1) {
      const core = levelFor(9, zone, 4);
      expect(core.kind).toBe('core');
      expect(core.boss).not.toBeNull();
    }
  });
});

describe('zones', () => {
  it('never gives a generated zone the twists of the one before it', () => {
    for (const seed of [1, 99, 4242]) {
      for (let index = 11; index <= 60; index += 1) {
        const now = zoneFor(seed, index).twists;
        const before = zoneFor(seed, index - 1).twists;
        expect(
          now.filter((twist) => before.includes(twist)),
          `seed ${seed} zone ${index}`,
        ).toEqual([]);
      }
    }
  });

  it('changes the boss, the backdrop or the song from one zone to the next', () => {
    for (let index = 2; index <= 40; index += 1) {
      const now = zoneFor(3, index);
      const before = zoneFor(3, index - 1);
      expect(now.boss !== before.boss || now.backdrop !== before.backdrop).toBe(true);
      expect(now.song).not.toEqual(before.song);
    }
  });

  it('fits every zone’s name and twists on its 160-pixel card', () => {
    for (let index = 1; index <= 80; index += 1) {
      const zone = zoneFor(11, index);
      // The name is drawn twice the size: 8 pixels a letter.
      expect(zone.name.length * 8, zone.name).toBeLessThanOrEqual(152);
      for (const line of zone.hint.split(' + ')) expect(line.length * 4, line).toBeLessThanOrEqual(152);
    }
  });

  it('names every zone and gives it a song', () => {
    for (let index = 1; index <= 40; index += 1) {
      const zone = zoneFor(7, index);
      expect(zone.name.length).toBeGreaterThan(1);
      expect(zone.song.bpm).toBeGreaterThan(100);
    }
  });
});
