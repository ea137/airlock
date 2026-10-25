import { describe, expect, it } from 'vitest';

import { applyModifiers, arrowSequence, cdInto, COMMANDS, KEYS, type Mods, NO_MODS, tapModifier } from './keys';

describe('the key bar', () => {
  it('carries no folder of yours: those come from the laptop', () => {
    const sent = [...KEYS, ...COMMANDS].map((key) => ('send' in key ? key.send : ''));
    expect(sent.filter((text) => text.includes('cd ') || text.includes('/'))).toEqual(['/']);
  });
  it('goes into any folder, quotes and all', () => {
    expect(cdInto('/home/me/Projects/app')).toBe("cd '/home/me/Projects/app'\r");
    expect(cdInto("/home/me/Rust book's notes")).toBe("cd '/home/me/Rust book'\\''s notes'\r");
  });
});

describe('tapModifier', () => {
  it('turns on for one key, then off on the next tap', () => {
    const once = tapModifier(NO_MODS, 'ctrl', false);
    expect(once.ctrl).toBe('once');
    expect(tapModifier(once, 'ctrl', false).ctrl).toBe('off');
  });
  it('locks on a double tap and leaves the other modifier alone', () => {
    const locked = tapModifier({ ctrl: 'off', alt: 'once' }, 'ctrl', true);
    expect(locked).toEqual({ ctrl: 'locked', alt: 'once' });
  });
});

describe('applyModifiers', () => {
  const ctrl: Mods = { ctrl: 'once', alt: 'off' };

  it('leaves keys alone without modifiers', () => {
    expect(applyModifiers('c', NO_MODS)).toEqual({ data: 'c', mods: NO_MODS });
  });
  it('makes Ctrl+C and spends the one-key Ctrl', () => {
    expect(applyModifiers('c', ctrl)).toEqual({ data: '\x03', mods: NO_MODS });
    expect(applyModifiers('C', ctrl).data).toBe('\x03');
  });
  it('sends DEL for Ctrl+? and keeps a locked Ctrl on', () => {
    const locked: Mods = { ctrl: 'locked', alt: 'off' };
    expect(applyModifiers('?', locked)).toEqual({ data: '\x7f', mods: locked });
  });
  it('prefixes Escape for Alt, together with Ctrl', () => {
    expect(applyModifiers('b', { ctrl: 'off', alt: 'once' }).data).toBe('\x1bb');
    expect(applyModifiers('a', { ctrl: 'once', alt: 'once' }).data).toBe('\x1b\x01');
  });
  it('passes pastes and sequences through, keeping the modifier for the next key', () => {
    expect(applyModifiers('echo hi', ctrl)).toEqual({ data: 'echo hi', mods: ctrl });
  });
  it('leaves keys Ctrl has no code for, but still spends the modifier', () => {
    expect(applyModifiers('1', ctrl)).toEqual({ data: '1', mods: NO_MODS });
  });
});

describe('arrowSequence', () => {
  it('follows the cursor mode the program asked for', () => {
    expect(arrowSequence('up', NO_MODS, false).data).toBe('\x1b[A');
    expect(arrowSequence('up', NO_MODS, true).data).toBe('\x1bOA');
    expect(arrowSequence('left', NO_MODS, false).data).toBe('\x1b[D');
  });
  it('uses the xterm modifier form with Ctrl or Alt', () => {
    expect(arrowSequence('right', { ctrl: 'once', alt: 'off' }, true)).toEqual({ data: '\x1b[1;5C', mods: NO_MODS });
    expect(arrowSequence('down', { ctrl: 'off', alt: 'locked' }, false).data).toBe('\x1b[1;3B');
    expect(arrowSequence('up', { ctrl: 'once', alt: 'once' }, false).data).toBe('\x1b[1;7A');
  });
});
