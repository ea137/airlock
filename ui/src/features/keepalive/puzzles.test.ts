import { describe, expect, it } from 'vitest';

import { SPEAKERS } from './cast';
import { PART as BUFFER } from './chapters/buffer';
import { PART as CRONTAB } from './chapters/crontab';
import { PART as LOOPBACK } from './chapters/loopback';
import { PART as NULL } from './chapters/null';
import { PART as PORTS } from './chapters/ports';
import { PART as STACKS } from './chapters/stacks';
import { parseScript } from './script';
import { type Effects, Solver } from './solve';
import { Story } from './story';
import { type Ability, type AreaSpec, alwaysSolid, parse, T } from './world';

const PARTS = [LOOPBACK, CRONTAB, STACKS, BUFFER, PORTS, NULL];
const SPECS = new Map(PARTS.flatMap((part) => part.areas).map((spec) => [spec.id, spec]));
const SCENES = parseScript(PARTS.map((part) => part.script).join('\n'), SPEAKERS);

/** What a terminal's scene does to signals: every sig: and flip: in it. */
function terminalFx(scene: string): Effects {
  const fx: Effects = { sig: 0, flip: 0 };
  for (const node of SCENES.get(scene)?.nodes ?? []) {
    const lists = node.k === 'fx' ? [node.fx] : node.k === 'menu' ? node.options.map((o) => o.fx) : [];
    for (const list of lists) {
      for (const e of list) {
        if (e.k !== 'world') continue;
        const bit = 1 << ((e.args[0] ?? 'a').charCodeAt(0) - 97);
        if (e.verb === 'sig') fx.sig |= bit;
        if (e.verb === 'flip') fx.flip ^= bit;
      }
    }
  }
  return fx;
}

/**
 * A room: where you come in, with what, and what you must be able to reach.
 * `needs` names an ability without which at least one goal is out of reach
 * (the room teaches or tests it).
 */
type Room = { area: string; from: string; can: Ability[]; reach: string; needs?: Ability; flags?: string[] };

const C1: Ability[] = ['ping'];
const C1F: Ability[] = ['ping', 'freeze'];
const C2: Ability[] = ['ping', 'freeze', 'force'];
const C3: Ability[] = ['ping', 'freeze', 'force', 'hover'];
const C4: Ability[] = ['ping', 'freeze', 'force', 'hover', 'talk'];

export const ROOMS: Room[] = [
  { area: 'gran', from: '@', can: [], reach: 'd' },
  { area: 'loopback', from: 'G', can: C1, reach: 'ArWE', flags: [] },
  { area: 'c1-gate', from: 'w', can: C1, reach: 'te&' },
  { area: 'c1-hall', from: 'w', can: C1, reach: 'An' },
  { area: 'c1-tower', from: 's', can: C1, reach: 'SL' },
  { area: 'c1-tower', from: 's', can: C1F, reach: 'e', needs: 'freeze' },
  { area: 'c1-gears', from: 'w', can: C1F, reach: 'eF', needs: 'freeze' },
  { area: 'c1-escape', from: 'w', can: C1F, reach: 'e+' },
  { area: 'c1-core', from: 'w', can: C1F, reach: 'B' },
  { area: 'c2-gate', from: 's', can: C1F, reach: 'n' },
  { area: 'c2-gate', from: 's', can: C2, reach: 'L', needs: 'force' },
  { area: 'c2-jail', from: 's', can: C1F, reach: 'f', needs: 'freeze' },
  { area: 'c2-jail', from: 'f', can: C2, reach: 'n', needs: 'force' },
  { area: 'c2-yards', from: 's', can: C2, reach: 'nL', needs: 'force' },
  { area: 'c2-office', from: 's', can: C2, reach: 'nSw', needs: 'force' },
  { area: 'c2-arena', from: 's', can: C2, reach: 'B' },
  { area: 'c3-docks', from: 'e', can: C2, reach: 'wB' },
  { area: 'c3-drift', from: 'e', can: C2, reach: 'F' },
  { area: 'c3-drift', from: 'F', can: C3, reach: 'w', needs: 'hover' },
  { area: 'c3-reefs', from: 'e', can: C3, reach: 'wF', needs: 'hover' },
  { area: 'c3-reefs', from: 'e', can: C3, reach: 'w', needs: 'force' },
  { area: 'c3-overflow', from: 'e', can: C3, reach: 'w', needs: 'freeze' },
  { area: 'c3-overflow', from: 'e', can: C3, reach: 'w', needs: 'hover' },
  { area: 'c3-lighthouse', from: 'e', can: C3, reach: 'wL', needs: 'hover' },
  { area: 'c3-maw', from: 'e', can: C3, reach: 'B', needs: 'hover' },
  { area: 'c4-steps', from: 'n', can: C3, reach: 'w', needs: 'hover' },
  { area: 'c4-museum', from: 'e', can: C3, reach: 'Tgfp' },
  { area: 'c4-museum', from: 'e', can: C4, reach: 'wL', needs: 'talk' },
  { area: 'c4-switchboard', from: 'e', can: C4, reach: 'wF', needs: 'talk' },
  { area: 'c4-hall', from: 'e', can: C4, reach: 'wIK' },
  { area: 'c4-bridge', from: 'e', can: C4, reach: 'w', needs: 'freeze' },
  { area: 'c4-bridge', from: 'e', can: C4, reach: 'w', needs: 'hover' },
  { area: 'c4-bridge', from: 'e', can: C4, reach: 'w', needs: 'force' },
  { area: 'c4-gallery', from: 'e', can: C4, reach: 'BKa' },
  { area: 'c5-edge', from: 'x', can: C4, reach: 'w', needs: 'freeze' },
  { area: 'c5-edge', from: 'x', can: C4, reach: 'w', needs: 'hover' },
  { area: 'c5-graveyard', from: 'e', can: C4, reach: 'wHL12345678' },
  { area: 'c5-kennel', from: 'e', can: C4, reach: 'n', needs: 'force' },
  { area: 'c5-kennel', from: 'e', can: C4, reach: 'n', needs: 'hover' },
  { area: 'c5-core', from: 's', can: C4, reach: 'W', needs: 'force' },
  { area: 'c5-core', from: 's', can: C4, reach: 'W', needs: 'freeze' },
  { area: 'c5-core', from: 's', can: C4, reach: 'k', needs: 'hover', flags: ['wd.drop'] },
];

