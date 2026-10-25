// Plays the whole story at the level of what happens, not where you walk:
// at each step it finds the nearest thing left to do (a scene to watch, a
// person to talk to, something to pick up, a boss, a beacon), using the
// puzzle solver to know what's reachable in each area with the abilities
// you have then. Different players make different choices, so it plays
// with several ways of choosing, and checks every chapter is finished and
// every ending can be reached.

import { describe, expect, it } from 'vitest';

import { Rng } from '../game/rng';
import { SPEAKERS } from './cast';
import { PART as BUFFER } from './chapters/buffer';
import { PART as CRONTAB } from './chapters/crontab';
import { PART as LOOPBACK } from './chapters/loopback';
import { PART as NULL } from './chapters/null';
import { PART as PORTS } from './chapters/ports';
import { PART as STACKS } from './chapters/stacks';
import { parseScript } from './script';
import { beside, type Effects, Solver } from './solve';
import { type Effect, Story } from './story';
import { type Choice, Talk } from './talk';
import { type Ability, type Area, alwaysSolid, parse, T } from './world';

const PARTS = [LOOPBACK, CRONTAB, STACKS, BUFFER, PORTS, NULL];
const SPECS = new Map(PARTS.flatMap((part) => part.areas).map((spec) => [spec.id, spec]));
const AREAS = new Map([...SPECS].map(([id, spec]) => [id, parse(spec)]));
const SCENES = parseScript(PARTS.map((part) => part.script).join('\n'), SPEAKERS);
const TALKS = PARTS.flatMap((part) => part.talks ?? []);

/** What each boss needs, to be beaten. */
const BOSS_NEEDS: Record<string, Ability[]> = {
  spinlock: ['ping', 'freeze'],
  oom: ['force'],
  jitter: ['ping', 'hover'],
  spoofer: ['ping', 'force'],
  watchdog: ['freeze', 'force', 'hover', 'ping'],
};

/** The trust a choice gives (summed over companions). */
function warmth(choice: Choice, talk: Talk): number {
  const node = talk.scene?.nodes[talk.at];
  if (node?.k !== 'menu') return 0;
  let sum = 0;
  for (const e of node.options[choice.index]?.fx ?? []) if (e.k === 'trust') sum += e.by;
  return sum;
}

/** The flags that can change what's reachable in an area: who's standing about, and its signals. */
const REACH_FLAGS = new Map<string, string[]>(
  [...SPECS].map(([id, spec]) => {
    const texts: string[] = [];
    for (const one of Object.values(spec.key ?? {}).flat()) if (one.t === 'npc') texts.push(one.if);
    for (const options of Object.values(spec.signals ?? {})) texts.push(options.when ?? '', options.latch ?? '');
    return [id, texts.flatMap((text) => text.split(/[\s|!]+/)).filter((word) => word !== '')];
  }),
);

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

class Walker {
  readonly story = new Story();
  here = 'gran';
  readonly entries = new Map<string, Set<number>>();
  readonly queue: string[] = [];
  ending = '';
  readonly played: string[] = [];
  private choose: (scene: string, choices: Choice[], talk: Talk) => number;

  constructor(choose: (scene: string, choices: Choice[], talk: Talk) => number) {
    this.choose = choose;
    this.arrive('gran', AREAS.get('gran')?.marks.get('@') ?? 0);
  }

  abilities(story = this.story): Set<Ability> {
    const can = new Set<Ability>(['ping']);
    if (story.with('cron') && story.has('can.freeze')) can.add('freeze');
    if (story.with('sudo')) can.add('force');
    if (story.with('float')) can.add('hover');
    if (story.with('tel')) can.add('talk');
    return can;
  }

  private arrive(id: string, tile: number): void {
    this.here = id;
    const spec = SPECS.get(id);
    this.story.flags.add(`been.${spec?.region ?? id}`);
    const known = this.entries.get(id) ?? new Set<number>();
    known.add(tile);
    this.entries.set(id, known);
  }

