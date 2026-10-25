// Going from the command center to a session's terminal, on its tab.

import { api } from '../../lib/api';
import { go } from '../../lib/router.svelte';

export async function openTerminal(link: { terminal: number; tab: number }): Promise<void> {
  // Best effort: the terminal opens even if the tab moved on.
  await api.selectTab(link.tab).catch(() => {});
  go({ name: 'terminal', id: link.terminal });
}

/** How long something has been going: `34 min`, `2 h`. */
export function lasted(since: number, now: number): string {
  const minutes = Math.max(0, Math.floor((now - since) / 60));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return hours < 48 ? `${hours} h` : `${Math.floor(hours / 24)} d`;
}
