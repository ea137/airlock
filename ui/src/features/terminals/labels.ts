// How terminals and tabs are named on screen.

import type { LaptopTab, Tab, Terminal } from '../../lib/api';

const SHELLS = new Set(['bash', 'zsh', 'fish', 'sh', 'dash']);

/** A tab's label: the name you gave it, else its folder, plus what runs in it unless that is the shell. */
export function tabLabel(tab: Tab): string {
  if (tab.name) return tab.name;
  return !tab.command || SHELLS.has(tab.command) ? tab.folder : `${tab.folder} · ${tab.command}`;
}

/** A laptop tab's label, the same way: its folder, and what runs in it unless that is the shell. */
export function laptopTabLabel(tab: LaptopTab): string {
  const folder = tab.folder.split('/').filter(Boolean).pop() ?? '/';
  return !tab.command || SHELLS.has(tab.command) ? folder : `${folder} · ${tab.command}`;
}

/** `path` with your home folder written as `~`. */
export function shortPath(path: string, home: string): string {
  if (!home) return path;
  if (path === home) return '~';
  return path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
}

export function activeTab(terminal: Terminal): Tab | undefined {
  return terminal.tabs.find((tab) => tab.active) ?? terminal.tabs[0];
}

export function tabCount(terminal: Terminal): string {
  return terminal.tabs.length === 1 ? '1 tab' : `${terminal.tabs.length} tabs`;
}

/** What runs in the terminal's active tab: the program, or `shell`. */
export function running(terminal: Terminal): string {
  const command = activeTab(terminal)?.command ?? '';
  return !command || SHELLS.has(command) ? 'shell' : command;
}

/** `text` as `xxd` shows it: offset, eight bytes in hex, then the bytes as text. */
export function hexDump(text: string, rows: number): string[] {
  const bytes = [...new TextEncoder().encode(text)];
  return Array.from({ length: rows }, (_, row) => {
    const chunk = Array.from({ length: 8 }, (_, i) => bytes[row * 8 + i] ?? 0);
    const hex = chunk.map((byte) => byte.toString(16).padStart(2, '0')).join(' ');
    const shown = chunk.map((byte) => (byte >= 0x20 && byte < 0x7f ? String.fromCharCode(byte) : '.')).join('');
    return `${(row * 8).toString(16).padStart(4, '0')}: ${hex}  ${shown}`;
  });
}
