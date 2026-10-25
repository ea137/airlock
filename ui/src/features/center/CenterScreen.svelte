<!-- The command center: your projects grouped by the folders that hold them
     (Freelance, Projects, Learning…), or every Claude session as one list,
     with whatever needs you on top. Groups fold away, and projects or whole
     groups can be hidden; Edit shows the switches. -->
<script lang="ts" module>
  import { api, type Center } from '../../lib/api';
  import { Polled } from '../../lib/polled.svelte';

  /** A session changing how it stands refreshes the center at once (the
   * hub's news); this catches the rest: what each is doing, branches. */
  const REFRESH_MS = 10_000;

  // Kept between visits: coming back shows the last of it at once while it
  // refreshes.
  const center = new Polled<Center>(() => api.center(), REFRESH_MS);
</script>

<script lang="ts">
  import type { ProjectGroup, ProjectSummary } from '../../lib/api';
  import { ago, nowSecs } from '../../lib/format';
  import MainHeader from '../../lib/MainHeader.svelte';
  import { onSessionsChanged } from '../../lib/news';
  import Problem from '../../lib/Problem.svelte';
  import { hrefFor } from '../../lib/router.svelte';
  import { groupLine, projectLine } from './labels';
  import NeedsYou from './NeedsYou.svelte';
  import SessionRow from './SessionRow.svelte';
  import { centerView, toggleFolded, toggleHidden } from './view.svelte';

  const GROUPING_KEY = 'airlock.centerGrouping';

  type Grouping = 'projects' | 'sessions';

  function savedGrouping(): Grouping {
    try {
      return localStorage.getItem(GROUPING_KEY) === 'sessions' ? 'sessions' : 'projects';
    } catch {
      return 'projects';
    }
  }

  let grouping = $state<Grouping>(savedGrouping());
  let editing = $state(false);
  /** Groups whose hidden projects are shown for now. */
  let peeking = $state<string[]>([]);

  $effect(() => center.watch());
  $effect(() => onSessionsChanged(() => center.nudge()));

  function group(next: Grouping) {
    grouping = next;
    try {
      localStorage.setItem(GROUPING_KEY, next);
    } catch {
      // Not remembered; it still applies now.
    }
  }

  const groupKey = (group: ProjectGroup) => group.path ?? group.name;
  const data = $derived(center.data);
  const asking = $derived(data?.sessions.filter((session) => session.state === 'needs_you') ?? []);
  const live = $derived(data?.sessions.filter((session) => session.state !== 'ended') ?? []);
  const groups = $derived(
    (data?.groups ?? []).filter((group) => editing || !centerView.hidden.includes(groupKey(group))),
  );
  const hiddenGroups = $derived(
    (data?.groups ?? []).filter((group) => centerView.hidden.includes(groupKey(group))).length,
  );

  function projectHref(project: ProjectSummary): string {
    return project.repo
      ? hrefFor({ name: 'repo', key: project.repo })
      : hrefFor({ name: 'project', path: project.path });
  }
</script>

