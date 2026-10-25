import { describe, expect, it } from 'vitest';

import type { FileRead } from '../../lib/api';
import { crumbs, fileLine, folderOf, humanSize, when } from './labels';

describe('humanSize', () => {
  it.each([
    [801, '801 B'],
    [2867, '2.8 KB'],
    [5_400_000, '5.1 MB'],
  ])('reads %i bytes as %s', (bytes, want) => {
    expect(humanSize(bytes)).toBe(want);
  });
});

describe('when', () => {
  const now = new Date(2026, 9, 16, 15, 0);
  const at = (date: Date) => Math.floor(date.getTime() / 1000);

  it('says today and yesterday with the time', () => {
    expect(when(at(new Date(2026, 9, 16, 11, 41)), now)).toBe('today 11:41');
    expect(when(at(new Date(2026, 9, 15, 9, 2)), now)).toBe('yesterday 09:02');
  });

  it('gives the date further back, and the year only when it differs', () => {
    expect(when(at(new Date(2026, 9, 7, 12, 0)), now)).toBe('Oct 7');
    expect(when(at(new Date(2025, 9, 7, 12, 0)), now)).toBe('Oct 7, 2025');
  });
});

describe('fileLine', () => {
  const file = (fields: Partial<FileRead>): FileRead => ({
    path: '~/app/install.sh',
    name: 'install.sh',
    folder: '~/app',
    size: 2867,
    modified: Math.floor(new Date(2026, 9, 16, 11, 41).getTime() / 1000),
    sensitive: false,
    kind: 'text',
    ...fields,
  });
  const now = new Date(2026, 9, 16, 15, 0);

  it('says what the file is, how long and how big', () => {
    expect(fileLine(file({ language: 'bash', lines: 61 }), now)).toBe('Shell script · 61 lines · 2.8 KB · today 11:41');
  });

  it('names images and other kinds', () => {
    expect(fileLine(file({ kind: 'image' }), now)).toBe('Image · 2.8 KB · today 11:41');
    expect(fileLine(file({ kind: 'binary', too_big: true }), now)).toBe('Large file · 2.8 KB · today 11:41');
    expect(fileLine(file({ language: null, lines: 1 }), now)).toBe('Text · 1 line · 2.8 KB · today 11:41');
  });
});

describe('crumbs and folders', () => {
  it('walks the folders down to the path', () => {
    expect(crumbs('~/Projects/laptop-remote')).toEqual([
      { label: '~', path: '~' },
      { label: 'Projects', path: '~/Projects' },
      { label: 'laptop-remote', path: '~/Projects/laptop-remote' },
    ]);
    expect(crumbs('~')).toEqual([{ label: '~', path: '~' }]);
  });

  it('finds the folder holding a file', () => {
    expect(folderOf('~/Projects/app/README.md')).toBe('~/Projects/app');
    expect(folderOf('~/notes.md')).toBe('~');
  });
});
