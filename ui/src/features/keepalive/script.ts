// The dialogue, written as a small script and parsed once when the game
// opens. A scene starts with `@id`; then, a line each:
//
//   gran: Words.                 someone speaks (an id from the cast)
//   : Words.                     narration
//   > Words. -> label ~ effects  a choice; choices in a row make one menu,
//   > [cond] Words.               and a [condition] can hide one
//   ? cond -> label              go to label if the condition holds
//   -> label                     go to label ('end' ends, '@scene' moves on)
//   ~ effects                    do things (see story.ts)
//   #label                       a place to go to
//
// A choice with no target carries on below the menu. A scene that runs off
// its last line ends.

import { cond, type Effect, effects } from './story';

export type Option = { text: string; if: string; to: string; fx: Effect[]; fxText: string };

export type Node =
  | { k: 'line'; who: string; text: string }
  | { k: 'menu'; options: Option[] }
  | { k: 'jump'; to: string }
  | { k: 'branch'; if: string; to: string }
  | { k: 'fx'; fx: Effect[]; text: string };

export type Scene = { id: string; nodes: Node[]; labels: Map<string, number> };

const SCENE = /^@([a-z0-9_.-]+)$/;
const LABEL = /^#([a-z0-9_.-]+)$/;
const SPEAK = /^([a-z]+):\s*(.*)$/;

/** Where a jump goes: 'end', '@scene', or a label in this scene. */
export function isEnd(to: string): boolean {
  return to === 'end';
}

function choice(body: string, where: string): Option {
  let rest = body.trim();
  let when = '';
  if (rest.startsWith('[')) {
    const close = rest.indexOf(']');
    if (close < 0) throw new Error(`${where}: a choice's [condition] isn't closed.`);
    when = rest.slice(1, close).trim();
    cond(when);
    rest = rest.slice(close + 1).trim();
  }
  let fxText = '';
  const tilde = rest.indexOf(' ~ ');
  if (tilde >= 0) {
    fxText = rest.slice(tilde + 3).trim();
    rest = rest.slice(0, tilde).trim();
  }
  let to = '';
  const arrow = rest.indexOf(' -> ');
  if (arrow >= 0) {
    to = rest.slice(arrow + 4).trim();
    rest = rest.slice(0, arrow).trim();
  }
  if (!rest) throw new Error(`${where}: a choice needs words.`);
  return { text: rest, if: when, to, fx: effects(fxText), fxText };
}

/** Parses a script into scenes. `cast` is who may speak; a mistake throws, naming the line. */
export function parseScript(text: string, cast: ReadonlySet<string>, into = new Map<string, Scene>()): Map<string, Scene> {
  let scene: Scene | null = null;
  const lines = text.split('\n');
  lines.forEach((raw, index) => {
    const line = raw.trim();
    const where = scene ? `Scene ${scene.id}, line ${index + 1}` : `Line ${index + 1}`;
    if (line === '' || line.startsWith('//')) return;
    const head = SCENE.exec(line);
    if (head) {
      const id = head[1] ?? '';
      if (into.has(id)) throw new Error(`Scene ${id} is written twice.`);
      scene = { id, nodes: [], labels: new Map() };
      into.set(id, scene);
      return;
    }
    if (!scene) throw new Error(`${where}: words before any @scene.`);
    const s: Scene = scene;
    const label = LABEL.exec(line);
    if (label) {
      const name = label[1] ?? '';
      if (s.labels.has(name)) throw new Error(`${where}: #${name} is there twice.`);
      s.labels.set(name, s.nodes.length);
      return;
    }
    if (line.startsWith('>')) {
      const option = choice(line.slice(1), where);
      const last = s.nodes[s.nodes.length - 1];
      // A choice right after a label starts a new menu, so the label points at it.
      const labelled = [...s.labels.values()].includes(s.nodes.length);
      if (last?.k === 'menu' && !labelled) last.options.push(option);
      else s.nodes.push({ k: 'menu', options: [option] });
      return;
    }
    if (line.startsWith('?')) {
      const arrow = line.indexOf(' -> ');
      if (arrow < 0) throw new Error(`${where}: "? condition -> label" needs its arrow.`);
      const when = line.slice(1, arrow).trim();
      cond(when);
      s.nodes.push({ k: 'branch', if: when, to: line.slice(arrow + 4).trim() });
      return;
    }
    if (line.startsWith('->')) {
      s.nodes.push({ k: 'jump', to: line.slice(2).trim() });
      return;
    }
    if (line.startsWith('~')) {
      const fxText = line.slice(1).trim();
      s.nodes.push({ k: 'fx', fx: effects(fxText), text: fxText });
      return;
    }
    if (line.startsWith(':')) {
      s.nodes.push({ k: 'line', who: '', text: line.slice(1).trim() });
      return;
    }
    const speak = SPEAK.exec(line);
    if (speak) {
      const who = speak[1] ?? '';
      if (!cast.has(who)) throw new Error(`${where}: nobody called "${who}" is in the cast.`);
      s.nodes.push({ k: 'line', who, text: (speak[2] ?? '').trim() });
      return;
    }
    throw new Error(`${where}: "${line}" isn't a line of script.`);
  });
  return into;
}

/** Where a node jumps, chains or branches to, for the tests and the runner. */
export function targets(node: Node): string[] {
  switch (node.k) {
    case 'menu':
      return node.options.map((o) => o.to).filter(Boolean);
    case 'jump':
    case 'branch':
      return [node.to];
    default:
      return [];
  }
}
