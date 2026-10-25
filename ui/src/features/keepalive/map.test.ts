import { describe, expect, it } from 'vitest';

import { PART as BUFFER } from './chapters/buffer';
import { PART as CRONTAB } from './chapters/crontab';
import { PART as LOOPBACK } from './chapters/loopback';
import { PART as NULL } from './chapters/null';
import { PART as PORTS } from './chapters/ports';
import { PART as STACKS } from './chapters/stacks';
import { chapterOf, PLACES } from './content';
import { nextNode, regionOf, worldMap } from './map';
import { Story } from './story';

const PARTS = [LOOPBACK, CRONTAB, STACKS, BUFFER, PORTS, NULL];
const AREAS = PARTS.flatMap((part) => part.areas);
const BY_ID = new Map(AREAS.map((spec) => [spec.id, spec]));

describe('the world map', () => {
  it('has a place for every area: its own, or the town it is in', () => {
    for (const spec of AREAS) {
      const region = BY_ID.get(regionOf(spec));
      expect(region?.at, `${spec.id} on the map`).toBeDefined();
    }
    const spots = new Set(AREAS.filter((s) => s.at).map((s) => s.at?.join()));
    expect(spots.size).toBe(AREAS.filter((s) => s.at).length);
  });

  it("places each chapter's way in where its town-side road says", () => {
    for (const place of PLACES) {
      const spec = BY_ID.get(place.area);
      expect(spec?.at).toEqual(place.at);
      expect(chapterOf(place.area)).toBe(place.chapter);
      expect(spec?.travel, `${place.area} can be travelled to`).toBeDefined();
    }
  });

  it('reaches every place along the roads, chapter by chapter, once each chapter is unlocked', () => {
    // Every road open, up to a chapter: every place of that chapter is reachable from Loopback.
    for (let chapter = 0; chapter <= 5; chapter += 1) {
      const allowed = new Set(AREAS.filter((s) => chapterOf(s.id) <= chapter).map((s) => s.id));
      const seen = new Set(['loopback']);
      const queue = ['loopback'];
      while (queue.length > 0) {
        const id = queue.shift() ?? '';
        for (const one of Object.values(BY_ID.get(id)?.key ?? {}).flat()) {
          if (one.t !== 'exit' || !allowed.has(one.to) || seen.has(one.to)) continue;
          seen.add(one.to);
          queue.push(one.to);
        }
        // The Null is entered from the Spoofer's gallery, by a scene.
        if (id === 'c4-gallery' && allowed.has('c5-edge') && !seen.has('c5-edge')) {
          seen.add('c5-edge');
          queue.push('c5-edge');
        }
      }
      for (const id of allowed) expect(seen.has(id), `chapter ${chapter}: ${id}`).toBe(true);
    }
  });

  it('shows only where you have been, and question marks along the open roads out of there', () => {
    const story = new Story();
    story.flags.add('been.loopback');
    let map = worldMap(AREAS, story, 'gran');
    expect(map.nodes.map((n) => n.id)).toEqual(['loopback']);
    // The east gate opens: the Crontab shows, not yet visited.
    story.flags.add('loop.lit');
    map = worldMap(AREAS, story, 'loopback');
    const crontab = map.nodes.find((n) => n.id === 'c1-gate');
    expect(crontab?.visited).toBe(false);
    expect(map.edges.length).toBe(1);
    // The Stacks stay hidden until their road opens.
    expect(map.nodes.some((n) => n.id === 'c2-gate')).toBe(false);
  });

  it('counts secrets found against the secrets in each place, and marks where you are', () => {
    const story = new Story();
    story.flags.add('been.loopback');
    story.flags.add('log.1');
    const map = worldMap(AREAS, story, 'gran');
    const town = map.nodes.find((n) => n.id === 'loopback');
    expect(town?.here).toBe(true);
    expect(town?.secrets).toBe(2);
    expect(town?.found).toBe(1);
    expect(town?.travel).toBe('x');
  });

  it('marks where the story goes next, and side quests', () => {
    const story = new Story();
    story.flags.add('been.loopback');
    story.flags.add('been.c1-gate');
    story.flags.add('been.c1-hall');
    story.party.push('cron');
    story.flags.add('c1.arrived');
    story.flags.add('q.letters');
    const map = worldMap(AREAS, story, 'c1-gate');
    expect(map.nodes.find((n) => n.main)?.id).toBe('c1-tower');
    expect(map.nodes.find((n) => n.id === 'c1-hall')?.side).toEqual(['Return to sender']);
  });

  it('moves the pick to the nearest place in the direction pressed', () => {
    const story = new Story();
    for (const id of ['loopback', 'c1-gate', 'c2-gate', 'c3-docks', 'c4-steps']) story.flags.add(`been.${id}`);
    for (const flag of ['loop.lit', 'beat.spinlock', 'beat.oom', 'beat.jitter']) story.flags.add(flag);
    const map = worldMap(AREAS, story, 'loopback');
    const at = (id: string) => map.nodes.findIndex((n) => n.id === id);
    expect(nextNode(map, at('loopback'), 1)).toBe(at('c1-gate'));
    expect(nextNode(map, at('loopback'), 0)).toBe(at('c2-gate'));
    expect(nextNode(map, at('loopback'), 3)).toBe(at('c3-docks'));
    expect(nextNode(map, at('loopback'), 2)).toBe(at('c4-steps'));
  });
});
