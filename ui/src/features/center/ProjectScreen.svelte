<!-- A project folder that isn't a git repo (notes, a course, a sandbox):
     the Claude sessions and terminal tabs in it, and a way to start work
     there. -->
<script lang="ts">
  import { api, type FolderDetail } from '../../lib/api';
  import { Polled } from '../../lib/polled.svelte';
  import Problem from '../../lib/Problem.svelte';
  import { go, hrefFor } from '../../lib/router.svelte';
  import { handleError, session as appSession } from '../../lib/session.svelte';
  import SubHeader from '../../lib/SubHeader.svelte';
  import { shortPath } from '../terminals/labels';
  import { openTerminal } from './open';
  import SessionRow from './SessionRow.svelte';

  let { path }: { path: string } = $props();

  const REFRESH_MS = 5000;
  const detail = new Polled<FolderDetail>(() => api.folderProject(path), REFRESH_MS);
  $effect(() => detail.watch());

  let problem = $state<string | null>(null);

  const data = $derived(detail.data);
  const home = $derived(appSession.state.status === 'paired' ? appSession.state.session.home : '');
  const name = $derived(path.split('/').filter(Boolean).at(-1) ?? path);

  async function terminalHere() {
    problem = null;
    try {
      const { id } = await api.createTerminal(name, path);
      go({ name: 'terminal', id });
    } catch (error) {
      problem = handleError(error).message;
    }
  }
</script>

<main class="screen">
  <SubHeader back={hrefFor({ name: 'center' })} backLabel="Work" title={name} />

  <div class="scroll">
    <p class="sub">{shortPath(path, home)} · folder</p>

    {#if data}
      <h2>CLAUDE SESSIONS</h2>
      {#if data.sessions.length === 0}
        <p class="note">No Claude sessions here yet.</p>
      {:else}
        <div class="rows">
          {#each data.sessions as session (session.id)}
            <SessionRow {session} />
          {/each}
        </div>
      {/if}

      <h2>TERMINALS HERE</h2>
      {#if data.tabs.length === 0}
        <p class="note">No terminal tab is in this folder.</p>
      {:else}
        <div class="rows">
          {#each data.tabs as tab (tab.tab)}
            <button class="tab" type="button" onclick={() => openTerminal({ terminal: tab.terminal, tab: tab.tab })}>
              <span class="tab__dot" aria-hidden="true"></span>
              <span class="tab__text">Terminal "{tab.terminal_name}" · tab {tab.index} · {tab.command}</span>
              <span class="chev" aria-hidden="true">›</span>
            </button>
          {/each}
        </div>
      {/if}
    {:else if detail.error}
      <Problem message={detail.error.message} onretry={() => detail.refresh()} />
    {:else}
      <div class="rows rows--skeleton" aria-hidden="true"></div>
      <span class="visually-hidden" role="status">Loading the project</span>
    {/if}

    {#if problem}<p class="error-text" role="alert">{problem}</p>{/if}
  </div>

  <footer class="actions">
    <button class="btn" type="button" onclick={terminalHere}>Terminal here</button>
    <a class="btn" href={hrefFor({ name: 'files', path })}>Open in Files</a>
  </footer>
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
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
    padding: var(--s-1) var(--s-4) var(--s-4);
  }
  .sub {
    margin: 0 0 var(--s-2);
    color: var(--c-text-muted);
    font-size: var(--fs-sm);
    text-align: center;
  }
  h2 {
    margin: var(--s-3) 0 0;
    color: var(--c-text-muted);
    font-size: var(--fs-md);
    font-weight: 700;
    letter-spacing: 0.5px;
  }
  .rows {
    padding: 0 var(--s-3);
    border-radius: var(--r-xl);
    background: var(--c-surface);
    box-shadow: 0 0 0 1px var(--c-line);
  }
  .rows--skeleton {
    height: 140px;
  }
  .tab {
    display: flex;
    align-items: center;
    gap: var(--s-3);
    width: 100%;
    min-height: var(--tap);
    padding: 0;
    border: 0;
    background: none;
    color: var(--c-text-muted);
    font-size: var(--fs-md);
    text-align: left;
    cursor: pointer;
  }
  .tab + .tab {
    border-top: 1px solid var(--c-surface-2);
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
  .note {
    margin: 0;
    color: var(--c-text-muted);
    font-size: var(--fs-md);
  }
  .error-text {
    margin: 0;
  }
  .actions {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--s-2);
    padding: var(--s-3) var(--s-4) calc(var(--s-5) + var(--safe-bottom));
  }
</style>
