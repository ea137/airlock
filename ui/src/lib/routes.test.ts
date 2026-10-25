import { describe, expect, it } from 'vitest';

import { hrefFor, parseRoute, type Route, SECTIONS, sectionOf, sectionRoute } from './routes';

describe('routes', () => {
  const routes: Route[] = [
    { name: 'home' },
    { name: 'terminal', id: 3 },
    { name: 'laptop-tab', id: 4 },
    { name: 'center' },
    { name: 'repo', key: '6a59d4f6c26b' },
    { name: 'project', path: '/home/me/Learning/Rust book' },
    { name: 'step', id: '5acfb07e-0d5c-405c-8a00-3f4d817e07e4', seq: 12 },
    { name: 'session', id: '5acfb07e-0d5c-405c-8a00-3f4d817e07e4' },
    { name: 'pull', key: '6a59d4f6c26b', number: 68 },
    { name: 'pull-diff', key: '6a59d4f6c26b', number: 68 },
    { name: 'diff', key: '6a59d4f6c26b', worktree: '/home/me/Projects/notes vault/' },
    { name: 'files', path: '~' },
    { name: 'files', path: '~/Projects/laptop-remote' },
    { name: 'file', path: '~/Projects/app/notes #1.md' },
    { name: 'edit', path: '~/Projects/app/README.md' },
    { name: 'edits' },
    { name: 'system' },
    { name: 'system', tab: 'processes' },
    { name: 'system', tab: 'services' },
    { name: 'system', port: 6379 },
    { name: 'system', tab: 'services', unit: { name: 'vboxdrv.service', scope: 'system' } },
    { name: 'system', tab: 'services', unit: { name: 'app@web 2.service', scope: 'user' } },
    { name: 'preview', port: 5173 },
    { name: 'theme' },
  ];

  it('reads the links Markdown files make to other files', () => {
    expect(parseRoute('#/files/view/~/Projects/app/docs/a.md')).toEqual({
      name: 'file',
      path: '~/Projects/app/docs/a.md',
    });
  });

  it.each(routes)('round-trips $name through its hash', (route) => {
    expect(parseRoute(hrefFor(route))).toEqual(route);
  });

  it('puts every screen but the theme picker in a section', () => {
    expect(sectionOf({ name: 'terminal', id: 3 })).toBe('terminals');
    expect(sectionOf({ name: 'pull-diff', key: '6a59d4f6c26b', number: 68 })).toBe('center');
    expect(sectionOf({ name: 'preview', port: 5173 })).toBe('system');
    expect(sectionOf({ name: 'edits' })).toBe('files');
    expect(sectionOf({ name: 'theme' })).toBeNull();
  });

  it.each(SECTIONS)('starts section %s on a screen in it', (section) => {
    expect(sectionOf(sectionRoute(section))).toBe(section);
  });

  it('sends anything unknown or malformed home', () => {
    expect(parseRoute('')).toEqual({ name: 'home' });
    expect(parseRoute('#/nowhere')).toEqual({ name: 'home' });
    expect(parseRoute('#/center/s/%E0%A4%A')).toEqual({ name: 'home' });
  });
});
