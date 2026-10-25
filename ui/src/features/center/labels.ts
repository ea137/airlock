// The command center's words: what a repo card, a worktree and a session say.

import type { ClaudeSession, ProjectSummary, PullRequest, RepoSummary, Worktree } from '../../lib/api';

/** The branch, or where a detached worktree is. */
export function branchName(worktree: Worktree): string {
  return worktree.branch ?? `detached at ${worktree.head}`;
}

/** Whether `compared_to` is an upstream (`origin/main`) rather than a local base. */
function isUpstream(worktree: Worktree): boolean {
  return worktree.compared_to?.includes('/') ?? false;
}

/** How far a worktree is from what it compares with: `5 ahead · 2 behind`. */
export function distance(worktree: Worktree): string | null {
  const parts: string[] = [];
  if (worktree.ahead > 0) parts.push(`${worktree.ahead} ahead`);
  if (worktree.behind > 0) parts.push(`${worktree.behind} behind`);
  if (parts.length === 0) {
    return isUpstream(worktree) ? `up to date with ${worktree.compared_to?.split('/')[0]}` : null;
  }
  return parts.join(' · ');
}

/** The chips under a worktree: distance, changes, sessions. */
export function worktreeChips(worktree: Worktree, sessions: number): string[] {
  const chips: string[] = [];
  const far = distance(worktree);
  if (far) {
    chips.push(worktree.compared_to && !isUpstream(worktree) ? `${far} of ${worktree.compared_to}` : far);
  }
  chips.push(worktree.changes > 0 ? `${worktree.changes} uncommitted` : 'clean');
  if (sessions === 0) chips.push('no sessions');
  return chips;
}

/** The worktree a repo card speaks for: one that needs you, else one that is
 * ahead, else the main one. */
export function leadWorktree(repo: RepoSummary, sessions: ClaudeSession[]): Worktree | undefined {
  const mine = sessions.filter((session) => session.repo === repo.key);
  const asking = mine.find((session) => session.state === 'needs_you')?.worktree;
  return (
    repo.worktrees.find((worktree) => worktree.path === asking) ??
    repo.worktrees.find((worktree) => worktree.ahead > 0 && worktree.branch !== repo.base) ??
    repo.worktrees[0]
  );
}

/** A repo card's one line: `main · 6 uncommitted · no sessions`. */
export function repoLine(repo: RepoSummary, sessions: ClaudeSession[]): string {
  const lead = leadWorktree(repo, sessions);
  if (!lead) return 'no worktrees';
  const parts = [branchName(lead)];
  const far = distance(lead);
  if (far) parts.push(far);
  if (lead.changes > 0) parts.push(`${lead.changes} uncommitted`);
  if (!sessions.some((session) => session.repo === repo.key && session.state !== 'ended')) {
    parts.push('no sessions');
  }
  return parts.join(' · ');
}

/** A project row's one line: `main · 2 ahead · 3 uncommitted`, or what a
 * plain folder has going on. */
export function projectLine(project: ProjectSummary): string {
  if (!project.repo) {
    const live = project.needs_you + project.working + project.idle;
    return live > 0 ? `folder · ${live} ${live === 1 ? 'session' : 'sessions'}` : 'folder';
  }
  const parts = [project.branch ?? 'detached'];
  if (project.ahead > 0) parts.push(`${project.ahead} ahead`);
  if (project.behind > 0) parts.push(`${project.behind} behind`);
  parts.push(project.changes > 0 ? `${project.changes} uncommitted` : 'clean');
  if (project.worktrees > 1) parts.push(`${project.worktrees} worktrees`);
  return parts.join(' · ');
}

/** What a group's header counts: `4 projects · 1 needs you · 2 working`. */
export function groupLine(projects: ProjectSummary[]): string {
  const parts = [projects.length === 1 ? '1 project' : `${projects.length} projects`];
  const needs = projects.reduce((sum, project) => sum + project.needs_you, 0);
  const working = projects.reduce((sum, project) => sum + project.working, 0);
  if (needs > 0) parts.push(`${needs} needs you`);
  if (working > 0) parts.push(`${working} working`);
  return parts.join(' · ');
}

/** What a session row says under its name. */
export function sessionLine(session: ClaudeSession): string {
  if (session.state === 'needs_you' && session.waiting) {
    const detail = session.waiting.detail ? ` ${session.waiting.detail}` : '';
    return `Needs you: ${session.waiting.headline.replace(/^Claude /, '')}${detail}`;
  }
  return session.doing;
}

/** How full a session's context window is, in a few characters: "42% of 1M". */
export function contextLine(context: { used: number; size: number }): string {
  const size =
    context.size >= 1_000_000
      ? `${Math.round(context.size / 100_000) / 10}M`
      : context.size >= 1000
        ? `${Math.round(context.size / 1000)}k`
        : '';
  return size ? `${Math.round(context.used)}% of ${size}` : `${Math.round(context.used)}%`;
}

export function sessionName(session: ClaudeSession): string {
  return session.title ?? 'claude';
}

export function pullBadge(pull: Pick<PullRequest, 'state' | 'draft'>): { label: string; tone: string } {
  if (pull.state === 'MERGED') return { label: 'Merged', tone: 'merged' };
  if (pull.state === 'CLOSED') return { label: 'Closed', tone: 'closed' };
  if (pull.draft) return { label: 'Draft', tone: 'draft' };
  return { label: 'Open', tone: 'open' };
}
