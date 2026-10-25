// The numbers the sim, the bosses and the drawing share: what kind of
// thing an entity is, what happened in a tick, and why A did nothing.

/** Kinds of things in an area. */
export const K = { NONE: 0, NPC: 1, ITEM: 2, MOVER: 3, SWEEPER: 4, CRUSHER: 5, SENTRY: 6, BUG: 7, BOSS: 8, BLOCK: 9, SHOT: 10 } as const;

/** What happened in a tick, for the sound, the sparkle and the companions' remarks. */
export const EV = {
  PING: 1,
  FREEZE: 2,
  THAW: 3,
  HOVER: 4,
  FORCE: 5,
  BREAK: 6,
  PUSH: 7,
  FILL: 8,
  HURT: 9,
  FALL: 10,
  TIMEOUT: 11,
  CAUGHT: 12,
  PICK: 13,
  NODE: 14,
  OPEN: 15,
  SWITCH: 16,
  BUMP: 17,
  BOSS_HIT: 18,
  BOSS_DOWN: 19,
  CHECK: 20,
  SOLVED: 21,
  NO: 22,
  ENTER: 23,
  STUN: 24,
  POP: 25,
  STEP: 26,
  LAND: 27,
  WHIFF: 28,
  BOSS_START: 29,
  SHOT: 30,
  BOSS_PHASE: 31,
  CRUSH: 32,
} as const;

/** Why A did nothing, for a companion to say. */
export const NO = { NOTHING: 0, NEED_TEL: 1, NEED_SUDO: 2, TIRED: 3, NO_FREEZE: 4, HEAVY: 5, ALONE: 6 } as const;

/** What an item is, as an event's value. */
export const ITEM_KINDS = ['log', 'fragment', 'letter', 'heart', 'key'] as const;
