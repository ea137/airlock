// This phone's look: which theme, whether the terminal's colours follow it,
// and whether its decorations move. Kept in this browser only; storage can
// be unavailable (private browsing), and then it's just for now.

import { isThemeId, type ThemeId } from './themes';

const KEY = 'airlock.theme';

export type Look = { theme: ThemeId; terminalColours: boolean; motion: boolean };

const DEFAULT: Look = { theme: 'current', terminalColours: true, motion: true };

/** A saved look, as stored; anything missing or unknown is the default. */
export function parseLook(text: string | null): Look {
  try {
    const saved: unknown = JSON.parse(text ?? 'null');
    if (!saved || typeof saved !== 'object') return { ...DEFAULT };
    const fields = saved as Record<string, unknown>;
    return {
      theme: isThemeId(fields.theme) ? fields.theme : DEFAULT.theme,
      terminalColours: typeof fields.terminalColours === 'boolean' ? fields.terminalColours : DEFAULT.terminalColours,
      motion: typeof fields.motion === 'boolean' ? fields.motion : DEFAULT.motion,
    };
  } catch {
    return { ...DEFAULT };
  }
}

function saved(): Look {
  try {
    return parseLook(localStorage.getItem(KEY));
  } catch {
    return { ...DEFAULT };
  }
}

export const look = $state<Look>(saved());

/** Puts the look on the page: `data-theme`, `data-terminal` and `data-motion` on <html>. */
export function applyLook(): void {
  const root = document.documentElement;
  root.dataset.theme = look.theme;
  root.dataset.terminal = look.terminalColours ? 'theme' : 'plain';
  root.dataset.motion = look.motion ? 'on' : 'off';
  const background = getComputedStyle(root).getPropertyValue('--c-bg').trim();
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', background);
}

export function setLook(change: Partial<Look>): void {
  Object.assign(look, change);
  applyLook();
  try {
    localStorage.setItem(KEY, JSON.stringify(look));
  } catch {
    // Not remembered; it still applies now.
  }
}

/** Whether decorations may move: the switch is on and the phone doesn't ask for less motion. */
export function motionAllowed(): boolean {
  return look.motion && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
