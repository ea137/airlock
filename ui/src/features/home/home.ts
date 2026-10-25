// Home's words and choices: where each thing leads, which ones you've
// hidden, and what's going on, in a line.

import type { Attention, AttentionItem, AttentionLink, ClaudeSession } from '../../lib/api';
import { ago } from '../../lib/format';
import type { Route } from '../../lib/routes';

/** How a session is doing, in a few words, and its tone. */
export function sessionStatus(
  session: ClaudeSession,
  now: number,
): { tone: 'asks' | 'works' | 'runs' | 'done' | 'closed'; text: string } {
  switch (session.state) {
    case 'needs_you':
      return { tone: 'asks', text: `Waiting on you: ${session.waiting?.headline ?? 'a question'}` };
    case 'working':
      return { tone: 'works', text: session.doing || 'Working' };
    case 'idle':
      return session.background.length > 0
        ? { tone: 'runs', text: `Done, still running: ${session.background.join(' · ')}` }
        : { tone: 'done', text: 'Done, waiting for your next message' };
    case 'ended':
      return { tone: 'closed', text: `Closed ${ago(session.updated_at, now)}` };
  }
}

/** Where a session works: its repo, else its folder. */
export function sessionWhere(session: ClaudeSession): string {
  return session.repo_name ?? session.cwd.split('/').filter(Boolean).pop() ?? session.cwd;
}

export function routeFor(link: AttentionLink): Route {
  switch (link.to) {
    case 'session':
      return { name: 'session', id: link.id };
    case 'pull':
      return { name: 'pull', key: link.repo, number: link.number };
    case 'system':
      return { name: 'system', tab: link.tab };
    case 'port':
      return { name: 'system', port: link.port };
    case 'service':
      return { name: 'system', tab: 'services', unit: { name: link.unit, scope: link.scope } };
    case 'edits':
      return { name: 'edits' };
  }
}

/** Only what's worth a look or for your information can be hidden; what
 * waits on you stays until it's done. */
export function canHide(item: AttentionItem): boolean {
  return item.level !== 'act';
}

export function unhidden(items: readonly AttentionItem[], hidden: readonly string[]): AttentionItem[] {
  return items.filter((item) => !canHide(item) || !hidden.includes(item.id));
}

/** The hidden ids still on Home; the rest are forgotten, so the list stays small. */
export function stillHidden(items: readonly AttentionItem[], hidden: readonly string[]): string[] {
  return hidden.filter((id) => items.some((item) => item.id === id));
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** `2 sessions working · 3 terminals · vite on :5173`, or nothing at all. */
export function goingOn(now: Attention['now']): string[] {
  const parts: string[] = [];
  if (now.working > 0) parts.push(`${plural(now.working, 'session', 'sessions')} working`);
  if (now.terminals > 0) parts.push(plural(now.terminals, 'terminal', 'terminals'));
  for (const [name, port] of now.servers.slice(0, 2)) parts.push(`${name} on :${port}`);
  if (now.servers.length > 2) parts.push(`${now.servers.length - 2} more servers`);
  return parts;
}

/** Saved hidden ids, as stored; anything malformed is none. */
export function parseHidden(text: string | null): string[] {
  try {
    const saved: unknown = JSON.parse(text ?? '[]');
    return Array.isArray(saved) ? saved.filter((id): id is string => typeof id === 'string').slice(-200) : [];
  } catch {
    return [];
  }
}
