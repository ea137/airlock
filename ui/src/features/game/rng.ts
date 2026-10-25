// Seeded random numbers. The same seed always gives the same level, so a
// save only needs the seed, the zone and the hop to rebuild one.

/** Mixes whole numbers into one 32-bit hash. */
export function hash(...parts: number[]): number {
  let h = 0x811c9dc5;
  for (const part of parts) {
    h ^= part | 0;
    h = Math.imul(h, 0x01000193);
    h ^= h >>> 13;
    h = Math.imul(h, 0x5bd1e995);
    h ^= h >>> 15;
  }
  return h >>> 0;
}

/** A small, fast generator (mulberry32) whose whole state is one number, so it saves. */
export class Rng {
  state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  /** A number in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** A whole number in [0, n). */
  int(n: number): number {
    return Math.floor(this.next() * n);
  }

  /** A whole number in [low, high]. */
  range(low: number, high: number): number {
    return low + this.int(high - low + 1);
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(list: readonly T[]): T {
    const item = list[this.int(list.length)];
    if (item === undefined) throw new Error('Rng.pick: the list is empty.');
    return item;
  }

  /** Picks by weight; weights of zero are never picked. */
  weighted<T>(list: readonly T[], weight: (item: T) => number): T {
    let total = 0;
    for (const item of list) total += Math.max(0, weight(item));
    let roll = this.next() * total;
    for (const item of list) {
      roll -= Math.max(0, weight(item));
      if (roll < 0) return item;
    }
    return this.pick(list);
  }

  /** Shuffles a copy of the list. */
  shuffle<T>(list: readonly T[]): T[] {
    const copy = list.slice();
    for (let i = copy.length - 1; i > 0; i -= 1) {
      const j = this.int(i + 1);
      const a = copy[i] as T;
      copy[i] = copy[j] as T;
      copy[j] = a;
    }
    return copy;
  }
}
