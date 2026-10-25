// Every screen and its URL hash. Kept apart from the router's state so it
// can be tested without a page.

export type Route =
  | { name: 'home' }
  | { name: 'terminals' }
  | { name: 'terminal'; id: number }
  | { name: 'laptop-tab'; id: number }
  | { name: 'center' }
  | { name: 'repo'; key: string }
  | { name: 'project'; path: string }
  | { name: 'session'; id: string }
  | { name: 'step'; id: string; seq: number }
  | { name: 'pull'; key: string; number: number }
  | { name: 'diff'; key: string; worktree: string }
  | { name: 'pull-diff'; key: string; number: number }
  | { name: 'files'; path: string }
  | { name: 'file'; path: string }
  | { name: 'edit'; path: string }
  | { name: 'edits' }
  /** `port`: the overview, with that listening port's details open.
   * `unit`: the services tab, with that service of `scope`'s open. */
  | { name: 'system'; tab?: SystemTab; port?: number; unit?: { name: string; scope: 'user' | 'system' } }
  | { name: 'preview'; port: number }
  | { name: 'theme' };

export const SYSTEM_TABS = ['overview', 'processes', 'services'] as const;
export type SystemTab = (typeof SYSTEM_TABS)[number];

/** The main sections, in the order the header shows them. */
export const SECTIONS = ['home', 'terminals', 'center', 'system', 'files'] as const;
export type Section = (typeof SECTIONS)[number];

/** The section a screen belongs to; the theme picker is in none. */
export function sectionOf(route: Route): Section | null {
  switch (route.name) {
    case 'home':
      return 'home';
    case 'terminals':
    case 'terminal':
    case 'laptop-tab':
      return 'terminals';
    case 'center':
    case 'repo':
    case 'project':
    case 'session':
    case 'step':
    case 'pull':
    case 'diff':
    case 'pull-diff':
      return 'center';
    case 'system':
    case 'preview':
      return 'system';
    case 'files':
    case 'file':
    case 'edit':
    case 'edits':
      return 'files';
    case 'theme':
      return null;
  }
}

export function sectionRoute(section: Section): Route {
  switch (section) {
    case 'home':
      return { name: 'home' };
    case 'terminals':
      return { name: 'terminals' };
    case 'center':
      return { name: 'center' };
    case 'system':
      return { name: 'system' };
    case 'files':
      return { name: 'files', path: '~' };
  }
}

/** A file path in a hash: kept readable, with its slashes. */
const filePart = (path: string) => encodeURIComponent(path).replace(/%2F/g, '/').replace(/%7E/g, '~');

const part = (text: string) => encodeURIComponent(text);

export function hrefFor(route: Route): string {
  switch (route.name) {
    case 'home':
      return '#/';
    case 'terminals':
      return '#/terminals';
    case 'terminal':
      return `#/t/${route.id}`;
    case 'laptop-tab':
      return `#/lt/${route.id}`;
    case 'center':
      return '#/center';
    case 'repo':
      return `#/center/r/${part(route.key)}`;
    case 'project':
      return `#/center/p/${filePart(route.path)}`;
    case 'session':
      return `#/center/s/${part(route.id)}`;
    case 'step':
      return `#/center/s/${part(route.id)}/step/${route.seq}`;
    case 'pull':
      return `#/center/r/${part(route.key)}/pr/${route.number}`;
    case 'diff':
      return `#/center/r/${part(route.key)}/diff/${part(route.worktree)}`;
    case 'pull-diff':
      return `#/center/r/${part(route.key)}/pr/${route.number}/diff`;
    case 'files':
      return route.path === '~' ? '#/files' : `#/files/dir/${filePart(route.path)}`;
    case 'file':
      return `#/files/view/${filePart(route.path)}`;
    case 'edit':
      return `#/files/edit/${filePart(route.path)}`;
    case 'edits':
      return '#/files/edits';
    case 'system':
      if (route.port !== undefined) return `#/system/port/${route.port}`;
      if (route.unit) return `#/system/services/${route.unit.scope}/${part(route.unit.name)}`;
      return route.tab && route.tab !== 'overview' ? `#/system/${route.tab}` : '#/system';
    case 'preview':
      return `#/system/preview/${route.port}`;
    case 'theme':
      return '#/theme';
  }
}

