import { describe, expect, it } from 'vitest';

import { BOSSES } from './bosses';
import { SPEAKERS } from './cast';
import { PART as BUFFER } from './chapters/buffer';
import { PART as CRONTAB } from './chapters/crontab';
import { PART as LOOPBACK } from './chapters/loopback';
import { PART as NULL } from './chapters/null';
import { PART as PORTS } from './chapters/ports';
import { PART as STACKS } from './chapters/stacks';
import { QUESTS } from './quests';
import { isEnd, parseScript, type Scene, targets } from './script';
import { cond, effects, flagsRead } from './story';
import { COMPANIONS, parse } from './world';

const PARTS = [LOOPBACK, CRONTAB, STACKS, BUFFER, PORTS, NULL];
const SPECS = PARTS.flatMap((part) => part.areas);
const SCENES = parseScript(PARTS.map((part) => part.script).join('\n'), SPEAKERS);

/** Every scene something in the game starts directly (not by chaining from another). */
function startedScenes(): Set<string> {
  const out = new Set<string>();
  for (const spec of SPECS) {
    for (const rule of spec.enter ?? []) out.add(rule.scene);
    for (const one of Object.values(spec.key ?? {}).flat()) {
      if (one.t === 'npc') for (const rule of one.talk) out.add(rule.scene);
      if (one.t === 'trigger' || one.t === 'sign' || one.t === 'terminal') out.add(one.scene);
      if (one.t === 'exit' && one.no) out.add(one.no);
      // A log's words are read out when it's picked up.
      if (one.t === 'item' && SCENES.has(one.flag)) out.add(one.flag);
      // A boss beaten plays its scene; the Watchdog isn't beaten, it listens.
      if (one.t === 'boss' && one.kind !== 'watchdog') out.add(`${one.kind}.down`);
    }
  }
  for (const part of PARTS) for (const rule of part.talks ?? []) out.add(rule.scene);
  for (const who of COMPANIONS) out.add(`${who}.idle`);
  out.add('watchdog.talk');
  out.add('watchdog.drop');
  return out;
}

/** Every scene reached by chaining (-> @scene) from another. */
function chained(scene: Scene): string[] {
  return scene.nodes.flatMap(targets).filter((to) => to.startsWith('@')).map((to) => to.slice(1));
}

describe('the script', () => {
  it('parses, with every speaker in the cast', () => {
    expect(SCENES.size).toBeGreaterThan(150);
  });

  it('jumps only to labels and scenes that exist', () => {
    for (const scene of SCENES.values()) {
      for (const node of scene.nodes) {
        for (const to of targets(node)) {
          if (isEnd(to)) continue;
          if (to.startsWith('@')) expect(SCENES.has(to.slice(1)), `${scene.id} -> ${to}`).toBe(true);
          else expect(scene.labels.has(to), `${scene.id} -> #${to}`).toBe(true);
        }
      }
    }
  });

  it('reaches every label in a scene from its start', () => {
    for (const scene of SCENES.values()) {
      const seen = new Set<number>();
      const queue = [0];
      while (queue.length > 0) {
        const at = queue.pop() ?? 0;
        if (seen.has(at) || at >= scene.nodes.length) continue;
        seen.add(at);
        const node = scene.nodes[at];
        if (!node) continue;
        const next = targets(node)
          .filter((to) => !isEnd(to) && !to.startsWith('@'))
          .map((to) => scene.labels.get(to) ?? -1);
        queue.push(...next);
        // Lines, effects, branches and menus (with a choice that carries on) fall through.
        const falls = node.k !== 'jump' && !(node.k === 'menu' && node.options.every((o) => o.to !== ''));
        if (falls) queue.push(at + 1);
      }
      for (const [label, at] of scene.labels) expect(seen.has(at) || at >= scene.nodes.length, `${scene.id} #${label} is never reached`).toBe(true);
    }
  });

  it('never strands you: every menu has a choice that is always there', () => {
    for (const scene of SCENES.values()) {
      for (const node of scene.nodes) {
        if (node.k !== 'menu') continue;
        expect(
          node.options.some((o) => o.if === ''),
          `${scene.id}: ${node.options.map((o) => o.text).join(' / ')}`,
        ).toBe(true);
      }
    }
  });

  it('plays every scene from somewhere', () => {
    const started = startedScenes();
    const reached = new Set<string>();
    const queue = [...started].filter((id) => SCENES.has(id));
    while (queue.length > 0) {
      const id = queue.pop() ?? '';
      if (reached.has(id)) continue;
      reached.add(id);
      const scene = SCENES.get(id);
      if (scene) queue.push(...chained(scene));
    }
    for (const id of SCENES.keys()) expect(reached.has(id), `${id} is never played`).toBe(true);
    for (const id of started) expect(SCENES.has(id), `${id} is started but not written`).toBe(true);
  });

  it('sends you only to areas and marks that exist', () => {
    const areas = new Map(SPECS.map((spec) => [spec.id, parse(spec)]));
    for (const scene of SCENES.values()) {
      for (const node of scene.nodes) {
        const lists = node.k === 'fx' ? [node.fx] : node.k === 'menu' ? node.options.map((o) => o.fx) : [];
        for (const fx of lists) {
          for (const e of fx) {
            if (e.k !== 'world' || e.verb !== 'goto') continue;
            const [to = '', mark = ''] = e.args;
            expect(areas.get(to)?.marks.has(mark), `${scene.id}: goto ${to} ${mark}`).toBe(true);
          }
        }
      }
    }
  });
});

