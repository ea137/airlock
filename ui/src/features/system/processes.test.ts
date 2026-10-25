import { describe, expect, it } from 'vitest';

import type { ProcessRow } from '../../lib/api';
import { filterProcesses, groupByApp, kindCounts, percent, type ProcessFilter } from './processes';

const row = (fields: Partial<ProcessRow>): ProcessRow => ({
  pid: 100,
  ppid: 1,
  started: 5,
  name: 'vite',
  program: 'node',
  command: 'node /home/me/Projects/site/node_modules/.bin/vite',
  user: 'me',
  mine: true,
  state: 'sleeping',
  threads: 7,
  nice: 0,
  cpu: 0,
  cpu_history: [],
  memory: 100_000_000,
  running_for: 600,
  cwd: '/home/me/Projects/site',
  ports: [5173],
  terminal: null,
  unit: null,
  app: null,
  kind: 'dev',
  about: null,
  keep: null,
  ...fields,
});

const rows = [
  row({ pid: 1, name: 'vite', cpu: 3, memory: 90_000_000 }),
  row({ pid: 2, name: 'chrome renderer', app: 'Google Chrome', kind: 'app', cpu: 10, cpu_history: [1, 2] }),
  row({ pid: 3, name: 'chrome gpu process', app: 'Google Chrome', kind: 'app', cpu: 5, cpu_history: [4] }),
  row({ pid: 4, name: 'postgres', kind: 'system', mine: false, user: 'postgres', cpu: 1, running_for: 30 }),
];

const all: ProcessFilter = { kind: 'all', mine: false, words: '', sort: 'cpu' };

describe('the processes list', () => {
  it('sorts by CPU, memory, name or age', () => {
    expect(filterProcesses(rows, all).map((r) => r.pid)).toEqual([2, 3, 1, 4]);
    expect(filterProcesses(rows, { ...all, sort: 'name' }).map((r) => r.name)[0]).toBe('chrome gpu process');
    expect(filterProcesses(rows, { ...all, sort: 'newest' })[0]?.pid).toBe(4);
  });

  it('keeps yours, a kind, or what the words find', () => {
    expect(filterProcesses(rows, { ...all, mine: true }).map((r) => r.pid)).not.toContain(4);
    expect(filterProcesses(rows, { ...all, kind: 'dev' }).map((r) => r.pid)).toEqual([1]);
    expect(filterProcesses(rows, { ...all, words: 'GOOGLE' }).map((r) => r.pid)).toEqual([2, 3]);
    expect(filterProcesses(rows, { ...all, words: '4' }).map((r) => r.pid)).toEqual([4]);
  });

  it('counts the kinds among what the other filters leave', () => {
    const counts = kindCounts(rows, { ...all, mine: true });
    expect(counts.all).toBe(3);
    expect(counts.app).toBe(2);
    expect(counts.system).toBe(0);
  });

  it('groups an app with its helpers, adding them up', () => {
    const groups = groupByApp(filterProcesses(rows, all), 'cpu');
    expect(groups[0]?.name).toBe('Google Chrome');
    expect(groups[0]?.cpu).toBe(15);
    expect(groups[0]?.rows).toHaveLength(2);
    // Histories line up by their latest look: [1, 2] + [4] is [1, 6].
    expect(groups[0]?.history).toEqual([1, 6]);
    expect(groups.find((group) => group.key === 'pid:1')?.name).toBe('vite');
  });

  it('writes CPU shares short', () => {
    expect(percent(null)).toBe('—');
    expect(percent(0.42)).toBe('0.4%');
    expect(percent(12.6)).toBe('13%');
    expect(percent(0)).toBe('0%');
  });
});
