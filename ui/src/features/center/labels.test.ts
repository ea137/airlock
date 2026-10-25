import { describe, expect, it } from 'vitest';

import type { ClaudeSession, ProjectSummary, RepoSummary, Worktree } from '../../lib/api';
import { distance, groupLine, projectLine, pullBadge, repoLine, sessionLine, worktreeChips } from './labels';
import { parseView } from './view.svelte';

const project = (fields: Partial<ProjectSummary> = {}): ProjectSummary => ({
  name: 'shop-api',
  path: '/home/me/Projects/shop-api',
  repo: 'k1',
  branch: 'main',
  changes: 0,
  ahead: 0,
  behind: 0,
  worktrees: 1,
  needs_you: 0,
  working: 0,
  idle: 0,
  active_at: 0,
  ...fields,
});

describe('project lines', () => {
  it('give a repo its branch, distance and changes', () => {
    expect(projectLine(project())).toBe('main · clean');
    expect(projectLine(project({ ahead: 2, changes: 3, worktrees: 2 }))).toBe('main · 2 ahead · 3 uncommitted · 2 worktrees');
  });
  it('call a plain folder a folder, with its sessions', () => {
    expect(projectLine(project({ repo: null, branch: null }))).toBe('folder');
    expect(projectLine(project({ repo: null, branch: null, working: 1, idle: 1 }))).toBe('folder · 2 sessions');
  });
  it('count a group and what needs you in it', () => {
    expect(groupLine([project()])).toBe('1 project');
    expect(groupLine([project({ needs_you: 1 }), project({ working: 2 })])).toBe('2 projects · 1 needs you · 2 working');
  });
});

describe('the saved Work view', () => {
  it('keeps the strings it knows and drops the rest', () => {
    expect(parseView('{"hidden":["/a",3],"folded":["Learning"]}')).toEqual({ hidden: ['/a'], folded: ['Learning'] });
    expect(parseView(null)).toEqual({ hidden: [], folded: [] });
    expect(parseView('not json')).toEqual({ hidden: [], folded: [] });
  });
});

const worktree = (fields: Partial<Worktree> = {}): Worktree => ({
  path: '/home/me/Projects/app',
  name: 'app',
  branch: 'main',
  head: '8de30f2',
  compared_to: 'origin/main',
  ahead: 0,
  behind: 0,
  changes: 0,
  ...fields,
});

const repo = (worktrees: Worktree[]): RepoSummary => ({
  key: 'k1',
  name: 'app',
  github: 'me/app',
  base: 'main',
  worktrees,
  needs_you: 0,
  working: 0,
  idle: 0,
});

const session = (fields: Partial<ClaudeSession> = {}): ClaudeSession => ({
  id: 's1',
  title: null,
  state: 'working',
  doing: 'Editing src/lib.rs',
  waiting: null,
  started_at: 0,
  updated_at: 0,
  cwd: '/home/me/Projects/app',
  repo: 'k1',
  repo_name: 'app',
  worktree: '/home/me/Projects/app',
  branch: 'main',
  terminal: null,
  laptop_tab: null,
  background: [],
  answerable: true,
  place: { kind: 'airlock', app: null },
  ...fields,
});

describe('distance', () => {
  it('reads ahead and behind', () => {
    expect(distance(worktree({ ahead: 14, behind: 18 }))).toBe('14 ahead · 18 behind');
  });

  it('says up to date only against an upstream', () => {
    expect(distance(worktree())).toBe('up to date with origin');
    expect(distance(worktree({ compared_to: 'main' }))).toBeNull();
  });
});

describe('worktreeChips', () => {
  it('names the base it is ahead of, and says clean', () => {
    const feature = worktree({ branch: 'feature', compared_to: 'master', ahead: 5 });
    expect(worktreeChips(feature, 1)).toEqual(['5 ahead of master', 'clean']);
  });

  it('counts uncommitted files and missing sessions', () => {
    expect(worktreeChips(worktree({ changes: 3 }), 0)).toEqual(['up to date with origin', '3 uncommitted', 'no sessions']);
  });
});

describe('repoLine', () => {
  it('speaks for the worktree that needs you', () => {
    const main = worktree();
    const feature = worktree({ path: '/home/me/Projects/app-feature', branch: 'rung2/docs', compared_to: 'main', ahead: 5 });
    const asking = session({ state: 'needs_you', worktree: feature.path });
    expect(repoLine(repo([main, feature]), [asking])).toBe('rung2/docs · 5 ahead');
  });

  it('says when nothing runs there', () => {
    expect(repoLine(repo([worktree({ changes: 2, branch: 'master' })]), [])).toBe(
      'master · up to date with origin · 2 uncommitted · no sessions',
    );
  });
});

describe('sessionLine', () => {
  it('says what a waiting session wants', () => {
    const waiting = { kind: 'permission' as const, headline: 'Claude wants to run', detail: 'pnpm test', since: 0 };
    expect(sessionLine(session({ state: 'needs_you', waiting }))).toBe('Needs you: wants to run pnpm test');
  });

  it('otherwise says what it is doing', () => {
    expect(sessionLine(session())).toBe('Editing src/lib.rs');
  });
});

describe('pullBadge', () => {
  it.each([
    [{ state: 'MERGED', draft: false }, 'Merged'],
    [{ state: 'OPEN', draft: true }, 'Draft'],
    [{ state: 'OPEN', draft: false }, 'Open'],
    [{ state: 'CLOSED', draft: false }, 'Closed'],
  ])('labels %o as %s', (pull, label) => {
    expect(pullBadge(pull).label).toBe(label);
  });
});
