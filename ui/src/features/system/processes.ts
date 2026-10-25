// The Processes tab's logic: which processes show, in what order, and an
// app's helpers grouped under it.

import type { ProcessKind, ProcessRow } from '../../lib/api';

export type Sort = 'cpu' | 'memory' | 'name' | 'newest';
export type KindFilter = ProcessKind | 'all';

export type ProcessFilter = {
  kind: KindFilter;
  /** Only your own processes. */
  mine: boolean;
  /** Matched against the name, app, command and process number. */
  words: string;
  sort: Sort;
};

/** The kinds as the filter chips name them, in their order. */
export const KINDS: { id: KindFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'app', label: 'Apps' },
  { id: 'dev', label: 'Dev servers' },
  { id: 'terminal', label: 'Terminals' },
  { id: 'service', label: 'Services' },
  { id: 'desktop', label: 'Desktop' },
  { id: 'system', label: 'System' },
  { id: 'other', label: 'Other' },
];

export function matches(row: ProcessRow, filter: ProcessFilter): boolean {
  if (filter.mine && !row.mine) return false;
  if (filter.kind !== 'all' && row.kind !== filter.kind) return false;
  const words = filter.words.trim().toLowerCase();
  if (!words) return true;
  return [row.name, row.app ?? '', row.command, String(row.pid), row.user].some((text) =>
    text.toLowerCase().includes(words),
  );
}

function compare(sort: Sort): (a: { cpu: number; memory: number; name: string; age: number }, b: typeof a) => number {
  switch (sort) {
    case 'cpu':
      return (a, b) => b.cpu - a.cpu || b.memory - a.memory;
    case 'memory':
      return (a, b) => b.memory - a.memory || b.cpu - a.cpu;
    case 'name':
      return (a, b) => a.name.localeCompare(b.name);
    case 'newest':
      return (a, b) => a.age - b.age;
  }
}

const measure = (row: ProcessRow) => ({ cpu: row.cpu ?? 0, memory: row.memory, name: row.name, age: row.running_for });

export function filterProcesses(rows: ProcessRow[], filter: ProcessFilter): ProcessRow[] {
  const order = compare(filter.sort);
  return rows.filter((row) => matches(row, filter)).sort((a, b) => order(measure(a), measure(b)));
}

/** An app and its helpers, added up; a process without an app is its own. */
export type AppGroup = {
  key: string;
  name: string;
  rows: ProcessRow[];
  cpu: number;
  memory: number;
  /** CPU over the last looks, added up across the group. */
  history: number[];
};

export function groupByApp(rows: ProcessRow[], sort: Sort): AppGroup[] {
  const groups = new Map<string, AppGroup>();
  for (const row of rows) {
    const key = row.app ? `app:${row.app}` : `pid:${row.pid}`;
    const group = groups.get(key) ?? { key, name: row.app ?? row.name, rows: [], cpu: 0, memory: 0, history: [] };
    group.rows.push(row);
    group.cpu += row.cpu ?? 0;
    group.memory += row.memory;
    // Line the histories up by their latest look.
    const offset = group.history.length - row.cpu_history.length;
    if (offset < 0) group.history = [...new Array<number>(-offset).fill(0), ...group.history];
    row.cpu_history.forEach((share, index) => {
      const at = Math.max(0, offset) + index;
      group.history[at] = (group.history[at] ?? 0) + share;
    });
    groups.set(key, group);
  }
  const order = compare(sort);
  const age = (group: AppGroup) => Math.min(...group.rows.map((row) => row.running_for));
  return [...groups.values()].sort((a, b) =>
    order({ cpu: a.cpu, memory: a.memory, name: a.name, age: age(a) }, { cpu: b.cpu, memory: b.memory, name: b.name, age: age(b) }),
  );
}

/** How many processes of each kind pass the other filters. */
export function kindCounts(rows: ProcessRow[], filter: ProcessFilter): Record<KindFilter, number> {
  const counts: Record<KindFilter, number> = { all: 0, app: 0, dev: 0, terminal: 0, service: 0, desktop: 0, system: 0, other: 0 };
  for (const row of rows) {
    if (!matches(row, { ...filter, kind: 'all' })) continue;
    counts.all += 1;
    counts[row.kind] += 1;
  }
  return counts;
}

/** A share of a core as the list shows it: `12%`, `0.4%`, `—` before the second look. */
export function percent(share: number | null): string {
  if (share === null) return '—';
  if (share > 0 && share < 1) return `${share.toFixed(1)}%`;
  return `${Math.round(share)}%`;
}
