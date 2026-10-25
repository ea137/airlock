import { describe, expect, it } from 'vitest';

import { ago, spacedCode } from './format';

describe('spacedCode', () => {
  it('splits a pairing code in two halves', () => {
    expect(spacedCode('421946')).toBe('421 946');
  });
});

describe('ago', () => {
  const now = 1_800_000_000;

  it.each([
    [now, 'just now'],
    [now - 9, 'just now'],
    [now - 42, '42s ago'],
    [now - 5 * 60, '5m ago'],
    [now - 3 * 3600 - 59, '3h ago'],
    [now - 2 * 86_400, '2d ago'],
  ])('reads %i as %s', (at, want) => {
    expect(ago(at, now)).toBe(want);
  });

  it('treats a time ahead of the clock as now', () => {
    expect(ago(now + 30, now)).toBe('just now');
  });
});