const PATTERNS: [RegExp, (match: string[]) => Route][] = [
  [/^#\/terminals$/, () => ({ name: 'terminals' })],
  [/^#\/t\/(\d+)$/, ([, id]) => ({ name: 'terminal', id: Number(id) })],
  [/^#\/lt\/(\d+)$/, ([, id]) => ({ name: 'laptop-tab', id: Number(id) })],
  [/^#\/center$/, () => ({ name: 'center' })],
  [/^#\/center\/r\/([^/]+)$/, ([, key]) => ({ name: 'repo', key: decodeURIComponent(key ?? '') })],
  [/^#\/center\/s\/([^/]+)$/, ([, id]) => ({ name: 'session', id: decodeURIComponent(id ?? '') })],
  [/^#\/center\/p\/(.+)$/, ([, path]) => ({ name: 'project', path: decodeURIComponent(path ?? '') })],
  [
    /^#\/center\/s\/([^/]+)\/step\/(\d+)$/,
    ([, id, seq]) => ({ name: 'step', id: decodeURIComponent(id ?? ''), seq: Number(seq) }),
  ],
  [
    /^#\/center\/r\/([^/]+)\/pr\/(\d+)$/,
    ([, key, number]) => ({ name: 'pull', key: decodeURIComponent(key ?? ''), number: Number(number) }),
  ],
  [
    /^#\/center\/r\/([^/]+)\/pr\/(\d+)\/diff$/,
    ([, key, number]) => ({ name: 'pull-diff', key: decodeURIComponent(key ?? ''), number: Number(number) }),
  ],
  [/^#\/system$/, () => ({ name: 'system' })],
  [/^#\/system\/(processes|services)$/, ([, tab]) => ({ name: 'system', tab: SYSTEM_TABS.find((known) => known === tab) })],
  [/^#\/system\/port\/(\d+)$/, ([, port]) => ({ name: 'system', port: Number(port) })],
  [
    /^#\/system\/services\/(user|system)\/([^/]+)$/,
    ([, scope, name]) => ({
      name: 'system',
      tab: 'services',
      unit: { name: decodeURIComponent(name ?? ''), scope: scope === 'user' ? 'user' : 'system' },
    }),
  ],
  [/^#\/theme$/, () => ({ name: 'theme' })],
  [/^#\/system\/preview\/(\d+)$/, ([, port]) => ({ name: 'preview', port: Number(port) })],
  [/^#\/files$/, () => ({ name: 'files', path: '~' })],
  [/^#\/files\/edits$/, () => ({ name: 'edits' })],
  [/^#\/files\/dir\/(.+)$/, ([, path]) => ({ name: 'files', path: decodeURIComponent(path ?? '') })],
  [/^#\/files\/view\/(.+)$/, ([, path]) => ({ name: 'file', path: decodeURIComponent(path ?? '') })],
  [/^#\/files\/edit\/(.+)$/, ([, path]) => ({ name: 'edit', path: decodeURIComponent(path ?? '') })],
  [
    /^#\/center\/r\/([^/]+)\/diff\/([^/]+)$/,
    ([, key, worktree]) => ({
      name: 'diff',
      key: decodeURIComponent(key ?? ''),
      worktree: decodeURIComponent(worktree ?? ''),
    }),
  ],
];

export function parseRoute(hash: string): Route {
  for (const [pattern, build] of PATTERNS) {
    const match = pattern.exec(hash);
    if (match) {
      try {
        return build(match);
      } catch {
        // A malformed escape: fall through to home.
      }
    }
  }
  return { name: 'home' };
}
