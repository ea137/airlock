import { describe, expect, it } from 'vitest';

import type { LaptopTab, Tab, Terminal } from '../../lib/api';
import { activeTab, hexDump, laptopTabLabel, running, shortPath, tabCount, tabLabel } from './labels';

describe('laptopTabLabel', () => {
  const laptopTab = (folder: string, command: string): LaptopTab => ({
    id: 1,
    title: 'you@laptop: ~',
    folder,
    command,
    opened_at: 0,
    active_at: 0,
    on_phone: false,
  });
  it('names a laptop tab by its folder and what runs in it', () => {
    expect(laptopTabLabel(laptopTab('/home/me/Projects/bakery', 'claude'))).toBe('bakery · claude');
    expect(laptopTabLabel(laptopTab('/home/me/Projects/bakery', 'bash'))).toBe('bakery');
    expect(laptopTabLabel(laptopTab('/', 'bash'))).toBe('/');
  });
});

const tab = (over: Partial<Tab> = {}): Tab => ({
  id: 7,
  index: 1,
  name: '',
  active: false,
  cwd: '/home/me/Projects/bakery',
  folder: 'bakery',
  command: 'bash',
  ...over,
});

describe('tabLabel', () => {
  it('uses the name you gave the tab', () => {
    expect(tabLabel(tab({ name: 'claude', command: 'node' }))).toBe('claude');
  });
  it('shows only the folder while the shell is in front', () => {
    expect(tabLabel(tab())).toBe('bakery');
    expect(tabLabel(tab({ command: '' }))).toBe('bakery');
  });
  it('adds what runs in the tab', () => {
    expect(tabLabel(tab({ command: 'claude' }))).toBe('bakery · claude');
  });
});

describe('shortPath', () => {
  const home = '/home/me';
  it('writes home as ~', () => {
    expect(shortPath('/home/me', home)).toBe('~');
    expect(shortPath('/home/me/Projects/shop', home)).toBe('~/Projects/shop');
  });
  it('leaves other paths and look-alike prefixes alone', () => {
    expect(shortPath('/home/me2/x', home)).toBe('/home/me2/x');
    expect(shortPath('/home/meadow/x', home)).toBe('/home/meadow/x');
    expect(shortPath('/tmp', home)).toBe('/tmp');
    expect(shortPath('/tmp', '')).toBe('/tmp');
  });
});

describe('terminal summaries', () => {
  const terminal = (tabs: Tab[]): Terminal => ({ id: 3, name: 'bakery', created_at: 0, activity_at: 0, tabs, preview: [] });
  it('finds the active tab, or the first', () => {
    expect(activeTab(terminal([tab({ id: 1 }), tab({ id: 2, active: true })]))?.id).toBe(2);
    expect(activeTab(terminal([tab({ id: 1 }), tab({ id: 2 })]))?.id).toBe(1);
  });
  it('counts tabs in words', () => {
    expect(tabCount(terminal([tab()]))).toBe('1 tab');
    expect(tabCount(terminal([tab(), tab()]))).toBe('2 tabs');
  });
  it('names what runs in front, the shell as shell', () => {
    expect(running(terminal([tab({ command: 'claude', active: true })]))).toBe('claude');
    expect(running(terminal([tab({ command: 'zsh' })]))).toBe('shell');
    expect(running(terminal([]))).toBe('shell');
  });
});

describe('hexDump', () => {
  it('shows bytes as xxd does, zeros past the end', () => {
    expect(hexDump('bakery', 2)).toEqual([
      '0000: 62 61 6b 65 72 79 00 00  bakery..',
      '0008: 00 00 00 00 00 00 00 00  ........',
    ]);
  });
  it('dots what is not printable', () => {
    expect(hexDump('a\nb', 1)).toEqual(['0000: 61 0a 62 00 00 00 00 00  a.b.....']);
  });
});
