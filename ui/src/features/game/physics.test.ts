import { describe, expect, it } from 'vitest';

import { BASE, Body, emptyPad, type Grid, type Pad, StepEvents, stepBody } from './physics';
import { T, TILE } from './tiles';

/** A room 60 tiles wide with a floor at row 15, and whatever else is put in. */
function room(extra: (tiles: Uint8Array, w: number) => void = () => {}): Grid {
  const w = 60;
  const h = 18;
  const tiles = new Uint8Array(w * h);
  for (let x = 0; x < w; x += 1) for (let y = 15; y < h; y += 1) tiles[y * w + x] = T.GROUND;
  extra(tiles, w);
  return { w, h, tiles, switchOn: true, beat: 0, waterLine: -1, hazards: false, platforms: new Float32Array(0), platformCount: 0 };
}

function standing(g: Grid, tx = 5): Body {
  const b = new Body();
  b.x = tx * TILE + 1;
  b.y = 15 * TILE - b.h;
  const pad = emptyPad();
  const ev = new StepEvents();
  stepBody(b, pad, BASE, g, ev);
  return b;
}

/** Runs ticks with a pad set up by `drive`, and returns the highest the feet got and where they ended. */
function run(g: Grid, b: Body, ticks: number, drive: (pad: Pad, tick: number) => void) {
  const pad = emptyPad();
  const ev = new StepEvents();
  const ground = b.y + b.h;
  let peak = 0;
  let jumped = 0;
  for (let tick = 0; tick < ticks; tick += 1) {
    drive(pad, tick);
    stepBody(b, pad, BASE, g, ev);
    if (ev.jumped) jumped += 1;
    peak = Math.max(peak, ground - (b.y + b.h));
  }
  return { peak: peak / TILE, jumped };
}

describe('the jump', () => {
  it('goes about four and a half tiles high when held', () => {
    const g = room();
    const b = standing(g);
    const { peak } = run(g, b, 60, (pad, tick) => {
      pad.jump = true;
      pad.jumpPressed = tick === 0;
    });
    expect(peak).toBeGreaterThan(4.2);
    expect(peak).toBeLessThan(4.9);
  });

  it('is a short hop when let go at once', () => {
    const g = room();
    const b = standing(g);
    const { peak } = run(g, b, 60, (pad, tick) => {
      pad.jump = tick < 2;
      pad.jumpPressed = tick === 0;
    });
    expect(peak).toBeGreaterThan(1.2);
    expect(peak).toBeLessThan(2.2);
  });

  it('carries further from a run than from a walk', () => {
    const distance = (runHeld: boolean) => {
      const g = room();
      const b = standing(g, 2);
      // Build up speed, then jump and keep going until landing.
      run(g, b, 60, (pad) => {
        pad.right = true;
        pad.run = runHeld;
      });
      const from = b.x;
      const pad = emptyPad();
      const ev = new StepEvents();
      pad.right = true;
      pad.run = runHeld;
      pad.jump = true;
      pad.jumpPressed = true;
      for (let tick = 0; tick < 120; tick += 1) {
        stepBody(b, pad, BASE, g, ev);
        pad.jumpPressed = false;
        if (ev.landed) break;
      }
      return (b.x - from) / TILE;
    };
    const walk = distance(false);
    const sprint = distance(true);
    expect(walk).toBeGreaterThan(4);
    expect(sprint).toBeGreaterThan(walk + 2);
    expect(sprint).toBeGreaterThan(7);
  });

  it('still jumps a few ticks after running off a ledge (coyote time)', () => {
    // Floor only up to column 8.
    const g = room((tiles, w) => {
      for (let x = 9; x < w; x += 1) for (let y = 15; y < 18; y += 1) tiles[y * w + x] = T.EMPTY;
    });
    const b = standing(g, 7);
    let leftAt = -1;
    const pad = emptyPad();
    const ev = new StepEvents();
    let jumped = false;
    for (let tick = 0; tick < 80 && !jumped; tick += 1) {
      pad.right = true;
      if (leftAt < 0 && !b.onGround) leftAt = tick;
      pad.jumpPressed = leftAt >= 0 && tick === leftAt + 4;
      pad.jump = pad.jumpPressed;
      stepBody(b, pad, BASE, g, ev);
      jumped = ev.jumped;
    }
    expect(jumped).toBe(true);
  });

  it('remembers a jump pressed just before landing (buffer)', () => {
    const g = room();
    const b = new Body();
    b.x = 40;
    b.y = 15 * TILE - b.h - 30;
    const pad = emptyPad();
    const ev = new StepEvents();
    let pressed = false;
    let jumpedAfterLanding = false;
    for (let tick = 0; tick < 80; tick += 1) {
      // Press while still a few pixels up.
      const height = 15 * TILE - (b.y + b.h);
      pad.jumpPressed = !pressed && height < 6 && height > 1;
      if (pad.jumpPressed) pressed = true;
      pad.jump = pressed;
      stepBody(b, pad, BASE, g, ev);
      if (ev.jumped) jumpedAfterLanding = true;
    }
    expect(pressed).toBe(true);
    expect(jumpedAfterLanding).toBe(true);
  });

  it('slides a head that clips a block corner past it', () => {
    // A block at column 6, three tiles up; the body starts 2px under its left edge.
    const g = room((tiles, w) => {
      tiles[11 * w + 6] = T.HARD;
    });
    const b = standing(g, 5);
    b.x = 6 * TILE - b.w + 2;
    const { peak } = run(g, b, 40, (pad, tick) => {
      pad.jump = true;
      pad.jumpPressed = tick === 0;
    });
    expect(peak).toBeGreaterThan(4);
  });

  it('stops dead at a bonk and reports the block', () => {
    const g = room((tiles, w) => {
      tiles[11 * w + 5] = T.QBIT;
    });
    const b = standing(g, 5);
    const pad = emptyPad();
    const ev = new StepEvents();
    let bumped: [number, number] | null = null;
    for (let tick = 0; tick < 30 && !bumped; tick += 1) {
      pad.jump = true;
      pad.jumpPressed = tick === 0;
      stepBody(b, pad, BASE, g, ev);
      if (ev.bumpTx >= 0) bumped = [ev.bumpTx, ev.bumpTy];
    }
    expect(bumped).toEqual([5, 11]);
  });
});

describe('the ground', () => {
  it('slides on ice', () => {
    const stopping = (tile: number) => {
      const g = room((tiles, w) => {
        for (let x = 0; x < w; x += 1) tiles[15 * w + x] = tile;
      });
      const b = standing(g, 2);
      run(g, b, 80, (pad) => {
        pad.right = true;
      });
      const from = b.x;
      run(g, b, 120, () => {});
      return b.x - from;
    };
    expect(stopping(T.ICE)).toBeGreaterThan(stopping(T.GROUND) * 4);
  });

  it('carries the packet along a conveyor', () => {
    const g = room((tiles, w) => {
      for (let x = 0; x < w; x += 1) tiles[15 * w + x] = T.CONV_R;
    });
    const b = standing(g, 5);
    const from = b.x;
    run(g, b, 60, () => {});
    expect(b.x - from).toBeGreaterThan(30);
  });

  it('bounces high off a spring', () => {
    const g = room((tiles, w) => {
      tiles[15 * w + 5] = T.SPRING;
    });
    const b = new Body();
    b.x = 5 * TILE + 1;
    b.y = 10 * TILE;
    const { peak } = run(g, b, 90, (pad) => {
      pad.jump = true;
    });
    expect(peak).toBeGreaterThan(5);
  });
});
