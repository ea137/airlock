import { describe, expect, it } from 'vitest';

import { SECTION_LINKS } from '../sections';
import { banner } from './banner';

describe('banner', () => {
  it('draws a word five rows high, a column between letters', () => {
    expect(banner('it')).toEqual(['█████ █████', '  █     █  ', '  █     █  ', '  █     █  ', '█████   █  ']);
  });

  it.each(SECTION_LINKS.map((section) => section.label))('has every letter of %s', (label) => {
    const rows = banner(label);
    // A blank glyph would leave a letter-wide gap of spaces in every row.
    const columns = label.length * 6 - 1;
    for (let start = 0; start < columns; start += 6) {
      expect(rows.some((row) => row.slice(start, start + 5).trim() !== '')).toBe(true);
    }
  });
});
