import { describe, expect, it } from 'vitest';

import { levelFor } from './generator';
import { checkRoom, type Size } from './validate';
import { HOPS_PER_ZONE } from './zones';

// Whole generated levels, stitched: the flag can be reached and nobody gets
// stuck. Every chunk is also checked on its own, both sizes and both ways
// round (chunks.test.ts); here the small packet checks the stitching in
// every hop and the big one in a sample.

function check(seed: number, zone: number, hop: number, size: Size): void {
  const level = levelFor(seed, zone, hop);
  for (let room = 0; room < level.rooms.length; room += 1) {
    const report = checkRoom(level, room, size);
    const where = `seed ${seed} zone ${zone} hop ${hop} room ${room} ${size} [${level.chunks.join(' ')}]`;
    expect(report.reached, `${where}: the flag can't be reached`).toBe(true);
    expect(report.stuck, `${where}: stuck spots`).toEqual([]);
  }
}

describe('keys', () => {
  it('can nearly all be reached (hidden blocks count once found)', { timeout: 120_000 }, () => {
    let reached = 0;
    let total = 0;
    for (const zone of [1, 2, 3, 5, 8]) {
      for (let hop = 1; hop <= 3; hop += 1) {
        const report = checkRoom(levelFor(31, zone, hop), 0, 'small', { hiddenSolid: true });
        reached += report.keysReached;
        total += report.keysTotal;
      }
    }
    expect(total).toBeGreaterThan(30);
    expect(reached / total).toBeGreaterThan(0.85);
  });
});

describe('generated levels can be finished', () => {
  for (const zone of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 14, 23]) {
    it(`zone ${zone}`, { timeout: 120_000 }, () => {
      for (let hop = 1; hop <= HOPS_PER_ZONE; hop += 1) check(2026, zone, hop, 'small');
      check(2026, zone, 1 + (zone % HOPS_PER_ZONE), 'big');
    });
  }
});