describe('every way out arrives somewhere you can stand', () => {
  for (const spec of SPECS.values()) {
    const area = parse(spec);
    for (const p of area.placed) {
      if (p.spec.t !== 'exit') continue;
      const s = p.spec;
      it(`${spec.id} ${p.ch} → ${s.to} ${s.at}`, () => {
        const target = SPECS.get(s.to);
        expect(target, `${s.to} exists`).toBeDefined();
        if (!target) return;
        const there = parse(target);
        const at = there.marks.get(s.at);
        expect(at, `${s.to} has ${s.at}`).toBeDefined();
        if (at === undefined) return;
        // You step onto a way out walking away from the floor you came from
        // (a cracked wall in the way is broken by the time you use it).
        const open = (tile: number) => tile === T.CRACKED || (!alwaysSolid(tile) && tile !== T.PIT);
        const i = p.y * area.w + p.x;
        const from = around(area.w, area.h, i).find((n) => open(area.tiles[n] ?? T.WALL));
        expect(from, `${spec.id} ${p.ch} can be walked onto`).toBeDefined();
        if (from === undefined) return;
        const dx = (i % area.w) - (from % area.w);
        const dy = Math.floor(i / area.w) - Math.floor(from / area.w);
        const land = at + dx + dy * there.w;
        expect(open(there.tiles[land] ?? T.WALL), `arriving in ${s.to} at ${land % there.w},${Math.floor(land / there.w)}`).toBe(true);
      });
    }
  }
});

/** Every tile index where a character is. */
function tilesOf(spec: AreaSpec, ch: string): number[] {
  const area = parse(spec);
  const out: number[] = [];
  area.marks.forEach(() => {});
  const lines = spec.map.split('\n').filter((line) => line.trim().length > 0);
  lines.forEach((line, y) => {
    for (let x = 0; x < line.length; x += 1) if (line[x] === ch) out.push(y * area.w + x);
  });
  return out;
}

function reachable(spec: AreaSpec, can: Ability[], from: string, flags: string[] = [], goals = ''): { area: ReturnType<typeof parse>; set: Set<number>; lit: Set<number> } {
  const area = parse(spec);
  const story = new Story();
  for (const flag of flags) story.flags.add(flag);
  const solver = new Solver({ area, abilities: new Set<Ability>(can), story, terminal: terminalFx });
  // Arriving through a way in puts you a step inside it; a mark is stood on.
  const starts = tilesOf(spec, from).flatMap((i) => [i, ...around(area.w, area.h, i)].filter((n) => !alwaysSolid(area.tiles[n] ?? 3)));
  // Showing a room can be done: the quick search, a few blocks at a time. Showing it
  // can't (without some ability): every state there is.
  const done = (set: Set<number>) => [...goals].every((ch) => reached(spec, set, ch, solver.litEver));
  const set = goals !== '' ? solver.search(starts, done) : solver.explore(starts);
  return { area, set, lit: solver.litEver };
}

/** The tiles beside one, inside the area (no wrapping round the edges). */
function around(w: number, h: number, i: number): number[] {
  const x = i % w;
  const y = Math.floor(i / w);
  const out: number[] = [];
  if (x > 0) out.push(i - 1);
  if (x < w - 1) out.push(i + 1);
  if (y > 0) out.push(i - w);
  if (y < h - 1) out.push(i + w);
  return out;
}

/** Whether a character's tile is reached: stood on, stood next to (something solid), or lit (a relay). */
function reached(spec: AreaSpec, set: Set<number>, ch: string, lit: Set<number>): boolean {
  const area = parse(spec);
  return tilesOf(spec, ch).some((i) => set.has(i) || lit.has(i) || around(area.w, area.h, i).some((n) => set.has(n)));
}

describe('every room can be done with what you have by then', () => {
  for (const room of ROOMS) {
    const spec = SPECS.get(room.area);
    it(`${room.area}, from ${room.from}, with ${room.can.join(', ') || 'nothing'}: reaches ${room.reach}`, () => {
      expect(spec).toBeDefined();
      if (!spec) return;
      const { set, lit } = reachable(spec, room.can, room.from, room.flags, room.reach);
      for (const ch of room.reach) expect(reached(spec, set, ch, lit), `${room.area}: ${ch}`).toBe(true);
      if (room.needs) {
        const without = reachable(spec, room.can.filter((a) => a !== room.needs), room.from, room.flags);
        expect(
          [...room.reach].some((ch) => !reached(spec, without.set, ch, without.lit)),
          `${room.area} can be done without ${room.needs}`,
        ).toBe(true);
      }
    }, 30_000);
  }
});
