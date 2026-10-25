// The words the files screens use: sizes, dates, kinds, and the folder path.

import type { FileRead } from '../../lib/api';

/** `2.8 KB`, `801 B`. */
export function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1_048_576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}

/** `today 11:41`, `yesterday 09:02`, `Oct 7`, or `Oct 7, 2025` in another year. */
export function when(seconds: number, now: Date = new Date()): string {
  const date = new Date(seconds * 1000);
  const time = date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((day(now) - day(date)) / 86_400_000);
  if (days === 0) return `today ${time}`;
  if (days === 1) return `yesterday ${time}`;
  const options: Intl.DateTimeFormatOptions =
    date.getFullYear() === now.getFullYear()
      ? { month: 'short', day: 'numeric' }
      : { month: 'short', day: 'numeric', year: 'numeric' };
  return date.toLocaleDateString('en-US', options);
}

const KINDS: Record<string, string> = {
  bash: 'Shell script',
  rust: 'Rust',
  typescript: 'TypeScript',
  javascript: 'JavaScript',
  xml: 'Markup',
  json: 'JSON',
  ini: 'Settings',
  yaml: 'YAML',
  python: 'Python',
  go: 'Go',
  css: 'CSS',
  markdown: 'Markdown',
  sql: 'SQL',
  diff: 'Diff',
  java: 'Java',
  c: 'C',
  cpp: 'C++',
  ruby: 'Ruby',
  dockerfile: 'Dockerfile',
  makefile: 'Makefile',
};

/** `Shell script · 61 lines · 2.8 KB · today 11:41`. */
export function fileLine(file: FileRead, now: Date = new Date()): string {
  const parts: string[] = [];
  if (file.kind === 'image') parts.push('Image');
  else if (file.kind === 'html') parts.push('Web page');
  else if (file.kind === 'binary') parts.push(file.too_big ? 'Large file' : 'Binary file');
  else parts.push(KINDS[file.language ?? ''] ?? 'Text');
  if (file.lines !== undefined) parts.push(`${file.lines} ${file.lines === 1 ? 'line' : 'lines'}`);
  parts.push(humanSize(file.size), when(file.modified, now));
  return parts.join(' · ');
}

/** The folders leading to `path`: `~`, `Projects`, `laptop-remote`. */
export function crumbs(path: string): { label: string; path: string }[] {
  const trail = [{ label: '~', path: '~' }];
  if (path === '~' || !path.startsWith('~/')) return trail;
  let sofar = '~';
  for (const part of path.slice(2).split('/').filter(Boolean)) {
    sofar = `${sofar}/${part}`;
    trail.push({ label: part, path: sofar });
  }
  return trail;
}

export function folderOf(path: string): string {
  const cut = path.lastIndexOf('/');
  return cut <= 1 ? '~' : path.slice(0, cut);
}
