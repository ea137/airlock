// What happened in a tick, for the sounds and the sparkle: a fixed list of
// (what, x, y, value) the play fills and the game reads after each tick.
// Nothing is allocated while playing.

export const EV = {
  JUMP: 1,
  STOMP: 2,
  BIT: 3,
  BUMP: 4,
  BREAK: 5,
  POWER: 6,
  GROW: 7,
  SHRINK: 8,
  HURT: 9,
  DIE: 10,
  KICK: 11,
  SPRING: 12,
  KEY: 13,
  LIFE: 14,
  CHECK: 15,
  FLAG: 16,
  BOSS_HIT: 17,
  BOSS_DIE: 18,
  SHOOT: 19,
  SWITCH: 20,
  PIPE: 21,
  SPLASH: 22,
  SHAKE: 23,
  LAND: 24,
  SKID: 25,
  SWIM: 26,
  ITEM: 27,
  BEAT: 28,
  CLEAR: 29,
  GAME_OVER: 30,
  BOSS_START: 31,
  SECRET: 32,
  LOCK: 33,
  FLAP: 34,
  SCORE: 35,
  KILL: 36,
  RESPAWN: 37,
  BOSS_LAND: 38,
} as const;

const CAPACITY = 128;

export const EVENT_STRIDE = 4;

export class Events {
  readonly data = new Int32Array(CAPACITY * EVENT_STRIDE);
  count = 0;

  push(what: number, x = 0, y = 0, value = 0): void {
    if (this.count >= CAPACITY) return;
    const at = this.count * EVENT_STRIDE;
    this.data[at] = what;
    this.data[at + 1] = Math.round(x);
    this.data[at + 2] = Math.round(y);
    this.data[at + 3] = Math.round(value);
    this.count += 1;
  }

  clear(): void {
    this.count = 0;
  }
}
