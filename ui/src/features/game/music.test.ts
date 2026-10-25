import { describe, expect, it } from 'vitest';

import { advance, BASS, compose, DRUMS, type Cursor, HARMONY, jingle, LEAD, STEPS_PER_BAR, stepSeconds } from './music';
import { zoneFor } from './zones';

const count = (notes: Uint8Array | undefined, from = 0, to = notes?.length ?? 0) => {
  let n = 0;
  for (let i = from; i < to; i += 1) if ((notes?.[i] ?? 0) > 0) n += 1;
  return n;
};

describe('compose', () => {
  it('writes the same song for the same zone', () => {
    const song = zoneFor(1, 3).song;
    const a = compose(song);
    const b = compose(song);
    expect(Array.from(a.note[LEAD] ?? [])).toEqual(Array.from(b.note[LEAD] ?? []));
  });

  it('gives each of the first ten zones its own tune', () => {
    const tunes = new Set<string>();
    for (let zone = 1; zone <= 10; zone += 1) tunes.add(Array.from(compose(zoneFor(1, zone).song).note[LEAD] ?? []).join(','));
    expect(tunes.size).toBe(10);
  });

  it('has an intro of drums and bass, then the tune, a second voice, and a middle that differs', () => {
    const score = compose(zoneFor(1, 2).song);
    const bar = (n: number) => [n * STEPS_PER_BAR, (n + 1) * STEPS_PER_BAR] as const;
    expect(count(score.note[LEAD], ...bar(0))).toBe(0);
    expect(count(score.note[BASS], ...bar(0))).toBeGreaterThan(0);
    expect(count(score.note[DRUMS], ...bar(0))).toBeGreaterThan(0);
    expect(count(score.note[LEAD], ...bar(2))).toBeGreaterThan(2);
    // A' (bars 10-17) has the harmony voice; A (bars 2-9) doesn't.
    expect(count(score.note[HARMONY], 2 * STEPS_PER_BAR, 10 * STEPS_PER_BAR)).toBe(0);
    expect(count(score.note[HARMONY], 10 * STEPS_PER_BAR, 18 * STEPS_PER_BAR)).toBeGreaterThan(10);
    const a = Array.from(score.note[LEAD]?.slice(2 * STEPS_PER_BAR, 4 * STEPS_PER_BAR) ?? []);
    const b = Array.from(score.note[LEAD]?.slice(18 * STEPS_PER_BAR, 20 * STEPS_PER_BAR) ?? []);
    expect(b).not.toEqual(a);
  });

  it('plays the boss faster than the zone', () => {
    const song = zoneFor(1, 1).song;
    expect(compose(song, true).bpm).toBeGreaterThan(compose(song).bpm);
  });

  it('keeps every note in a sensible range', () => {
    for (let zone = 1; zone <= 30; zone += 1) {
      const score = compose(zoneFor(5, zone).song);
      for (const voice of [LEAD, HARMONY, BASS]) {
        for (const note of score.note[voice] ?? []) if (note > 0) expect(note).toBeGreaterThan(20);
        for (const note of score.note[voice] ?? []) expect(note).toBeLessThan(110);
      }
    }
  });

  it('has jingles for the moments that need one', () => {
    const song = zoneFor(1, 1).song;
    for (const kind of ['clear', 'over', 'boss', 'life', 'key'] as const) expect(jingle(kind, song).notes.length).toBeGreaterThan(4);
  });
});

describe('advance', () => {
  it('schedules every step once, in order, across many short windows, and loops after the intro', () => {
    const score = compose(zoneFor(1, 1).song);
    const cursor: Cursor = { step: 0, time: 1 };
    const steps: number[] = [];
    const times: number[] = [];
    let now = 1;
    for (let frame = 0; frame < 3000; frame += 1) {
      now += 1 / 60;
      advance(score, cursor, now + 0.15, 1, (step, time) => {
        steps.push(step);
        times.push(time);
      });
    }
    // In order, with no step twice before the loop.
    for (let i = 1; i < steps.length; i += 1) {
      const previous = steps[i - 1] ?? 0;
      const step = steps[i] ?? 0;
      expect(step === previous + 1 || (previous === score.length - 1 && step === score.loopFrom)).toBe(true);
      expect((times[i] ?? 0) - (times[i - 1] ?? 0)).toBeCloseTo(stepSeconds(score.bpm), 6);
    }
    expect(steps).toContain(score.loopFrom);
    // Never more than the lookahead ahead of now.
    expect((times[times.length - 1] ?? 0) - now).toBeLessThan(0.16);
  });

  it('plays faster when sped up', () => {
    const score = compose(zoneFor(1, 1).song);
    const normal: Cursor = { step: 0, time: 0 };
    const rushed: Cursor = { step: 0, time: 0 };
    advance(score, normal, 4, 1, () => {});
    advance(score, rushed, 4, 1.25, () => {});
    expect(rushed.step).toBeGreaterThan(normal.step);
  });
});
