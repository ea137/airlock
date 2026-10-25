import { describe, expect, it } from 'vitest';

import { applySgr, css, parseAnsi, PLAIN } from './ansi';

describe('a captured screen', () => {
  it('keeps plain text as one run', () => {
    expect(parseAnsi('hello\nworld')).toEqual([{ text: 'hello\nworld', style: PLAIN }]);
  });

  it('splits where the colour changes, and resets', () => {
    const runs = parseAnsi('a\x1b[31mred\x1b[0mb');
    expect(runs.map((run) => run.text)).toEqual(['a', 'red', 'b']);
    expect(runs[1]?.style.fg).toContain('--c-ansi-red');
    expect(runs[2]?.style.fg).toBeNull();
  });

  it('reads 256 and true colours, bold and dim', () => {
    const style = applySgr(applySgr(PLAIN, [1, 38, 5, 196]), [48, 2, 10, 20, 30, 2]);
    expect(style.bold).toBe(true);
    expect(style.dim).toBe(true);
    expect(style.fg).toBe('rgb(255 0 0)');
    expect(style.bg).toBe('rgb(10 20 30)');
    expect(css(style)).toContain('font-weight:700');
  });

  it('drops escapes that aren\'t colours', () => {
    expect(parseAnsi('\x1b[?25lab\x1b[2Kc\x1b(B').map((run) => run.text).join('')).toBe('abc');
  });
});
