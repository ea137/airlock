// The kinds of thing that move in a level, by number (saves stay small).

import type { Foe } from './zones';

export const K = {
  CRAWLER: 1,
  ZIP: 2,
  SHELL: 3,
  MOTH: 4,
  FLEA: 5,
  WORM: 6,
  VIRUS: 7,
  SPAMMER: 8,
  CRON: 9,
  LEAK: 10,
  PHISH: 11,
  PLAT_H: 20,
  PLAT_V: 21,
  PLAT_FALL: 22,
  CHECKPOINT: 30,
  GOAL: 31,
  BACKDOOR: 32,
  RAM: 40,
  PING: 41,
  FAN: 42,
  LOCK: 43,
  LIFE: 44,
  SHOT_PING: 50,
  SHOT_SPAM: 51,
  SHOT_BULLET: 52,
  SHOT_DROP: 53,
  SHOT_BOSS: 54,
  SHOT_WAVE: 55,
  BOSS: 60,
  POP_BIT: 70,
  POP_KEY: 71,
} as const;

export const FOE_KIND: Record<Foe, number> = {
  crawler: K.CRAWLER,
  zip: K.ZIP,
  moth: K.MOTH,
  flea: K.FLEA,
  worm: K.WORM,
  virus: K.VIRUS,
  spammer: K.SPAMMER,
  cron: K.CRON,
  leak: K.LEAK,
  phish: K.PHISH,
};

/** Bugs the packet can't land on. */
export function isSpiky(kind: number): boolean {
  return kind === K.VIRUS || kind === K.SHOT_BULLET || kind === K.SHOT_SPAM || kind === K.SHOT_DROP || kind === K.SHOT_BOSS || kind === K.SHOT_WAVE;
}

export function isFoe(kind: number): boolean {
  return kind >= K.CRAWLER && kind <= K.PHISH;
}

export function isShot(kind: number): boolean {
  return kind >= K.SHOT_PING && kind <= K.SHOT_WAVE;
}

export function isItem(kind: number): boolean {
  return kind >= K.RAM && kind <= K.LIFE;
}

export function isPlatform(kind: number): boolean {
  return kind >= K.PLAT_H && kind <= K.PLAT_FALL;
}
