import { describe, expect, it } from 'vitest';

import { casePad, closeGame, CODE_LENGTH, codeStep, liftCase, openGame, pressCase, releaseCase } from './door.svelte';

const type = (keys: string[]) => keys.reduce((progress, key) => codeStep(progress, key), 0);
const CODE = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a'];

describe('the keyboard code', () => {
  it('opens on the whole code, with either case of letter', () => {
    expect(type(CODE)).toBe(CODE_LENGTH);
    expect(type([...CODE.slice(0, 8), 'B', 'A'])).toBe(CODE_LENGTH);
  });

  it('starts again after a wrong key, counting a fresh up', () => {
    expect(type(['ArrowUp', 'ArrowUp', 'x'])).toBe(0);
    expect(type(['ArrowUp', 'ArrowDown', ...CODE])).toBe(CODE_LENGTH);
    expect(type(CODE.slice(0, 9))).toBe(9);
    expect(type(['ArrowUp', ...CODE])).toBe(CODE_LENGTH);
  });
});

describe("the case's buttons", () => {
  it('closing the game forgets a finger whose lift never came, so it stays up in the next game', () => {
    openGame();
    pressCase(1, 'right');
    expect(casePad.right).toBe(true);
    // Finger 1's lift goes missing; the game closes and opens again.
    closeGame();
    openGame();
    pressCase(2, 'a');
    expect(casePad).toMatchObject({ right: false, a: true });
    liftCase(2);
    closeGame();
  });

  it('letting go (a pause, the page losing focus) forgets every finger, and a lift after it changes nothing', () => {
    openGame();
    pressCase(1, 'right');
    pressCase(2, 'b');
    releaseCase();
    expect(Object.values(casePad).some(Boolean)).toBe(false);
    pressCase(3, 'left');
    liftCase(1);
    expect(casePad).toMatchObject({ left: true, right: false, b: false });
    closeGame();
  });
});
