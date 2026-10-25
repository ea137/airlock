// The themes: each is a set of design tokens (styles/themes.css) and,
// for some, decorations (lib/ThemeLayer.svelte). The swatch is what the
// theme picker shows for it.

export type ThemeId =
  | 'current'
  | 'matrix'
  | 'boot'
  | 'teletext'
  | 'handheld'
  | 'gameboy'
  | 'workstation'
  | 'vector'
  | 'hacker';

export type Theme = {
  id: ThemeId;
  name: string;
  swatch: { bg: string; fg: string; accent: string; font: string; size: string; sample: string };
};

export const THEMES: Theme[] = [
  {
    id: 'current',
    name: 'Current',
    swatch: { bg: '#1a1d23', fg: '#e6e8ec', accent: '#3b63e6', font: 'system-ui, sans-serif', size: '15px', sample: 'Terminals' },
  },
  {
    id: 'matrix',
    name: 'Matrix',
    swatch: { bg: '#000000', fg: '#00ff41', accent: '#00ff41', font: "'Share Tech Mono', monospace", size: '15px', sample: 'TERMINALS' },
  },
  {
    id: 'boot',
    name: '8-bit',
    swatch: { bg: '#40318d', fg: '#a99ff5', accent: '#7869c4', font: "'Press Start 2P', monospace", size: '9px', sample: 'READY.' },
  },
  {
    id: 'teletext',
    name: 'Teletext',
    swatch: { bg: '#000000', fg: '#ffff00', accent: '#0000ff', font: "'VT323', monospace", size: '20px', sample: 'P101 TERMINALS' },
  },
  {
    id: 'handheld',
    name: 'Handheld console',
    swatch: { bg: '#9bbc0f', fg: '#0f380f', accent: '#306230', font: "'Press Start 2P', monospace", size: '9px', sample: '▶ TERMINALS' },
  },
  {
    id: 'gameboy',
    name: 'Game Boy',
    swatch: { bg: '#c4c4c0', fg: '#2b2c7a', accent: '#8b1e4a', font: "'Press Start 2P', monospace", size: '8px', sample: 'POCKET TERM' },
  },
  {
    id: 'workstation',
    name: '90s workstation',
    swatch: { bg: '#555555', fg: '#ffffff', accent: '#aaaaaa', font: "'IBM Plex Sans', sans-serif", size: '14px', sample: 'Terminals' },
  },
  {
    id: 'vector',
    name: 'Vector display',
    swatch: { bg: '#000000', fg: '#9ffcff', accent: '#9ffcff', font: "'Major Mono Display', monospace", size: '15px', sample: 'terminals' },
  },
  {
    id: 'hacker',
    name: 'Hacker',
    swatch: { bg: '#0a0a0a', fg: '#e8e8e8', accent: '#ff2e4d', font: "'Fira Code', monospace", size: '13px', sample: 'root@laptop:~#' },
  },
];

export function isThemeId(text: unknown): text is ThemeId {
  return THEMES.some((theme) => theme.id === text);
}