  /** Plays a scene to its end on a story; world effects go to `world`. */
  private run(id: string, story: Story, world: (e: Effect & { k: 'world' }) => void): void {
    story.flags.add(`seen.${id}`);
    const talk = new Talk(SCENES, {
      test: (c) => story.test(c),
      act: (fx) => {
        for (const e of story.apply(fx)) if (e.k === 'world') world(e);
      },
    });
    talk.start(id);
    for (let guard = 0; talk.active && guard < 500; guard += 1) {
      if (talk.choosing) talk.choose(this.choose(talk.scene?.id ?? id, talk.choices, talk));
      else talk.advance();
    }
    expect(talk.active, `${id} runs to its end`).toBe(false);
  }

  play(id: string): void {
    this.played.push(id);
    this.run(id, this.story, (e) => this.world(e));
  }

  private world(e: Effect & { k: 'world' }): void {
    const [a = '', b = ''] = e.args;
    switch (e.verb) {
      case 'goto': {
        const at = AREAS.get(a)?.marks.get(b);
        expect(at, `goto ${a} ${b}`).toBeDefined();
        this.arrive(a, at ?? 0);
        this.enterScene(a);
        break;
      }
      case 'ending':
        this.ending = a;
        break;
      case 'boss':
        this.queue.push(`!boss:${this.bossHere()}`);
        break;
    }
  }

  private bossHere(): string {
    for (const p of AREAS.get(this.here)?.placed ?? []) if (p.spec.t === 'boss') return p.spec.kind;
    return '';
  }

  private enterScene(id: string): void {
    const scene = this.enterRule(id);
    if (scene) this.queue.push(scene);
  }

  private enterRule(id: string): string {
    for (const rule of SPECS.get(id)?.enter ?? []) if (this.story.test(rule.if) && !this.story.has(`seen.${rule.scene}`)) return rule.scene;
    return '';
  }

  private readonly memo = new Map<string, boolean>();

  /** Whether playing a scene again would change anything that matters (remembered per state of the story). */
  private changes(id: string): boolean {
    if (!this.story.has(`seen.${id}`)) return true;
    const state = `${id}|${this.story.flags.size}|${this.story.party.join()}|${this.story.chapter}`;
    const known = this.memo.get(state);
    if (known !== undefined) return known;
    const result = this.simulate(id);
    this.memo.set(state, result);
    return result;
  }

  private simulate(id: string): boolean {
    const copy = new Story();
    copy.flags = new Set(this.story.flags);
    copy.trust = { ...this.story.trust };
    copy.party = this.story.party.slice();
    copy.chapter = this.story.chapter;
    let moved = false;
    this.run(id, copy, (e) => {
      if (e.verb === 'goto' || e.verb === 'ending' || e.verb === 'boss') moved = true;
    });
    const before = [...this.story.flags].filter((f) => !f.startsWith('seen.')).sort().join();
    const after = [...copy.flags].filter((f) => !f.startsWith('seen.')).sort().join();
    return moved || before !== after || copy.party.join() !== this.story.party.join();
  }

  private beat(kind: string): void {
    const can = this.abilities();
    for (const need of BOSS_NEEDS[kind] ?? []) expect(can.has(need), `${kind} needs ${need}`).toBe(true);
    if (kind === 'watchdog') {
      this.story.flags.add('wd.drop');
      this.play('watchdog.drop');
      this.story.flags.add('wd.clocks');
      this.play('watchdog.talk');
      return;
    }
    this.story.flags.add(`beat.${kind}`);
    this.play(`${kind}.down`);
  }

  private readonly cache = new Map<string, { set: Set<number>; latched: number[] }>();

