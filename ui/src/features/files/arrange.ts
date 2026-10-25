// How a folder is laid out, as Ubuntu's Files app does it: a list or a grid,
// folders first, in the order you picked, with each file's type from its
// name.

import type { FileEntry } from '../../lib/api';

export type FileType =
  | 'folder'
  | 'image'
  | 'video'
  | 'audio'
  | 'archive'
  | 'pdf'
  | 'document'
  | 'spreadsheet'
  | 'code'
  | 'text'
  | 'other';

const BY_EXTENSION: Record<string, FileType> = {};
for (const [type, extensions] of [
  ['image', 'png jpg jpeg gif webp svg bmp ico avif heic tiff'],
  ['video', 'mp4 mov mkv webm avi m4v'],
  ['audio', 'mp3 wav flac ogg m4a opus aac'],
  ['archive', 'zip tar gz tgz xz bz2 zst 7z rar deb rpm'],
  ['pdf', 'pdf'],
  ['document', 'doc docx odt rtf pages epub'],
  ['spreadsheet', 'xls xlsx ods csv tsv numbers'],
  [
    'code',
    'rs ts tsx js jsx mjs cjs svelte vue py go rb java kt c h cpp hpp cs swift php sh bash zsh fish sql html htm css scss json toml yaml yml xml lua',
  ],
  ['text', 'md markdown mdx txt log ini conf cfg env lock'],
] as const) {
  for (const extension of extensions.split(' ')) BY_EXTENSION[extension] = type;
}

const BY_NAME: Record<string, FileType> = {
  dockerfile: 'code',
  makefile: 'code',
  license: 'text',
  readme: 'text',
};

/** What a file is, from its name: `photo.JPG` is an image. */
export function fileType(entry: Pick<FileEntry, 'name' | 'kind'>): FileType {
  if (entry.kind === 'dir') return 'folder';
  const name = entry.name.toLowerCase();
  const dot = name.lastIndexOf('.');
  if (dot > 0) return BY_EXTENSION[name.slice(dot + 1)] ?? 'other';
  return BY_NAME[name] ?? 'other';
}

export const TYPE_NAMES: Record<FileType, string> = {
  folder: 'Folder',
  image: 'Image',
  video: 'Video',
  audio: 'Audio',
  archive: 'Archive',
  pdf: 'PDF',
  document: 'Document',
  spreadsheet: 'Spreadsheet',
  code: 'Code',
  text: 'Text',
  other: 'File',
};

export type SortOrder = 'a-z' | 'z-a' | 'newest' | 'oldest' | 'size' | 'type';

/** The orders, in the words of Ubuntu's Files menu. */
export const SORT_ORDERS: readonly { value: SortOrder; label: string }[] = [
  { value: 'a-z', label: 'A–Z' },
  { value: 'z-a', label: 'Z–A' },
  { value: 'newest', label: 'Last modified' },
  { value: 'oldest', label: 'First modified' },
  { value: 'size', label: 'Size' },
  { value: 'type', label: 'Type' },
];

export type FolderView = 'list' | 'grid';

/** `file2` before `file10`, and case doesn't matter. */
const byName = (a: FileEntry, b: FileEntry) =>
  a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });

/** How big an entry is: a folder by its items, a file by its bytes. */
const bulk = (entry: FileEntry) => (entry.kind === 'dir' ? (entry.items ?? 0) : entry.size);

const ORDERS: Record<SortOrder, (a: FileEntry, b: FileEntry) => number> = {
  'a-z': byName,
  'z-a': (a, b) => byName(b, a),
  newest: (a, b) => b.modified - a.modified || byName(a, b),
  oldest: (a, b) => a.modified - b.modified || byName(a, b),
  size: (a, b) => bulk(b) - bulk(a) || byName(a, b),
  type: (a, b) => TYPE_NAMES[fileType(a)].localeCompare(TYPE_NAMES[fileType(b)]) || byName(a, b),
};

export function arrange(entries: readonly FileEntry[], order: SortOrder): FileEntry[] {
  const compare = ORDERS[order];
  return [...entries].sort((a, b) => Number(b.kind === 'dir') - Number(a.kind === 'dir') || compare(a, b));
}

/** Images this small get a thumbnail in the grid; bigger ones, an icon. */
export const THUMBNAIL_MAX_BYTES = 3 * 1024 * 1024;

export function hasThumbnail(entry: FileEntry): boolean {
  return fileType(entry) === 'image' && entry.size <= THUMBNAIL_MAX_BYTES && !entry.sensitive;
}

export type Arrangement = { view: FolderView; order: SortOrder };

export const DEFAULT_ARRANGEMENT: Arrangement = { view: 'list', order: 'a-z' };

/** A saved arrangement, as stored; anything missing or unknown is the default. */
export function parseArrangement(text: string | null): Arrangement {
  try {
    const saved: unknown = JSON.parse(text ?? 'null');
    const fields = saved && typeof saved === 'object' ? (saved as Record<string, unknown>) : {};
    const view = fields.view === 'grid' || fields.view === 'list' ? fields.view : DEFAULT_ARRANGEMENT.view;
    const order = SORT_ORDERS.find((known) => known.value === fields.order)?.value ?? DEFAULT_ARRANGEMENT.order;
    return { view, order };
  } catch {
    return { ...DEFAULT_ARRANGEMENT };
  }
}
