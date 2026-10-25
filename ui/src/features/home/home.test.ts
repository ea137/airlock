import { describe, expect, it } from 'vitest';

import type { AttentionItem, ClaudeSession } from '../../lib/api';
import { canHide, goingOn, parseHidden, routeFor, sessionStatus, sessionWhere, stillHidden, unhidden } from './home';

describe('sessionStatus', () => {
  const session = (fields: Partial<ClaudeSession>): ClaudeSession => ({
    id: 's1',
    title: 'Fix the login',
    state: 'idle',
    doing: 'Finished',
    waiting: null,
    started_at: 0,
    updated_at: 1_000,
    cwd: '/home/me/Projects/shop',
    repo: null,
    repo_name: null,
    worktree: null,
    branch: null,
    terminal: null,
    laptop_tab: null,
    background: [],
    answerable: false,
    place: { kind: 'elsewhere', app: null },
    ...fields,
  });

  it('says how each session is doing', () => {
    expect(
      sessionStatus(
        session({ state: 'needs_you', waiting: { kind: 'permission', headline: 'Claude wants to run', detail: 'ls', since: 0 } }),
        1_000,
      ),
    ).toEqual({ tone: 'asks', text: 'Waiting on you: Claude wants to run' });
    expect(sessionStatus(session({ state: 'working', doing: 'Editing src/app.ts' }), 1_000).text).toBe('Editing src/app.ts');
    expect(sessionStatus(session({}), 1_000)).toEqual({ tone: 'done', text: 'Done, waiting for your next message' });
    expect(sessionStatus(session({ state: 'ended' }), 1_120).text).toBe('Closed 2m ago');
  });

  it('tells a session done but still running something apart', () => {
    const running = session({ background: ['cargo build --release', 'agent: Write the docs'] });
    expect(sessionStatus(running, 1_000)).toEqual({
      tone: 'runs',
      text: 'Done, still running: cargo build --release · agent: Write the docs',
    });
  });

  it('names where it works by its repo, else its folder', () => {
    expect(sessionWhere(session({ repo_name: 'shop-web' }))).toBe('shop-web');
    expect(sessionWhere(session({}))).toBe('shop');
  });
});

const item = (id: string, level: AttentionItem['level']): AttentionItem => ({
  id,
  level,
  kind: 'finished',
  title: id,
  detail: null,
  since: null,
  link: { to: 'edits' },
});

describe('routeFor', () => {
  it('leads to the screen that holds the thing', () => {
    expect(routeFor({ to: 'session', id: 's1' })).toEqual({ name: 'session', id: 's1' });
    expect(routeFor({ to: 'pull', repo: 'k1', number: 7 })).toEqual({ name: 'pull', key: 'k1', number: 7 });
    expect(routeFor({ to: 'system', tab: 'services' })).toEqual({ name: 'system', tab: 'services' });
    expect(routeFor({ to: 'edits' })).toEqual({ name: 'edits' });
  });
});

describe('hiding', () => {
  const items = [item('prompt', 'act'), item('done', 'look'), item('note', 'fyi')];

  it('never hides what waits on you', () => {
    expect(canHide(items[0]!)).toBe(false);
    expect(unhidden(items, ['prompt', 'done']).map((shown) => shown.id)).toEqual(['prompt', 'note']);
  });

  it('forgets hidden ids once their thing has left Home', () => {
    expect(stillHidden(items, ['done', 'gone'])).toEqual(['done']);
  });

  it.each([null, 'nope', '{"a":1}'])('reads %j as nothing hidden', (text) => {
    expect(parseHidden(text)).toEqual([]);
  });

  it('reads saved ids', () => {
    expect(parseHidden('["a",2,"b"]')).toEqual(['a', 'b']);
  });
});

describe('goingOn', () => {
  it('says what runs, briefly', () => {
    expect(goingOn({ working: 2, terminals: 1, servers: [['vite', 5173]] })).toEqual([
      '2 sessions working',
      '1 terminal',
      'vite on :5173',
    ]);
    expect(
      goingOn({
        working: 0,
        terminals: 0,
        servers: [
          ['vite', 5173],
          ['astro dev', 4321],
          ['python3 -m http.server', 8000],
          ['next dev', 3000],
        ],
      }),
    ).toEqual(['vite on :5173', 'astro dev on :4321', '2 more servers']);
  });

  it('says nothing when nothing runs', () => {
    expect(goingOn({ working: 0, terminals: 0, servers: [] })).toEqual([]);
  });
});