  /** What's reachable in an area from where you've come into it (worked out once per situation). */
  private reach(id: string): { area: Area; set: Set<number> } {
    const area = AREAS.get(id) as Area;
    const starts = [...(this.entries.get(id) ?? [])].sort((a, b) => a - b);
    const flags = (REACH_FLAGS.get(id) ?? []).map((flag) => (flag.includes('.') && this.story.test(flag) ? flag : '')).join();
    const key = `${id}|${[...this.abilities()].sort().join()}|${starts.join()}|${flags}|${this.story.party.join()}`;
    let known = this.cache.get(key);
    if (!known) {
      const problem = { area, abilities: this.abilities(), story: this.story, terminal: terminalFx };
      const solver = new Solver(problem);
      // Done once everything worth reaching is reached: what could be, with no blocks in the way at all.
      const bound = new Solver({ ...problem, noBlocks: true }).explore(starts);
      const near = (g: number, set: Set<number>) => set.has(g) || beside(area, g).some((n) => set.has(n));
      const goals = area.placed.map((p) => p.y * area.w + p.x).filter((g) => near(g, bound));
      const done = (set: Set<number>) => goals.every((g) => near(g, set));
      // A shorter search than the puzzle tests': they check each puzzle in full.
      const set = solver.search(starts, done);
      known = { set, latched: [...solver.latchedEver] };
      this.cache.set(key, known);
    }
    // Puzzles solved stay solved.
    for (const sig of known.latched) {
      const latch = area.signals[sig]?.latch;
      if (latch) this.story.flags.add(latch);
    }
    return { area, set: known.set };
  }

  /** The next thing to do in an area, if any. */
  private actionIn(id: string, area: Area, set: Set<number>): (() => void) | null {
    const near = (i: number) => set.has(i) || beside(area, i).some((n) => set.has(n));
    const enter = this.enterRule(id);
    if (enter) return () => this.play(enter);
    for (const p of area.placed) {
      const i = p.y * area.w + p.x;
      const s = p.spec;
      if (s.t === 'trigger' && set.has(i) && this.story.test(s.if) && !this.story.has(`seen.${s.scene}`)) return () => this.play(s.scene);
      if (s.t === 'item' && near(i) && !this.story.has(s.flag)) {
        return () => {
          this.story.flags.add(s.flag);
          if (SCENES.has(s.flag)) this.play(s.flag);
        };
      }
    }
    for (const p of area.placed) {
      const i = p.y * area.w + p.x;
      const s = p.spec;
      if (s.t === 'npc' && near(i) && this.story.test(s.if)) {
        const rule = s.talk.find((r) => this.story.test(r.if));
        if (rule && this.changes(rule.scene)) return () => this.play(rule.scene);
      }
      if ((s.t === 'sign' || (s.t === 'terminal' && this.story.with('tel'))) && near(i) && this.changes(s.scene)) return () => this.play(s.scene);
      if (s.t === 'boss' && near(i) && !this.story.has(`beat.${s.kind}`) && !this.story.has('wd.clocks')) {
        // Its scene for coming in starts the fight; here, it's already been and the fight was left.
        const can = this.abilities();
        if ((BOSS_NEEDS[s.kind] ?? []).every((need) => can.has(need))) return () => this.beat(s.kind);
      }
    }
    // A beacon: what the companions have to say.
    const beacon = [...set].some((i) => beside(area, i).some((n) => area.tiles[n] === T.BEACON));
    if (beacon) {
      for (const rule of TALKS) {
        if (!this.story.with(rule.who) || this.story.has(`seen.${rule.scene}`) || !this.story.test(rule.if)) continue;
        return () => this.play(rule.scene);
      }
    }
    return null;
  }

  /** Finds the nearest thing to do (searching area by area along the open ways) and does it; the Watchdog's core last of all. */
  step(): boolean {
    const next = this.queue.shift();
    if (next) {
      if (next.startsWith('!boss:')) this.beat(next.slice(6));
      else this.play(next);
      return true;
    }
    return this.search(false) || this.search(true);
  }