describe('the flags', () => {
  /** Flags something sets: effects, items, latches, and those the game sets itself. */
  function flagsSet(): Set<string> {
    const out = new Set<string>(['ended', 'wd.drop', 'wd.clocks']);
    for (const kind of Object.keys(BOSSES)) out.add(`beat.${kind}`);
    for (const id of SCENES.keys()) out.add(`seen.${id}`);
    for (const spec of SPECS) {
      out.add(`been.${spec.region ?? spec.id}`);
      for (const one of Object.values(spec.key ?? {}).flat()) if (one.t === 'item') out.add(one.flag);
      for (const options of Object.values(spec.signals ?? {})) if (options.latch) out.add(options.latch);
    }
    for (const scene of SCENES.values()) {
      for (const node of scene.nodes) {
        const lists = node.k === 'fx' ? [node.fx] : node.k === 'menu' ? node.options.map((o) => o.fx) : [];
        for (const fx of lists) {
          for (const e of fx) {
            if (e.k === 'set') out.add(e.name);
            if (e.k === 'world' && e.verb === 'ending') out.add(`ending.${e.args[0]}`);
          }
        }
      }
    }
    return out;
  }

  /** Every condition anywhere, with where it is. */
  function conditions(): [string, string][] {
    const out: [string, string][] = [];
    for (const spec of SPECS) {
      for (const rule of spec.enter ?? []) out.push([rule.if, `${spec.id} enter`]);
      for (const [letter, options] of Object.entries(spec.signals ?? {})) if (options.when) out.push([options.when, `${spec.id} signal ${letter}`]);
      for (const one of Object.values(spec.key ?? {}).flat()) {
        if (one.t === 'npc') {
          out.push([one.if, `${spec.id} ${one.id}`]);
          for (const rule of one.talk) out.push([rule.if, `${spec.id} ${one.id} talk`]);
        }
        if (one.t === 'exit' || one.t === 'trigger') out.push([one.if, `${spec.id} ${one.t}`]);
      }
    }
    for (const part of PARTS) for (const rule of part.talks ?? []) out.push([rule.if, `talk ${rule.scene}`]);
    for (const quest of QUESTS) {
      out.push([quest.start, `quest ${quest.id}`]);
      for (const step of quest.steps) out.push([step.done, `quest ${quest.id}`]);
    }
    for (const scene of SCENES.values()) {
      for (const node of scene.nodes) {
        if (node.k === 'branch') out.push([node.if, scene.id]);
        if (node.k === 'menu') for (const o of node.options) out.push([o.if, scene.id]);
      }
    }
    return out;
  }

  it('tests only flags that something sets', () => {
    const set = flagsSet();
    const prefixes = [...set];
    for (const [text, where] of conditions()) {
      cond(text);
      for (const flag of flagsRead(text)) {
        if (flag.endsWith('*')) {
          const prefix = flag.slice(0, -1);
          expect(
            prefixes.some((f) => f.startsWith(prefix)),
            `${where}: nothing sets a ${prefix} flag`,
          ).toBe(true);
        } else {
          expect(set.has(flag), `${where}: "${flag}" is tested but never set`).toBe(true);
        }
      }
    }
  });

  it('counts eight logs and four fragments, each in an area', () => {
    const items = SPECS.flatMap((spec) => Object.values(spec.key ?? {}).flat()).filter((one) => one.t === 'item');
    const flags = items.map((one) => (one.t === 'item' ? one.flag : ''));
    expect(flags.filter((f) => f.startsWith('log.')).sort()).toEqual(['log.1', 'log.2', 'log.3', 'log.4', 'log.5', 'log.6', 'log.7', 'log.8']);
    expect(flags.filter((f) => f.startsWith('frag.')).sort()).toEqual(['frag.1', 'frag.2', 'frag.3', 'frag.4']);
    for (const flag of flags.filter((f) => f.startsWith('log.'))) expect(SCENES.has(flag), `${flag} has words`).toBe(true);
  });

  it('compiles every effect', () => {
    for (const scene of SCENES.values()) for (const node of scene.nodes) if (node.k === 'fx') expect(() => effects(node.text)).not.toThrow();
  });
});
