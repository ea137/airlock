<!-- One repo: its worktrees, the sessions and terminal tabs in each, and its
     pull requests. For looking; tapping a session or tab goes to it. -->
<script lang="ts">
  import { api, type RepoDetail } from '../../lib/api';
  import { Polled } from '../../lib/polled.svelte';
  import Problem from '../../lib/Problem.svelte';
  import { hrefFor } from '../../lib/router.svelte';
  import { session as appSession } from '../../lib/session.svelte';
  import SubHeader from '../../lib/SubHeader.svelte';
  import { shortPath } from '../terminals/labels';
  import { branchName, worktreeChips } from './labels';
  import { openTerminal } from './open';
  import PullBadge from './PullBadge.svelte';
  import SessionRow from './SessionRow.svelte';

  let { repoKey }: { repoKey: string } = $props();

  const REFRESH_MS = 5000;
  const detail = new Polled<RepoDetail>(() => api.repo(repoKey), REFRESH_MS);
  $effect(() => detail.watch());

  const data = $derived(detail.data);
  const home = $derived(appSession.state.status === 'paired' ? appSession.state.session.home : '');
</script>

<main class="screen">
  <SubHeader back={hrefFor({ name: 'center' })} backLabel="Work" title={data?.repo.name ?? 'Repo'} />

  <div class="scroll">
    {#if data}
      <p class="sub">
        {data.repo.github ? `github.com/${data.repo.github}` : 'not on GitHub'}{#if data.repo.base} · base {data.repo.base}{/if}
      </p>

      <h2>WORKTREES · {data.worktrees.length}</h2>
      <ul class="trees">
        {#each data.worktrees as { worktree, sessions, tabs } (worktree.path)}
          <li class="tree">
            <div class="tree__head">
              <span class="tree__name">{worktree.name}</span>
              <span class="tree__path">{shortPath(worktree.path, home)}</span>
            </div>
            <div class="tree__branch">{branchName(worktree)}</div>
            <div class="chips">
              {#each worktreeChips(worktree, sessions.length) as chip (chip)}
                <span class="chip">{chip}</span>
              {/each}
            </div>
            {#if sessions.length || tabs.length}
              <div class="rows">
                {#each sessions as session (session.id)}
                  <SessionRow {session} />
                {/each}
                {#each tabs as tab (tab.tab)}
                  <button class="tab" type="button" onclick={() => openTerminal({ terminal: tab.terminal, tab: tab.tab })}>
                    <span class="tab__dot" aria-hidden="true"></span>
                    <span class="tab__text">Terminal "{tab.terminal_name}" · tab {tab.index} · {tab.command}</span>
                    <span class="chev" aria-hidden="true">›</span>
                  </button>
                {/each}
              </div>
            {/if}
            {#if worktree.ahead > 0 || worktree.changes > 0}
              <a class="link" href={hrefFor({ name: 'diff', key: data.repo.key, worktree: worktree.path })}>Full diff ›</a>
            {/if}
          </li>
        {/each}
      </ul>

      <h2>PULL REQUESTS</h2>
      {#if data.pulls === null}
        <p class="note">{data.pulls_note}</p>
      {:else if data.pulls.length === 0}
        <p class="note">No pull requests yet.</p>
      {:else}
        <ul class="pulls">
          {#each data.pulls as pull (pull.number)}
            <li>
              <a class="pull" href={hrefFor({ name: 'pull', key: data.repo.key, number: pull.number })}>
                <span class="pull__number">#{pull.number}</span>
                <span class="pull__title">{pull.title}</span>
                <PullBadge state={pull.state} draft={pull.draft} />
              </a>
            </li>
          {/each}
        </ul>
      {/if}
    {:else if detail.error}
      <Problem message={detail.error.message} onretry={() => detail.refresh()} />
    {:else}
      <div class="tree tree--skeleton" aria-hidden="true"></div>
      <span class="visually-hidden" role="status">Loading the repo</span>
    {/if}
  </div>
</main>

<style>
  .screen {
    height: 100%;
    display: flex;
    flex-direction: column;
    padding-top: var(--safe-top);
  }
  .scroll {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: var(--s-1) var(--s-4) calc(var(--s-6) + var(--safe-bottom));
  }
  .sub {
    margin: 0 0 var(--s-4);
    color: var(--c-text-muted);
    font-size: var(--fs-sm);
    text-align: center;
  }
  h2 {
    margin: var(--s-4) 0 var(--s-2);
    color: var(--c-text-muted);
    font-size: var(--fs-md);
    font-weight: 700;
    letter-spacing: 0.5px;
  }
  .trees,
  .pulls {
    display: flex;
    flex-direction: column;
    gap: var(--s-3);
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .tree {
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
    padding: var(--s-3);
    border-radius: var(--r-xl);
    background: var(--c-surface);
    box-shadow: 0 0 0 1px var(--c-line);
  }
  .tree--skeleton {
    height: 140px;
  }
  .tree__head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--s-2);
  }
  .tree__name {
    font-size: var(--fs-lg);
    font-weight: 600;
  }
  .tree__path {
    overflow: hidden;
    color: var(--c-text-muted);
    font-size: var(--fs-sm);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .tree__branch {
    color: var(--c-text-soft);
    font: var(--fs-sm) / 1.4 var(--font-mono);
    overflow-wrap: anywhere;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s-2);
  }
  .chip {
    display: inline-flex;
    align-items: center;
    height: 22px;
    padding: 0 var(--s-2);
    border-radius: var(--r-pill);
    background: var(--c-surface-2);
    color: var(--c-text-soft);
    font-size: var(--fs-sm);
  }
  .rows {
    border-top: 1px solid var(--c-surface-2);
  }
  .tab {
    display: flex;
    align-items: center;
    gap: var(--s-3);
    width: 100%;
    min-height: var(--tap);
    padding: 0;
    border: 0;
    border-bottom: 1px solid var(--c-surface-2);
    background: none;
    color: var(--c-text-muted);
    font-size: var(--fs-md);
    text-align: left;
    cursor: pointer;
  }
  .tab__dot {
    flex: 0 0 auto;
    width: 8px;
    height: 8px;
    border-radius: var(--r-pill);
    box-shadow: inset 0 0 0 1.5px var(--c-text-faint);
  }
  .tab__text {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .chev {
    color: var(--c-text-faint);
  }
  .link {
    align-self: flex-start;
    display: inline-flex;
    align-items: center;
    min-height: 32px;
    color: var(--c-accent-text);
    font-size: var(--fs-md);
    font-weight: 600;
    text-decoration: none;
  }
  .pulls {
    gap: 0;
    overflow: hidden;
    border-radius: var(--r-lg);
    background: var(--c-surface);
    box-shadow: 0 0 0 1px var(--c-line);
  }
  .pulls li + li {
    border-top: 1px solid var(--c-surface-2);
  }
  .pull {
    display: flex;
    align-items: center;
    gap: var(--s-3);
    min-height: 52px;
    padding: 0 var(--s-3);
    color: var(--c-text);
    text-decoration: none;
  }
  .pull:hover {
    background: var(--c-surface-2);
  }
  .pull__number {
    color: var(--c-text-muted);
    font-size: var(--fs-md);
  }
  .pull__title {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    font-size: var(--fs-md);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .note {
    margin: 0;
    color: var(--c-text-muted);
    font-size: var(--fs-md);
  }
</style>