  private search(finale: boolean): boolean {
    const seen = new Set<string>([this.here]);
    const order = [this.here];
    // The map's travel: to any place been to that has a way in for it.
    for (const [id, spec] of SPECS) {
      if (!spec.travel || !this.story.has(`been.${spec.region ?? id}`) || seen.has(id)) continue;
      const at = AREAS.get(id)?.marks.get(spec.travel);
      if (at === undefined) continue;
      const known = this.entries.get(id) ?? new Set<number>();
      known.add(at);
      this.entries.set(id, known);
      seen.add(id);
      order.push(id);
    }
    while (order.length > 0) {
      const id = order.shift() ?? '';
      const { area, set } = this.reach(id);
      const action = this.actionIn(id, area, set);
      if (action) {
        if (id !== this.here) this.here = id;
        action();
        return true;
      }
      for (const p of area.placed) {
        const s = p.spec;
        if (s.t !== 'exit' || !set.has(p.y * area.w + p.x) || !this.story.test(s.if)) continue;
        if (s.to === 'c5-core' && !finale) continue;
        const there = AREAS.get(s.to);
        const at = there?.marks.get(s.at);
        if (!there || at === undefined) continue;
        // Arrive a step inside, the way you were going.
        const i = p.y * area.w + p.x;
        const from = beside(area, i).find((n) => set.has(n)) ?? i;
        const land = at + ((i % area.w) - (from % area.w)) + (Math.floor(i / area.w) - Math.floor(from / area.w)) * there.w;
        const tile = there.tiles[land] ?? T.WALL;
        const known = this.entries.get(s.to) ?? new Set<number>();
        if (!known.has(land) && !alwaysSolid(tile)) {
          known.add(land);
          this.entries.set(s.to, known);
        }
        if (!seen.has(s.to)) {
          seen.add(s.to);
          order.push(s.to);
          this.story.flags.add(`been.${SPECS.get(s.to)?.region ?? s.to}`);
        }
      }
    }
    return false;
  }
}

function walk(choose: (scene: string, choices: Choice[], talk: Talk) => number): Walker {
  const w = new Walker(choose);
  for (let n = 0; n < 4000 && !w.story.has('ended'); n += 1) {
    if (!w.step()) break;
  }
  return w;
}

const kind = (_scene: string, choices: Choice[], talk: Talk): number => {
  let best = choices[0]?.index ?? 0;
  let most = -Infinity;
  for (const c of choices) {
    const w = warmth(c, talk);
    if (w > most) {
      most = w;
      best = c.index;
    }
  }
  return best;
};

const cold = (scene: string, choices: Choice[], talk: Talk): number => {
  // Still, at the very end, asks it to listen.
  if (scene === 'watchdog.choose') return choices[0]?.index ?? 0;
  let best = choices[choices.length - 1]?.index ?? 0;
  let least = Infinity;
  for (const c of [...choices].reverse()) {
    const w = warmth(c, talk);
    if (w < least) {
      least = w;
      best = c.index;
    }
  }
  return best;
};

/** Each walk plays the whole game; give it time. */
const LONG = 60_000;

describe('the whole story', () => {
  it(
    'can be finished choosing kindly, with every quest done, and ends with a reply',
    () => {
      const w = walk(kind);
      expect(w.story.has('ended'), `stuck after ${w.played.slice(-5).join(', ')} in ${w.here}`).toBe(true);
      const found = [...w.story.flags].filter((f) => /^(frag|log|q|letter|bye)\./.test(f)).sort();
      for (const flag of ['beat.spinlock', 'beat.oom', 'beat.jitter', 'beat.spoofer', 'q.letters.done', 'q.mote.done', 'q.archive.done', 'q.reap.done', 'q.cron.done', 'q.sudo.done', 'q.float.done', 'q.tel.done']) {
        expect(w.story.has(flag), `${flag} (have ${found.join(' ')})`).toBe(true);
      }
      expect(w.ending).toBe('reply');
    },
    LONG,
  );

  it(
    'can be finished choosing coldly, and then the Watchdog does not believe you',
    () => {
      const w = walk(cold);
      expect(w.story.has('ended'), `stuck after ${w.played.slice(-5).join(', ')} in ${w.here}`).toBe(true);
      expect(w.ending).toBe('timeout');
    },
    LONG,
  );

  it(
    'can end with Sudo shutting the Watchdog down',
    () => {
      const w = walk((scene, choices, talk) => (scene === 'watchdog.choose' ? (choices[choices.length - 1]?.index ?? 0) : kind(scene, choices, talk)));
      expect(w.ending).toBe('reset');
    },
    LONG,
  );

  it(
    'can be finished whatever is chosen',
    () => {
      for (let seed = 1; seed <= 3; seed += 1) {
        const rng = new Rng(seed);
        const w = walk((_scene, choices) => choices[rng.int(choices.length)]?.index ?? 0);
        expect(w.story.has('ended'), `seed ${seed}: stuck after ${w.played.slice(-5).join(', ')} in ${w.here}`).toBe(true);
        expect(['reply', 'reset', 'timeout']).toContain(w.ending);
      }
    },
    LONG,
  );
});
