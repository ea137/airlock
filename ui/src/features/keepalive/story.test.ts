import { describe, expect, it } from 'vitest';

import { questList, QUESTS, questState } from './quests';
import { cond, effects, Story } from './story';

describe('conditions', () => {
  it('reads flags, their absence, and alternatives', () => {
    const s = new Story();
    s.flags.add('a');
    expect(s.test('')).toBe(true);
    expect(s.test('a')).toBe(true);
    expect(s.test('!a')).toBe(false);
    expect(s.test('a b')).toBe(false);
    expect(s.test('b | a')).toBe(true);
  });

  it('compares trust, counts flags by prefix, and knows who is with you', () => {
    const s = new Story();
    s.trust.cron = 5;
    s.flags.add('log.1');
    s.flags.add('log.2');
    s.party.push('cron');
    expect(s.test('cron>=5')).toBe(true);
    expect(s.test('cron>5')).toBe(false);
    expect(s.test('log.*>=2')).toBe(true);
    expect(s.test('log.*>=3')).toBe(false);
    expect(s.test('with.cron !with.sudo')).toBe(true);
    expect(s.test('stand>=1')).toBe(true);
    s.trust.cron = 4;
    expect(s.test('stand>=1')).toBe(false);
  });

  it('refuses what it does not understand', () => {
    expect(() => cond('with.nobody')).toThrow();
    expect(() => cond('Bad Flag')).toThrow();
    expect(() => cond('flag>=2')).toThrow();
  });
});

describe('effects', () => {
  it('set and clear flags, change trust within bounds, and change the party', () => {
    const s = new Story();
    s.apply(effects('+met cron+1 sudo-9 join:cron join:sudo leave:sudo'));
    expect(s.has('met')).toBe(true);
    expect(s.trust.cron).toBe(4);
    expect(s.trust.sudo).toBe(0);
    expect(s.party).toEqual(['cron']);
    s.apply(effects('-met'));
    expect(s.has('met')).toBe(false);
  });

  it('hands world effects back, and reaches chapters', () => {
    const s = new Story();
    const rest = s.apply(effects('chapter:2 goto:loopback:x shake'));
    expect(s.chapter).toBe(2);
    expect(s.reached & (1 << 2)).not.toBe(0);
    expect(rest.map((e) => (e.k === 'world' ? e.verb : e.k))).toEqual(['chapter', 'goto', 'shake']);
  });

  it('refuses unknown effects and wrong arguments', () => {
    expect(() => effects('dance')).toThrow();
    expect(() => effects('goto:loopback')).toThrow();
    expect(() => effects('join:nobody')).toThrow();
  });

  it('switches who walks in front, round the party', () => {
    const s = new Story();
    s.party.push('cron', 'sudo', 'float');
    expect(s.rotate()).toBe('sudo');
    expect(s.rotate()).toBe('float');
    expect(s.rotate()).toBe('cron');
  });
});

describe('quests', () => {
  it('follow the story: the main quest moves on as its steps are done', () => {
    const s = new Story();
    const main = QUESTS.find((q) => q.id === 'main');
    if (!main) throw new Error('No main quest.');
    expect(questState(s, main).step).toBe(0);
    s.party.push('cron');
    expect(questState(s, main).step).toBe(1);
    s.flags.add('c1.arrived');
    s.flags.add('can.freeze');
    expect(questState(s, main).text).toMatch(/jamming/);
    s.flags.add('ended');
    for (const step of main.steps) for (const word of step.done.split(' ')) if (!word.startsWith('with.') && !word.includes('*')) s.flags.add(word);
    s.party.push('sudo', 'float', 'tel');
    expect(questState(s, main).done).toBe(true);
  });

  it('show only once begun, the story first, open before done', () => {
    const s = new Story();
    expect(questList(s).map((q) => q.quest.id)).toEqual(['main']);
    s.flags.add('q.mote');
    s.flags.add('q.letters');
    s.flags.add('letter.alarm');
    s.flags.add('letter.swap');
    s.flags.add('letter.buoy');
    s.flags.add('q.letters.done');
    const list = questList(s).map((q) => q.quest.id);
    expect(list[0]).toBe('main');
    expect(list.indexOf('mote')).toBeLessThan(list.indexOf('letters'));
  });

  it("counts Mote's fragments", () => {
    const s = new Story();
    const mote = QUESTS.find((q) => q.id === 'mote');
    if (!mote) throw new Error('No Mote quest.');
    s.flags.add('q.mote');
    for (const n of [1, 2, 3]) s.flags.add(`frag.${n}`);
    expect(questState(s, mote).step).toBe(0);
    s.flags.add('frag.4');
    expect(questState(s, mote).step).toBe(1);
    s.flags.add('q.mote.done');
    expect(questState(s, mote).done).toBe(true);
  });

  it('point to places on the map that exist', async () => {
    const { PART: LOOPBACK } = await import('./chapters/loopback');
    const parts = await Promise.all([import('./chapters/crontab'), import('./chapters/stacks'), import('./chapters/buffer'), import('./chapters/ports'), import('./chapters/null')]);
    const ids = new Set([LOOPBACK, ...parts.map((p) => p.PART)].flatMap((part) => part.areas.map((a) => a.id)));
    for (const quest of QUESTS) for (const step of quest.steps) if (step.at) expect(ids.has(step.at), `${quest.id}: ${step.at}`).toBe(true);
  });
});
