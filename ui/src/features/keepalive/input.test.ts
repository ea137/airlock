import { describe, expect, it } from 'vitest';

import { Controls, emptyFrame } from './input';

const UP = 0;
const RIGHT = 1;
const LEFT = 3;

describe('the controls', () => {
  it('holds a button while any source holds it', () => {
    const c = new Controls();
    c.press('ptr:1', 'a');
    c.press('key:KeyZ', 'a');
    c.release('ptr:1');
    expect(c.held('a')).toBe(true);
    c.release('key:KeyZ');
    expect(c.held('a')).toBe(false);
  });

  it('moves the newest direction pressed, and falls back to the one before when it lets go', () => {
    const c = new Controls();
    c.press('key:ArrowLeft', 'left');
    c.press('ptr:7', 'up');
    expect(c.direction()).toBe(UP);
    c.release('ptr:7');
    expect(c.direction()).toBe(LEFT);
    c.release('key:ArrowLeft');
    // Both let go: the last frame still sees the tap, the next one nothing.
    const f = emptyFrame();
    c.read(f);
    expect(c.read(f).dir).toBe(-1);
  });

  it('follows a thumb sliding round the D-pad, one pointer holding one arrow', () => {
    const c = new Controls();
    c.press('ptr:3', 'left');
    c.press('ptr:3', 'up');
    expect(c.held('left')).toBe(false);
    expect(c.direction()).toBe(UP);
  });

  it('keeps each pointer apart: one finger lifting leaves the other held', () => {
    const c = new Controls();
    c.press('ptr:1', 'right');
    c.press('ptr:2', 'a');
    c.release('ptr:2');
    expect(c.direction()).toBe(RIGHT);
    expect(c.held('a')).toBe(false);
  });

  it('counts a tap that starts and ends between two frames', () => {
    const c = new Controls();
    const f = emptyFrame();
    c.press('ptr:1', 'b');
    c.release('ptr:1');
    c.read(f);
    expect(f.pressed.b).toBe(true);
    expect(f.b).toBe(false);
    c.read(f);
    expect(f.pressed.b).toBe(false);
  });

  it('a tapped direction moves for one frame', () => {
    const c = new Controls();
    const f = emptyFrame();
    c.press('key:ArrowRight', 'right');
    c.release('key:ArrowRight');
    expect(c.read(f).dir).toBe(RIGHT);
    expect(c.read(f).dir).toBe(-1);
  });

  it('a cancelled touch (pointercancel, lost capture) releases only that finger, and is no tap', () => {
    const c = new Controls();
    const f = emptyFrame();
    c.press('ptr:1', 'left');
    c.press('ptr:2', 'a');
    c.cancel('ptr:1');
    expect(c.direction()).toBe(-1);
    expect(c.held('a')).toBe(true);
    c.read(f);
    expect(f.dir).toBe(-1);
    expect(f.pressed.left).toBe(false);
  });

  it('blur, hiding, pausing or closing lets go of everything, keys and fingers and case', () => {
    const c = new Controls();
    const f = emptyFrame();
    c.press('key:ArrowUp', 'up');
    c.press('ptr:4', 'a');
    c.press('case:left', 'left');
    c.clear();
    expect(c.busy).toBe(false);
    c.read(f);
    expect(f.dir).toBe(-1);
    expect(f.pressed.a).toBe(false);
    expect(f.up || f.a || f.left).toBe(false);
  });

  it('a key up that never came (lost while the window was away) is cleared by the blur', () => {
    const c = new Controls();
    c.press('key:ArrowRight', 'right');
    // The window loses focus; the keyup goes elsewhere.
    c.clear();
    const f = emptyFrame();
    c.read(f);
    expect(f.right).toBe(false);
    expect(f.dir).toBe(-1);
  });

  it('releases one kind of source at once', () => {
    const c = new Controls();
    c.press('ptr:1', 'left');
    c.press('ptr:2', 'b');
    c.press('key:KeyZ', 'a');
    c.releaseAll('ptr:');
    expect(c.held('left') || c.held('b')).toBe(false);
    expect(c.held('a')).toBe(true);
  });
});