{#snippet status(project: ProjectSummary)}
  {#if project.needs_you}<span class="badge badge--warn"><span class="dot"></span>{project.needs_you}</span>{/if}
  {#if project.working}<span class="badge badge--ok"><span class="dot"></span>{project.working}</span>{/if}
{/snippet}

<main class="center">
  <MainHeader current="center" />

  <div class="bar">
    <div class="toggle" role="group" aria-label="Show">
      <button type="button" aria-pressed={grouping === 'projects'} onclick={() => group('projects')}>Projects</button>
      <button type="button" aria-pressed={grouping === 'sessions'} onclick={() => group('sessions')}>Sessions</button>
    </div>
    {#if grouping === 'projects'}
      <button class="btn btn--quiet edit" type="button" aria-pressed={editing} onclick={() => (editing = !editing)}>
        {editing ? 'Done' : 'Edit'}
      </button>
    {/if}
  </div>

  <div class="scroll">
    {#if data === null && center.error === null}
      {#each [0, 1, 2] as placeholder (placeholder)}
        <div class="skeleton" aria-hidden="true"></div>
      {/each}
      <span class="visually-hidden" role="status">Loading your projects and sessions</span>
    {/if}

    {#if center.error}
      <Problem message={center.error.message} onretry={() => center.refresh()} />
    {/if}

    {#each asking as session (session.id)}
      <NeedsYou {session} onanswered={() => center.refresh()} />
    {/each}

    {#if data && grouping === 'projects'}
      {#if data.groups.length === 0}
        <p class="empty">No project folders yet, and no Claude sessions. Your projects show up here by the folders that hold them.</p>
      {/if}
      {#if editing}
        <p class="hint">Tap the eye to hide a project or a whole group. Hidden ones stay one tap away.</p>
      {/if}

      {#each groups as projectGroup (groupKey(projectGroup))}
        {@const key = groupKey(projectGroup)}
        {@const folded = centerView.folded.includes(key) && !editing}
        {@const groupHidden = centerView.hidden.includes(key)}
        {@const shown = projectGroup.projects.filter(
          (project) => editing || peeking.includes(key) || !centerView.hidden.includes(project.path),
        )}
        {@const hiddenCount = projectGroup.projects.filter((project) => centerView.hidden.includes(project.path)).length}
        <section class="group" class:group--hidden={groupHidden} aria-labelledby={`group-${key}`}>
          <div class="group__head">
            <h2 id={`group-${key}`}>
              <button
                class="group__fold"
                type="button"
                aria-expanded={!folded}
                onclick={() => toggleFolded(key)}
                disabled={editing}
              >
                <span class="chev" class:chev--open={!folded} aria-hidden="true">›</span>
                <span class="group__text">
                  <span class="group__name">{projectGroup.name}</span>
                  <span class="group__line">{groupLine(projectGroup.projects)}</span>
                </span>
              </button>
            </h2>
            {#if editing}
              <button
                class="eye"
                type="button"
                aria-pressed={groupHidden}
                aria-label={groupHidden ? `Show ${projectGroup.name}` : `Hide ${projectGroup.name}`}
                onclick={() => toggleHidden(key)}
              >
                {@render eye(groupHidden)}
              </button>
            {/if}
          </div>

          {#if !folded}
            {#if shown.length > 0}
              <ul class="projects">
                {#each shown as project (project.path)}
                  {@const projectHidden = centerView.hidden.includes(project.path)}
                  <li class="project" class:project--hidden={projectHidden}>
                    <a class="project__link" href={projectHref(project)}>
                      <span class="project__icon" class:project__icon--repo={project.repo} aria-hidden="true">
                        {#if project.repo}
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
                            ><circle cx="6" cy="6" r="2.5"></circle><circle cx="6" cy="18" r="2.5"></circle><circle cx="18" cy="8" r="2.5"></circle><path
                              d="M6 8.5v7M18 10.5c0 4-6 3-11 5.5"
                            ></path></svg
                          >
                        {:else}
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
                            ><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path></svg
                          >
                        {/if}
                      </span>
                      <span class="project__text">
                        <span class="project__name">{project.name}</span>
                        <span class="project__line">{projectLine(project)}</span>
                      </span>
                      <span class="project__side">
                        <span class="project__status">{@render status(project)}</span>
                        {#if project.active_at > 0}<span class="project__when">{ago(project.active_at, nowSecs())}</span>{/if}
                      </span>
                    </a>
                    {#if editing}
                      <button
                        class="eye"
                        type="button"
                        aria-pressed={projectHidden}
                        aria-label={projectHidden ? `Show ${project.name}` : `Hide ${project.name}`}
                        onclick={() => toggleHidden(project.path)}
                      >
                        {@render eye(projectHidden)}
                      </button>
                    {/if}
                  </li>
                {/each}
              </ul>
            {:else if projectGroup.projects.length === 0}
              <p class="none">No folders in it yet.</p>
            {/if}
            {#if !editing && hiddenCount > 0}
              <button
                class="peek"
                type="button"
                onclick={() =>
                  (peeking = peeking.includes(key) ? peeking.filter((other) => other !== key) : [...peeking, key])}
              >
                {peeking.includes(key) ? 'Hide them again' : `Show ${hiddenCount} hidden`}
              </button>
            {/if}
          {/if}
        </section>
      {/each}

      {#if !editing && hiddenGroups > 0}
        <button class="peek" type="button" onclick={() => (editing = true)}>
          {hiddenGroups === 1 ? '1 hidden group' : `${hiddenGroups} hidden groups`} · Edit to show
        </button>
      {/if}
    {:else if data}
      {#if live.length === 0}
        <p class="empty">
          No Claude sessions are running. They show up here once Claude Code's hooks report to Airlock.
        </p>
      {:else}
        <div class="sessions">
          {#each live as session (session.id)}
            <SessionRow {session} where={session.repo_name ?? session.cwd} />
          {/each}
        </div>
      {/if}
    {/if}
  </div>
</main>

{#snippet eye(closed: boolean)}
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    {#if closed}
      <path d="M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.9 5.2A9.7 9.7 0 0 1 12 5c5 0 9 4.5 10 7a12.6 12.6 0 0 1-3.2 4.3M6.1 6.1C3.9 7.5 2.6 9.6 2 12c1 2.5 5 7 10 7a9.6 9.6 0 0 0 4.2-1"
      ></path>
    {:else}
      <path d="M2 12c1-2.5 5-7 10-7s9 4.5 10 7c-1 2.5-5 7-10 7S3 14.5 2 12z"></path><circle cx="12" cy="12" r="3"></circle>
    {/if}
  </svg>
{/snippet}

<style>
  .center {
    height: 100%;
    display: flex;
    flex-direction: column;
    padding-top: var(--safe-top);
  }
  .bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--s-2);
    padding: 0 var(--s-4) var(--s-2);
  }
  .toggle {
    display: flex;
    padding: 2px;
    border-radius: var(--r-md);
    background: var(--c-surface-2);
  }
  .toggle button {
    height: 32px;
    padding: 0 var(--s-3);
    border: 0;
    border-radius: var(--r-sm);
    background: transparent;
    color: var(--c-text-muted);
    font-size: var(--fs-sm);
    font-weight: 600;
    cursor: pointer;
  }
  .toggle button[aria-pressed='true'] {
    background: var(--c-surface-hover);
    color: var(--c-text);
  }
  .edit {
    min-height: 36px;
  }
  .scroll {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: var(--s-3);
    padding: var(--s-1) var(--s-4) calc(var(--s-5) + var(--safe-bottom));
  }
  .skeleton {
    height: 96px;
    border-radius: var(--r-xl);
    background: var(--c-surface);
  }
  .hint {
    margin: 0;
    color: var(--c-text-muted);
    font-size: var(--fs-md);
  }
  .group {
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
  }
  .group--hidden {
    opacity: 0.55;
  }
  .group__head {
    display: flex;
    align-items: center;
    gap: var(--s-2);
  }
  h2 {
    flex: 1;
    min-width: 0;
    margin: 0;
    font-size: inherit;
  }
  .group__fold {
    width: 100%;
    display: flex;
    align-items: center;
    gap: var(--s-2);
    min-height: var(--tap);
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--c-text);
    text-align: left;
    cursor: pointer;
  }
  .group__fold:disabled {
    cursor: default;
  }
  .chev {
    display: inline-block;
    width: 14px;
    color: var(--c-text-muted);
    font-size: var(--fs-xl);
    transition-property: transform;
    transition-duration: var(--t-enter);
    transition-timing-function: var(--ease);
  }
  .chev--open {
    transform: rotate(90deg);
  }
  .group__text {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .group__name {
    font-size: var(--fs-xl);
    font-weight: 700;
  }
  .group__line {
    color: var(--c-text-muted);
    font-size: var(--fs-sm);
  }
  .projects {
    margin: 0;
    padding: 0;
    overflow: hidden;
    border-radius: var(--r-xl);
    background: var(--c-surface);
    box-shadow: 0 0 0 1px var(--c-line);
    list-style: none;
  }
  .project {
    display: flex;
    align-items: center;
  }
  .project + .project {
    border-top: 1px solid var(--c-surface-2);
  }
  .project--hidden {
    opacity: 0.55;
  }
  .project__link {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: var(--s-3);
    min-height: 60px;
    padding: var(--s-2) var(--s-3);
    color: var(--c-text);
    text-decoration: none;
    transition-property: background-color;
    transition-duration: var(--t-hover);
  }
  .project__link:hover,
  .project__link:active {
    background: var(--c-surface-2);
  }
  .project__icon {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border-radius: var(--r-md);
    background: var(--c-surface-2);
    color: var(--c-folder);
  }
  .project__icon--repo {
    color: var(--c-accent-text);
  }
  .project__text {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .project__name {
    overflow: hidden;
    font-size: var(--fs-lg);
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .project__line {
    overflow: hidden;
    color: var(--c-text-muted);
    font: var(--fs-sm) / 1.4 var(--font-mono);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .project__side {
    flex: 0 0 auto;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: var(--s-1);
  }
  .project__status {
    display: flex;
    gap: var(--s-1);
  }
  .project__when {
    color: var(--c-text-faint);
    font-size: var(--fs-xs);
  }
  .badge {
    display: inline-flex;
    align-items: center;
    gap: var(--s-1);
    height: 20px;
    padding: 0 6px;
    border-radius: var(--r-pill);
    font-size: var(--fs-xs);
    font-weight: 700;
  }
  .badge--warn {
    background: var(--c-warn-soft);
    color: var(--c-warn);
  }
  .badge--ok {
    background: var(--c-ok-soft);
    color: var(--c-ok-text);
  }
  .dot {
    width: 6px;
    height: 6px;
    border-radius: var(--r-pill);
    background: currentColor;
  }
  .eye {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    justify-content: center;
    width: var(--tap);
    height: var(--tap);
    border: 0;
    border-radius: var(--r-md);
    background: transparent;
    color: var(--c-accent-text);
    cursor: pointer;
  }
  .eye[aria-pressed='true'] {
    color: var(--c-text-faint);
  }
  .peek {
    align-self: flex-start;
    min-height: 36px;
    padding: 0 var(--s-2);
    border: 0;
    background: transparent;
    color: var(--c-accent-text);
    font-size: var(--fs-md);
    font-weight: 600;
    cursor: pointer;
  }
  .none {
    margin: 0;
    padding: var(--s-3);
    border-radius: var(--r-xl);
    background: var(--c-surface);
    color: var(--c-text-muted);
    font-size: var(--fs-md);
  }
  .sessions {
    padding: 0 var(--s-3);
    border-radius: var(--r-xl);
    background: var(--c-surface);
    box-shadow: 0 0 0 1px var(--c-line);
  }
  .empty {
    margin: 0;
    padding: var(--s-4);
    border-radius: var(--r-xl);
    background: var(--c-surface);
    color: var(--c-text-muted);
    line-height: 1.45;
  }
</style>
