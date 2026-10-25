import { describe, expect, it } from 'vitest';

import { Fingers, type Key, Keys, Merge, MIN_PRESS_MS, noButtons } from './input';

/** A key as the browser reports it, by what it types and where it is. */
function key(typed: string, code: string, mods: Partial<Key> = {}): Key {
  return { key: typed, code, metaKey: false, ctrlKey: false, altKey: false, ...mods };
}

describe('merging the sources', () => {
  it('of left and right held at once, the one pressed last counts, and letting go of it hands back', () => {
    const keys = noButtons();
    const touch = noButtons();
    const merge = new Merge([keys, touch, noButtons()]);
    const out = noButtons();

    touch.right = true;
    merge.into(out);
    expect(out).toMatchObject({ left: false, right: true });
    // Right still held on the screen, left on the keys takes over.
    keys.left = true;
    merge.into(out);
    expect(out).toMatchObject({ left: true, right: false });
    merge.into(out);
    expect(out).toMatchObject({ left: true, right: false });
    keys.left = false;
    merge.into(out);
    expect(out).toMatchObject({ left: false, right: true });
  });

  it('a direction pressed again from another source takes over again', () => {
    const keys = noButtons();
    const touch = noButtons();
    const merge = new Merge([keys, touch]);
    const out = noButtons();

    touch.right = true;
    merge.into(out);
    touch.left = true;
    merge.into(out);
    expect(out).toMatchObject({ left: true, right: false });
    // Right was down on the screen all along; pressed on the keys, it's the latest.
    keys.right = true;
    merge.into(out);
    expect(out).toMatchObject({ left: false, right: true });
  });
});

describe('the keys', () => {
  it('let go of what they pressed, even when what they type changed in between', () => {
    const buttons = noButtons();
    const keys = new Keys(buttons);

    expect(keys.down(key('d', 'KeyD'))).toBe(true);
    expect(buttons.right).toBe(true);
    keys.seen();
    // Option held before letting go: the Mac types ∂.
    keys.up(key('∂', 'KeyD', { altKey: true }));
    expect(buttons.right).toBe(false);
  });

  it('two keys on one button: letting go of one leaves it down', () => {
    const buttons = noButtons();
    const keys = new Keys(buttons);

    keys.down(key('ArrowRight', 'ArrowRight'));
    keys.down(key('d', 'KeyD'));
    keys.seen();
    keys.up(key('d', 'KeyD'));
    expect(buttons.right).toBe(true);
    keys.up(key('ArrowRight', 'ArrowRight'));
    expect(buttons.right).toBe(false);
  });

  it("don't take a shortcut as a press, and letting go of ⌘ lets go of every key", () => {
    const buttons = noButtons();
    const keys = new Keys(buttons);

    // ⌘D: the Mac sends no release for the D.
    expect(keys.down(key('d', 'KeyD', { metaKey: true }))).toBe(false);
    expect(buttons.right).toBe(false);
    // Right held, ⌘ pressed, right let go while ⌘ is down (no release comes), then ⌘.
    keys.down(key('ArrowRight', 'ArrowRight'));
    keys.seen();
    keys.up(key('Meta', 'MetaLeft'));
    expect(buttons.right).toBe(false);
  });

  it('let go of everything when told to, and a key repeating after that presses again', () => {
    const buttons = noButtons();
    const keys = new Keys(buttons);

    keys.down(key('ArrowRight', 'ArrowRight'));
    keys.down(key('Shift', 'ShiftLeft'));
    keys.letGo();
    expect(buttons).toEqual(noButtons());
    keys.down(key('ArrowRight', 'ArrowRight'));
    expect(buttons.right).toBe(true);
  });

  it('a key let go before the game looked still counts as one press, on its next tick, exactly once', () => {
    const buttons = noButtons();
    const keys = new Keys(buttons);
    const merge = new Merge([buttons]);
    const out = noButtons();
    let presses = 0;
    /** One of the game's ticks: it looks, then the keys hear it has. */
    const tick = () => {
      const was = out.a;
      merge.into(out);
      keys.seen();
      if (out.a && !was) presses += 1;
    };
    tick();
    // Down and up within one frame.
    keys.down(key('z', 'KeyZ'));
    keys.up(key('z', 'KeyZ'));
    tick();
    expect(out.a).toBe(true);
    for (let i = 0; i < 5; i += 1) tick();
    expect(out.a).toBe(false);
    expect(presses).toBe(1);
    // Held across ticks, a key still goes up the moment it's let go.
    keys.down(key('ArrowLeft', 'ArrowLeft'));
    tick();
    tick();
    keys.up(key('ArrowLeft', 'ArrowLeft'));
    expect(buttons.left).toBe(false);
  });
});

describe('the fingers on the on-screen buttons', () => {
  const NAMES = ['left', 'down', 'right', 'b', 'a'] as const;

  it('let go at once when told to, however short the press, and nothing presses again after', () => {
    const buttons = noButtons();
    const fingers = new Fingers(buttons, NAMES);

    fingers.down(1, new Set(['right']), 1000);
    fingers.down(2, new Set(['a']), 1000);
    expect(fingers.up(2, 1010)).toBe(MIN_PRESS_MS - 10);
    expect(buttons).toMatchObject({ right: true, a: true });
    fingers.letGo();
    expect(buttons).toEqual(noButtons());
    // The short press's let-go comes due, and finger 1 moves: neither presses anything.
    expect(fingers.sync(1000 + MIN_PRESS_MS)).toBe(0);
    fingers.move(1, new Set(['left']), 1100);
    expect(buttons).toEqual(noButtons());
  });
});
