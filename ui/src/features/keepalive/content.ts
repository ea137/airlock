// Everything the story is made of: Loopback and the prologue, which come
// with the game, and a file for each chapter, each holding its areas (the
// maps) and its script (the scenes) side by side. A chapter is its own
// small chunk, fetched as you get near it (the engine asks for the next
// one when a chapter starts), so opening the game downloads only the
// engine and the town.

import { PART as LOOPBACK } from './chapters/loopback';
import type { AreaSpec, Companion } from './world';

/** What a companion says at a beacon, the first time its condition holds. */
export type TalkRule = { who: Companion; scene: string; if: string };

/** Where each chapter starts on the world map, known before the chapter is loaded. */
export type Place = { name: string; area: string; chapter: number; at: [number, number] };

export type Ending = { title: string; lines: string[] };

export type Part = {
  areas: AreaSpec[];
  script: string;
  talks?: TalkRule[];
  /** Logs to find: the flag and the title. */
  logs?: Record<string, string>;
  endings?: Record<string, Ending>;
};

/** The chapters after the prologue, by number. */
export const CHAPTER_PARTS: Record<number, () => Promise<{ PART: Part }>> = {
  1: () => import('./chapters/crontab'),
  2: () => import('./chapters/stacks'),
  3: () => import('./chapters/buffer'),
  4: () => import('./chapters/ports'),
  5: () => import('./chapters/null'),
};

export const LAST_CHAPTER = 5;

/** Which chapter an area belongs to, from its name ('c3-docks' is chapter 3; the town is 0). */
export function chapterOf(area: string): number {
  const match = /^c(\d)-/.exec(area);
  return match ? Number(match[1]) : 0;
}

/** The town and the way into each chapter, for the world map. */
export const PLACES: Place[] = [
  { name: 'Loopback', area: 'loopback', chapter: 0, at: [128, 72] },
  { name: 'The Crontab', area: 'c1-gate', chapter: 1, at: [154, 72] },
  { name: 'The Stacks', area: 'c2-gate', chapter: 2, at: [128, 50] },
  { name: 'The Buffer', area: 'c3-docks', chapter: 3, at: [102, 76] },
  { name: 'The old Ports', area: 'c4-steps', chapter: 4, at: [128, 94] },
  { name: 'The Null', area: 'c5-edge', chapter: 5, at: [190, 112] },
];

export const START = { area: 'gran', mark: '@' };

export const CORE: Part = LOOPBACK;
