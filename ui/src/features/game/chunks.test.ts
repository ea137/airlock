import { describe, expect, it } from 'vitest';

import { ARENAS, BONUS_ROOMS, CHUNKS, type ChunkDef, CLIMBS } from './chunks';
import { chunkLevel } from './generator';
import { CHAR_TILE, F, FLAGS } from './tiles';
import { checkRoom, type Size } from './validate';

const SIZES: Size[] = ['small', 'big'];
const ALL = [...CHUNKS, ...CLIMBS, ...BONUS_ROOMS, ...ARENAS];

const solid = (ch: string | undefined) => ((FLAGS[CHAR_TILE[ch ?? '.'] ?? 0] ?? 0) & F.SOLID) !== 0;

function pads(def: ChunkDef): string[] {
  const problems: string[] = [];
  const bottom = def.rows.length - 1;
  for (const column of [0, 1, def.w - 2, def.w - 1]) {
    if (!solid(def.rows[bottom]?.[column])) problems.push(`column ${column} has no ground`);
  }
  return problems;
}

describe('the chunk library', () => {
  it('is large, with unique names', () => {
    expect(ALL.length).toBeGreaterThanOrEqual(80);
    expect(new Set(ALL.map((chunk) => chunk.id)).size).toBe(ALL.length);
  });

  it('starts and ends every run chunk on ground, so any two fit together', () => {
    for (const def of CHUNKS) expect(pads(def), def.id).toEqual([]);
  });

  it('keeps run chunks low enough to stay on screen', () => {
    for (const def of [...CHUNKS, ...ARENAS]) expect(def.rows.length, def.id).toBeLessThanOrEqual(13);
  });

  it('makes climbs as wide as a climb', () => {
    for (const def of CLIMBS) expect(def.w, def.id).toBe(20);
  });
});

describe('every chunk can be crossed, both ways round, small and big', () => {
  for (const def of ALL) {
    it(def.id, { timeout: 60_000 }, () => {
      const oneWay = ['start', 'goal', 'arena', 'bonus', 'nomirror'].some((tag) => def.tags.includes(tag));
      for (const flip of oneWay ? [false] : [false, true]) {
        for (const size of SIZES) {
          const level = chunkLevel(def, flip, def.tags.includes('water') ? 8 : 1);
          const report = checkRoom(level, 0, size);
          const where = `${def.id}${flip ? ' (mirrored)' : ''}, ${size}`;
          expect(report.reached, `${where}: the flag can't be reached`).toBe(true);
          expect(report.stuck, `${where}: stuck spots`).toEqual([]);
        }
      }
    });
  }
});
