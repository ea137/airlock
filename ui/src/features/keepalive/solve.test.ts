import { describe, expect, it } from 'vitest';

import { HOVER_TILES, Solver } from './solve';
import { Story } from './story';
import { type Ability, type AreaSpec, door, ghost, node, parse, plate, sentry, terminal } from './world';

/** Whether the tile marked `goal` can be reached from '@' with these abilities. */
function solvable(map: string, key: AreaSpec['key'], abilities: Ability[], fx: Record<string, { sig: number; flip: number }> = {}): boolean {
  const area = parse({ id: 't', name: 't', chapter: 1, map, key: { G: [{ t: 'mark', on: 0 }], ...key } });
  const solver = new Solver({
    area,
    abilities: new Set<Ability>(['ping', ...abilities]),
    story: new Story(),
    terminal: (scene) => fx[scene] ?? { sig: 0, flip: 0 },
  });
  const start = area.marks.get('@') ?? 0;
  const goal = area.marks.get('G') ?? -1;
  return solver.explore([start]).has(goal);
}

describe('the puzzle solver', () => {
  it('pushes a block onto a plate to open a door', () => {
    const map = `
#########
#@.o..p.#
####d####
####G####
#########`;
    expect(solvable(map, { p: plate('a'), d: door('a') }, [])).toBe(true);
  });

  it('knows a block in a corner is stuck', () => {
    const map = `
#########
#o@...p.#
####d####
####G####
#########`;
    expect(solvable(map, { p: plate('a'), d: door('a') }, [])).toBe(false);
  });

  it('needs Sudo for heavy blocks and cracked walls', () => {
    const heavy = `
########
#@.O.p.#
###d####
###G####
########`;
    expect(solvable(heavy, { p: plate('a'), d: door('a') }, [])).toBe(false);
    expect(solvable(heavy, { p: plate('a'), d: door('a') }, ['force'])).toBe(true);
    const wall = `
######
#@.%G#
######`;
    expect(solvable(wall, {}, [])).toBe(false);
    expect(solvable(wall, {}, ['force'])).toBe(true);
  });

  it('hovers over as much void as Float can carry, and no more', () => {
    const gap = (n: number) => `
${'#'.repeat(n + 5)}
#@.${' '.repeat(n)}G#
${'#'.repeat(n + 5)}`;
    expect(solvable(gap(HOVER_TILES), {}, ['hover'])).toBe(true);
    expect(solvable(gap(HOVER_TILES + 2), {}, ['hover'])).toBe(false);
    expect(solvable(gap(1), {}, [])).toBe(false);
  });

  it('fills a pit with a block', () => {
    const map = `
#######
#@.o G#
#######`;
    expect(solvable(map, {}, [])).toBe(true);
  });

  it('lets Tel flip signals at terminals', () => {
    const map = `
########
##T#####
#@...dG#
########`;
    expect(solvable(map, { T: terminal('t1'), d: door('a') }, [])).toBe(false);
    expect(solvable(map, { T: terminal('t1'), d: door('a') }, ['talk'], { t1: { sig: 0, flip: 1 } })).toBe(true);
  });

  it('crosses a long ghost bridge only with time frozen', () => {
    const map = `
################
#####n##########
#@...~~~~~~~~~G#
################`;
    const key = { n: node('a', 60), '~': ghost('a') };
    expect(solvable(map, key, [])).toBe(false);
    expect(solvable(map, key, ['freeze'])).toBe(true);
  });

  it('gets past a sentry that never looks away only with time frozen', () => {
    const map = `
#######
#@...G#
###s###
#######`;
    const key = { s: sentry(0, 0, 3) };
    // The sentry looks up the corridor at the tile you must pass.
    expect(solvable(map, key, [])).toBe(false);
    expect(solvable(map, key, ['freeze'])).toBe(true);
  });
});
