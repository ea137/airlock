// The System screen's words: who can reach a port, how long something has
// run, sizes.

import type { PortView } from '../../lib/api';

export function exposureLabel(exposure: PortView['exposure']): string {
  switch (exposure) {
    case 'laptop':
      return 'laptop only';
    case 'tailnet':
      return 'tailnet';
    case 'all':
      return 'all networks';
    case 'one':
      return 'one network';
  }
}

/** How long something has run: `45 s`, `12 min`, `3 h`, `2 days`. */
export function duration(seconds: number): string {
  if (seconds < 60) return `${Math.floor(seconds)} s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min`;
  if (seconds < 172_800) return `${Math.floor(seconds / 3600)} h`;
  return `${Math.floor(seconds / 86_400)} days`;
}

/** Memory and disk sizes: `7.9 GB`, `512 MB`. */
export function bytes(count: number): string {
  if (count >= 1_073_741_824) {
    const gb = count / 1_073_741_824;
    return `${gb >= 100 ? Math.round(gb) : gb.toFixed(1)} GB`;
  }
  return `${Math.max(1, Math.round(count / 1_048_576))} MB`;
}

/** Disk sizes as the Files app gives them, in powers of ten: `236 GB`,
 * `13.1 GB`, `840 MB`. */
export function diskSize(count: number): string {
  const gb = count / 1e9;
  if (gb >= 100) return `${Math.round(gb)} GB`;
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  return `${Math.round(count / 1e6)} MB`;
}

/** `~/Projects/x` for a path in `home`. */
export function shortHome(path: string | null, home: string): string {
  if (!path) return '';
  return home && path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
}

/** A disk this full needs a look. */
export const DISK_WARN = 0.9;
