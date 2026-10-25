// What the story knows: the flags set by what you've done and said, how
// much each companion trusts you, who's with you, and which chapters you've
// reached. Conditions and effects are short strings, written in the script
// and the areas ("met.cron cron>=5", "+met.cron cron+1 join.cron"), compiled
// once and then tested and applied here.

import { type Companion, COMPANIONS, isCompanion } from './world';

/** Trust at or above this, and a companion stands with you at the end. */
export const TRUSTED = 5;
export const TRUST_MAX = 10;

const START_TRUST: Record<Companion, number> = { cron: 3, sudo: 2, float: 3, tel: 3 };

type Op = '>=' | '<=' | '>' | '<' | '=';

type Term =
  | { k: 'flag'; name: string; not: boolean }
  | { k: 'with'; who: Companion; not: boolean }
  | { k: 'trust'; who: Companion; op: Op; n: number }
  | { k: 'count'; prefix: string; op: Op; n: number }
  | { k: 'chapter'; op: Op; n: number }
  | { k: 'stand'; op: Op; n: number };

/** OR of ANDs. An empty condition always holds. */
export type Cond = Term[][];

export type Effect =
  | { k: 'set'; name: string }
  | { k: 'clear'; name: string }
  | { k: 'trust'; who: Companion; by: number }
  | { k: 'join'; who: Companion }
  | { k: 'leave'; who: Companion }
  | { k: 'chapter'; n: number }
  /** Everything else is for the world or the engine to do. */
  | { k: 'world'; verb: string; args: string[] };

/** The verbs the world and engine act on, with how many arguments each takes. */
export const WORLD_VERBS: Record<string, number> = {
  goto: 2,
  sig: 1,
  unsig: 1,
  flip: 1,
  song: 1,
  sfx: 1,
  shake: 0,
  heal: 0,
  heart: 0,
  boss: 0,
  ending: 1,
  face: 1,
  credits: 0,
  map: 0,
};

const OP = /^(>=|<=|>|<|=)(-?\d+)$/;

function compare(a: number, op: Op, b: number): boolean {
  switch (op) {
    case '>=':
      return a >= b;
    case '<=':
      return a <= b;
    case '>':
      return a > b;
    case '<':
      return a < b;
    default:
      return a === b;
  }
}

function term(word: string): Term {
  const not = word.startsWith('!');
  const bare = not ? word.slice(1) : word;
  if (bare.startsWith('with.')) {
    const who = bare.slice(5);
    if (!isCompanion(who)) throw new Error(`"${word}": no companion called ${who}.`);
    return { k: 'with', who, not };
  }
  const compared = /^([a-z0-9_.*]+?)(>=|<=|>|<|=)(-?\d+)$/.exec(bare);
  if (compared) {
    const [, name = '', op = '=', n = '0'] = compared;
    const ops = OP.exec(`${op}${n}`);
    if (!ops || not) throw new Error(`"${word}" isn't a comparison I know.`);
    if (isCompanion(name)) return { k: 'trust', who: name, op: op as Op, n: Number(n) };
    if (name === 'chapter') return { k: 'chapter', op: op as Op, n: Number(n) };
    if (name === 'stand') return { k: 'stand', op: op as Op, n: Number(n) };
    if (name.endsWith('.*')) return { k: 'count', prefix: name.slice(0, -1), op: op as Op, n: Number(n) };
    throw new Error(`"${word}": only trust, chapter, stand and counts (log.*) compare.`);
  }
  if (!/^[a-z0-9_.]+$/.test(bare)) throw new Error(`"${word}" isn't a flag name.`);
  return { k: 'flag', name: bare, not };
}

const compiled = new Map<string, Cond>();

/** Compiles a condition: words ANDed, `|` between alternatives. */
export function cond(text: string): Cond {
  const cached = compiled.get(text);
  if (cached) return cached;
  const out: Cond = text
    .split('|')
    .map((part) => part.trim().split(/\s+/).filter(Boolean).map(term))
    .filter((group) => group.length > 0);
  compiled.set(text, out);
  return out;
}

/** Every flag a condition reads, for the tests. */
export function flagsRead(text: string): string[] {
  const names: string[] = [];
  for (const group of cond(text)) {
    for (const t of group) {
      if (t.k === 'flag') names.push(t.name);
      if (t.k === 'count') names.push(`${t.prefix}*`);
    }
  }
  return names;
}

/** Compiles effects, separated by spaces. */
export function effects(text: string): Effect[] {
  const out: Effect[] = [];
  for (const word of text.trim().split(/\s+/).filter(Boolean)) out.push(effect(word));
  return out;
}

