// What you hid from Home on this phone. Kept in this browser only; storage
// can be unavailable (private browsing), and then it's just for now.

import { parseHidden } from './home';

const KEY = 'airlock.homeHidden';
/** Claude sessions hidden from Home's list (a prompt from one still shows). */
const SESSIONS_KEY = 'airlock.homeHiddenSessions';

function saved(key: string): string[] {
  try {
    return parseHidden(localStorage.getItem(key));
  } catch {
    return [];
  }
}

function keep(key: string, ids: string[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(ids));
  } catch {
    // Not remembered; it still applies now.
  }
}

export const hidden = $state<{ ids: string[] }>({ ids: saved(KEY) });

export function setHidden(ids: string[]): void {
  hidden.ids = ids;
  keep(KEY, ids);
}

export const hiddenSessions = $state<{ ids: string[] }>({ ids: saved(SESSIONS_KEY) });

export function setHiddenSessions(ids: string[]): void {
  hiddenSessions.ids = ids;
  keep(SESSIONS_KEY, ids);
}
