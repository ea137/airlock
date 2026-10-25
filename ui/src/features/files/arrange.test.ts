import { describe, expect, it } from 'vitest';

import type { FileEntry } from '../../lib/api';
import { arrange, fileType, hasThumbnail, parseArrangement, THUMBNAIL_MAX_BYTES } from './arrange';

const entry = (name: string, fields: Partial<FileEntry> = {}): FileEntry => ({
  name,
  path: `~/notes/${name}`,
  kind: 'file',
  size: 100,
  modified: 1_000,
  items: null,
  sensitive: false,
  ...fields,
});

const names = (entries: FileEntry[]) => entries.map((item) => item.name);

describe('fileType', () => {
  it.each([
    ['photo.JPG', 'image'],
    ['main.rs', 'code'],
    ['README.md', 'text'],
    ['Makefile', 'code'],
    ['backup.tar.gz', 'archive'],
    ['invoice.pdf', 'pdf'],
    ['.bashrc', 'other'],
    ['data', 'other'],
  ] as const)('reads %s as %s', (name, want) => {
    expect(fileType(entry(name))).toBe(want);
  });

  it('calls a folder a folder whatever its name', () => {
    expect(fileType(entry('photos.png', { kind: 'dir' }))).toBe('folder');
  });
});

describe('arrange', () => {
  const folder = entry('src', { kind: 'dir', items: 4, modified: 500 });
  const files = [
    entry('file10.txt', { size: 10, modified: 3_000 }),
    entry('File2.txt', { size: 900, modified: 2_000 }),
    entry('logo.png', { size: 50, modified: 1_000 }),
  ];

  it('puts folders first, then names in natural order, case aside', () => {
    expect(names(arrange([...files, folder], 'a-z'))).toEqual(['src', 'File2.txt', 'file10.txt', 'logo.png']);
    expect(names(arrange([...files, folder], 'z-a'))).toEqual(['src', 'logo.png', 'file10.txt', 'File2.txt']);
  });

  it('sorts by when each was last changed, either way', () => {
    expect(names(arrange(files, 'newest'))).toEqual(['file10.txt', 'File2.txt', 'logo.png']);
    expect(names(arrange(files, 'oldest'))).toEqual(['logo.png', 'File2.txt', 'file10.txt']);
  });

  it('sorts by size, biggest first, and by type name', () => {
    expect(names(arrange(files, 'size'))).toEqual(['File2.txt', 'logo.png', 'file10.txt']);
    expect(names(arrange(files, 'type'))).toEqual(['logo.png', 'File2.txt', 'file10.txt']);
  });

  it('leaves the folder it was given as it was', () => {
    const given = [...files];
    arrange(given, 'size');
    expect(given).toEqual(files);
  });
});

describe('hasThumbnail', () => {
  it('shows small images, not big or secret ones or other files', () => {
    expect(hasThumbnail(entry('logo.png'))).toBe(true);
    expect(hasThumbnail(entry('scan.png', { size: THUMBNAIL_MAX_BYTES + 1 }))).toBe(false);
    expect(hasThumbnail(entry('key.png', { sensitive: true }))).toBe(false);
    expect(hasThumbnail(entry('notes.txt'))).toBe(false);
  });
});

describe('parseArrangement', () => {
  it('reads what was saved', () => {
    expect(parseArrangement('{"view":"grid","order":"newest"}')).toEqual({ view: 'grid', order: 'newest' });
  });

  it.each([null, '', 'not json', '{"view":"tiles","order":"random"}', '[]'])(
    'falls back to a list by name for %j',
    (text) => {
      expect(parseArrangement(text)).toEqual({ view: 'list', order: 'a-z' });
    },
  );
});