function effect(word: string): Effect {
  if (word.startsWith('+') || word.startsWith('-')) {
    const name = word.slice(1);
    if (!/^[a-z0-9_.]+$/.test(name)) throw new Error(`"${word}" sets or clears a flag with a bad name.`);
    return { k: word.startsWith('+') ? 'set' : 'clear', name };
  }
  const trust = /^(cron|sudo|float|tel)([+-]\d+)$/.exec(word);
  if (trust) return { k: 'trust', who: trust[1] as Companion, by: Number(trust[2]) };
  const [verb = '', ...args] = word.split(':');
  if (verb === 'join' || verb === 'leave') {
    const who = args[0] ?? '';
    if (!isCompanion(who)) throw new Error(`"${word}": no companion called ${who}.`);
    return { k: verb, who };
  }
  if (verb === 'chapter') {
    const n = Number(args[0]);
    if (!Number.isInteger(n) || n < 0 || n > 6) throw new Error(`"${word}": a chapter is 0 to 6.`);
    return { k: 'chapter', n };
  }
  const arity = WORLD_VERBS[verb];
  if (arity === undefined) throw new Error(`"${word}" isn't an effect I know.`);
  if (args.length !== arity) throw new Error(`"${word}": ${verb} takes ${arity} argument${arity === 1 ? '' : 's'}.`);
  return { k: 'world', verb, args };
}

/** Every flag an effect list sets, for the tests. */
export function flagsSet(text: string): string[] {
  return effects(text).flatMap((e) => (e.k === 'set' ? [e.name] : []));
}

export class Story {
  flags = new Set<string>();
  trust: Record<Companion, number> = { ...START_TRUST };
  /** Who's with you, the one walking right behind you first. */
  party: Companion[] = [];
  chapter = 0;
  /** The chapters reached, a bit each. */
  reached = 1;

  has(flag: string): boolean {
    return this.flags.has(flag);
  }

  with(who: Companion): boolean {
    return this.party.includes(who);
  }

  /** How many flags start with a prefix (logs found, letters delivered). */
  count(prefix: string): number {
    let n = 0;
    for (const flag of this.flags) if (flag.startsWith(prefix)) n += 1;
    return n;
  }

  /** Companions with you who trust you enough to stand by you. */
  standing(): number {
    return this.party.filter((who) => this.trust[who] >= TRUSTED).length;
  }

  test(text: string): boolean {
    const groups = cond(text);
    if (groups.length === 0) return true;
    return groups.some((group) => group.every((t) => this.holds(t)));
  }

  private holds(t: Term): boolean {
    switch (t.k) {
      case 'flag':
        return this.flags.has(t.name) !== t.not;
      case 'with':
        return this.party.includes(t.who) !== t.not;
      case 'trust':
        return compare(this.trust[t.who], t.op, t.n);
      case 'count':
        return compare(this.count(t.prefix), t.op, t.n);
      case 'chapter':
        return compare(this.chapter, t.op, t.n);
      case 'stand':
        return compare(this.standing(), t.op, t.n);
    }
  }

  /** Applies the story's own effects and hands back the rest, for the world. */
  apply(list: Effect[]): Effect[] {
    const rest: Effect[] = [];
    for (const e of list) {
      switch (e.k) {
        case 'set':
          this.flags.add(e.name);
          break;
        case 'clear':
          this.flags.delete(e.name);
          break;
        case 'trust':
          this.trust[e.who] = Math.max(0, Math.min(TRUST_MAX, this.trust[e.who] + e.by));
          break;
        case 'join':
          if (!this.party.includes(e.who)) this.party.push(e.who);
          break;
        case 'leave':
          this.party = this.party.filter((who) => who !== e.who);
          break;
        case 'chapter':
          this.chapter = Math.max(this.chapter, e.n);
          this.reached |= 1 << e.n;
          rest.push(e);
          break;
        default:
          rest.push(e);
      }
    }
    return rest;
  }

  /** Puts the next companion at the front (the one whose ability A uses). */
  rotate(): Companion | null {
    if (this.party.length < 2) return this.party[0] ?? null;
    const first = this.party.shift();
    if (first) this.party.push(first);
    return this.party[0] ?? null;
  }

  reset(): void {
    this.flags = new Set();
    this.trust = { ...START_TRUST };
    this.party = [];
    this.chapter = 0;
    this.reached = 1;
  }
}

export { COMPANIONS };
