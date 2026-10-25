// The world map: the places you travel between, drawn as the story reaches
// them. A place shows once you've been there, or once an open road leads to
// it from somewhere you've been (then it's a question mark). Each shows the
// secrets found there out of all there are, where the story goes next, and
// where the side quests are waiting. Worked out fresh from the story's flags
// each time the map opens, so it can't fall out of step with the game.

import { PLACES } from './content';
import { questList } from './quests';
import type { Story } from './story';
import type { AreaSpec } from './world';

export type MapNode = {
  id: string;
  name: string;
  chapter: number;
  x: number;
  y: number;
  visited: boolean;
  here: boolean;
  found: number;
  secrets: number;
  /** The tile travel brings you to here, or '' if you can't travel here. */
  travel: string;
  /** The story's next step is here. */
  main: boolean;
  /** Side quests waiting here, by title. */
  side: string[];
};

export type WorldMap = { nodes: MapNode[]; edges: [number, number][] };

/** The map place an area counts as. */
export function regionOf(spec: AreaSpec): string {
  return spec.region ?? spec.id;
}

export function worldMap(specs: AreaSpec[], story: Story, hereArea: string): WorldMap {
  const byId = new Map(specs.map((spec) => [spec.id, spec]));
  const here = byId.get(hereArea);
  const hereRegion = here ? regionOf(here) : hereArea;
  const nodes: MapNode[] = [];
  const index = new Map<string, number>();
  const node = (id: string): MapNode | null => {
    const at = index.get(id);
    if (at !== undefined) return nodes[at] ?? null;
    const spec = byId.get(id);
    const place = PLACES.find((p) => p.area === id);
    const pos = spec?.at ?? place?.at;
    if (!pos) return null;
    const made: MapNode = {
      id,
      name: spec?.name ?? place?.name ?? id,
      chapter: spec?.chapter ?? place?.chapter ?? 0,
      x: pos[0],
      y: pos[1],
      visited: story.has(`been.${id}`),
      here: id === hereRegion,
      found: 0,
      secrets: 0,
      travel: '',
      main: false,
      side: [],
    };
    index.set(id, nodes.length);
    nodes.push(made);
    return made;
  };
  // Where you've been, and what's to find there.
  for (const spec of specs) {
    const region = regionOf(spec);
    if (!story.has(`been.${region}`)) continue;
    const n = node(region);
    if (!n) continue;
    if (spec.travel && spec.id === region) n.travel = spec.travel;
    for (const one of Object.values(spec.key ?? {}).flat()) {
      if (one.t !== 'item') continue;
      n.secrets += 1;
      if (story.has(one.flag)) n.found += 1;
    }
  }
  // Open roads out of those places, to places seen from them.
  const edges: [number, number][] = [];
  const seen = new Set<string>();
  for (const spec of specs) {
    const from = regionOf(spec);
    if (!story.has(`been.${from}`)) continue;
    for (const one of Object.values(spec.key ?? {}).flat()) {
      if (one.t !== 'exit') continue;
      const target = byId.get(one.to);
      const to = target ? regionOf(target) : one.to;
      if (to === from) continue;
      if (!story.has(`been.${to}`) && !story.test(one.if)) continue;
      const a = node(from);
      const b = node(to);
      if (!a || !b) continue;
      const key = from < to ? `${from}|${to}` : `${to}|${from}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push([index.get(from) ?? 0, index.get(to) ?? 0]);
    }
  }
  // Where the quests point.
  for (const state of questList(story)) {
    if (state.done) continue;
    const at = state.quest.steps[state.step]?.at;
    const target = at ? (index.has(at) ? nodes[index.get(at) ?? 0] : null) : null;
    if (!target) continue;
    if (state.quest.side) target.side.push(state.quest.title);
    else target.main = true;
  }
  return { nodes, edges };
}

/** The node nearest to `from` in a direction (0 up, 1 right, 2 down, 3 left), or `from` itself. */
export function nextNode(map: WorldMap, from: number, dir: number): number {
  const start = map.nodes[from];
  if (!start) return from;
  let best = from;
  let bestScore = Infinity;
  map.nodes.forEach((n, i) => {
    if (i === from) return;
    const dx = n.x - start.x;
    const dy = n.y - start.y;
    const along = dir === 0 ? -dy : dir === 1 ? dx : dir === 2 ? dy : -dx;
    const across = dir === 0 || dir === 2 ? Math.abs(dx) : Math.abs(dy);
    if (along <= 0) return;
    const score = along + across * 2;
    if (score < bestScore) {
      bestScore = score;
      best = i;
    }
  });
  return best;
}
