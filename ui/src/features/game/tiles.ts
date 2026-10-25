// The tiles a level is made of, what each does, and the characters the
// hand-made chunks (chunks.ts) draw them with. A tile is 8 pixels square.

export const TILE = 8;

export const T = {
  EMPTY: 0,
  GROUND: 1,
  BRICK: 2,
  QBIT: 3,
  QPOWER: 4,
  USED: 5,
  HARD: 6,
  ONEWAY: 7,
  SPIKE: 8,
  LIQUID: 9,
  HIDDEN_BIT: 10,
  HIDDEN_LIFE: 11,
  MULTI: 12,
  ICE: 13,
  CONV_R: 14,
  CONV_L: 15,
  SWITCH: 16,
  RED: 17,
  BLUE: 18,
  BEAT_A: 19,
  BEAT_B: 20,
  FLIP: 21,
  PIPE_TL: 22,
  PIPE_TR: 23,
  PIPE_L: 24,
  PIPE_R: 25,
  WARP: 26,
  BIT: 27,
  KEY: 28,
  FAKE: 29,
  WATER: 30,
  SPRING: 31,
  DECOR_A: 32,
  DECOR_B: 33,
  DECOR_C: 34,
  GATE: 35,
  GATE_SHUT: 36,
  QKEY: 37,
} as const;

export type TileId = (typeof T)[keyof typeof T];

export const F = {
  SOLID: 1,
  ONEWAY: 2,
  HAZARD: 4,
  DEADLY: 8,
  BUMP: 16,
  HIDDEN: 32,
  PICKUP: 64,
  /** Solid or not depending on the switch or the beat. */
  DYNAMIC: 128,
} as const;

const TILE_COUNT = 40;

/** Each tile's flags, by id. */
export const FLAGS = new Uint8Array(TILE_COUNT);
for (const id of [T.GROUND, T.USED, T.HARD, T.ICE, T.CONV_R, T.CONV_L, T.PIPE_TL, T.PIPE_TR, T.PIPE_L, T.PIPE_R, T.WARP, T.GATE_SHUT]) {
  FLAGS[id] = F.SOLID;
}
for (const id of [T.BRICK, T.QBIT, T.QPOWER, T.MULTI, T.SWITCH, T.QKEY]) FLAGS[id] = F.SOLID | F.BUMP;
FLAGS[T.SPIKE] = F.SOLID | F.HAZARD;
FLAGS[T.SPRING] = F.SOLID;
FLAGS[T.ONEWAY] = F.ONEWAY;
FLAGS[T.LIQUID] = F.DEADLY;
FLAGS[T.HIDDEN_BIT] = F.HIDDEN | F.BUMP;
FLAGS[T.HIDDEN_LIFE] = F.HIDDEN | F.BUMP;
FLAGS[T.BIT] = F.PICKUP;
FLAGS[T.KEY] = F.PICKUP;
for (const id of [T.RED, T.BLUE, T.BEAT_A, T.BEAT_B]) FLAGS[id] = F.DYNAMIC;

/** Whether a dynamic tile is solid right now: red with the switch on, blue
 * with it off; beat blocks take turns. */
export function dynamicSolid(id: number, switchOn: boolean, beat: number): boolean {
  if (id === T.RED) return switchOn;
  if (id === T.BLUE) return !switchOn;
  if (id === T.BEAT_A) return beat === 0;
  if (id === T.BEAT_B) return beat === 1;
  return false;
}

/** How fast a conveyor carries what stands on it, in pixels a tick. */
export const CONVEYOR_SPEED = 0.6;

/** The characters chunks are drawn with. Enemies, platforms and markers are
 * read by the generator; everything here is a tile. */
export const CHAR_TILE: Record<string, TileId> = {
  '.': T.EMPTY,
  '#': T.GROUND,
  '=': T.BRICK,
  '?': T.QBIT,
  P: T.QPOWER,
  X: T.HARD,
  '-': T.ONEWAY,
  '^': T.SPIKE,
  '~': T.LIQUID,
  h: T.HIDDEN_BIT,
  H: T.HIDDEN_LIFE,
  B: T.MULTI,
  I: T.ICE,
  '>': T.CONV_R,
  '<': T.CONV_L,
  S: T.SWITCH,
  R: T.RED,
  U: T.BLUE,
  '1': T.BEAT_A,
  '2': T.BEAT_B,
  g: T.FLIP,
  '[': T.PIPE_TL,
  ']': T.PIPE_TR,
  '{': T.PIPE_L,
  '}': T.PIPE_R,
  W: T.WARP,
  o: T.BIT,
  '%': T.FAKE,
  ':': T.WATER,
  s: T.SPRING,
  G: T.GATE,
};

/** What a character becomes when its chunk is mirrored. */
export const MIRROR: Record<string, string> = {
  '>': '<',
  '<': '>',
  '[': ']',
  ']': '[',
  '{': '}',
  '}': '{',
};
