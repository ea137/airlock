<!-- This phone's edits: waiting for the laptop, written, or not. A waiting
     edit can be taken back. -->
<script lang="ts">
  import { api, type MyChange } from '../../lib/api';
  import { ago, nowSecs } from '../../lib/format';
  import { Polled } from '../../lib/polled.svelte';
  import Problem from '../../lib/Problem.svelte';
  import { hrefFor } from '../../lib/router.svelte';
  import { handleError } from '../../lib/session.svelte';
  import SubHeader from '../../lib/SubHeader.svelte';

  const REFRESH_MS = 5000;
  const STATE_LABEL = {
    pending: 'Waiting for the laptop',
    written: 'Written',
    declined: 'Not written',
    withdrawn: 'Taken back',
  } as const;

  const edits = new Polled<MyChange[]>(async () => (await api.myEdits()).changes, REFRESH_MS);
  $effect(() => edits.watch());

  let problem = $state<string | null>(null);

  async function withdraw(change: MyChange) {
    problem = null;
    try {
      await api.withdrawEdit(change.id);
      await edits.refresh();
    } catch (error) {
      problem = handleError(error).message;
    }
  }
</script>

<main class="screen">
  <SubHeader back={hrefFor({ name: 'files', path: '~' })} backLabel="Files" title="Your edits" />

  <div class="scroll">
    {#if problem}<p class="error-text" role="alert">{problem}</p>{/if}
    {#if edits.data === null && edits.error}
      <Problem message={edits.error.message} onretry={() => edits.refresh()} />
    {:else if edits.data && edits.data.length === 0}
      <p class="empty">No edits yet. Open a file and tap Edit; the laptop approves before anything is written.</p>
    {:else if edits.data}
      <ul class="list">
        {#each edits.data as change (change.id)}
          <li class="edit">
            <div class="text">
              <a class="path" href={hrefFor({ name: 'file', path: change.path })}>{change.path}</a>
              <span class={`state state--${change.state}`}>{STATE_LABEL[change.state]}</span>
              <span class="meta">
                sent {ago(change.created_at, nowSecs())}{#if change.outcome} · {change.outcome}{/if}
              </span>
            </div>
            {#if change.state === 'pending'}
              <button class="btn btn--quiet" type="button" onclick={() => withdraw(change)}>Take back</button>
            {/if}
          </li>
        {/each}
      </ul>
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
    display: flex;
    flex-direction: column;
    gap: var(--s-3);
    padding: var(--s-3) var(--s-4) var(--s-5);
  }
  .list {
    margin: 0;
    padding: 0;
    overflow: hidden;
    border-radius: var(--r-lg);
    background: var(--c-surface);
    box-shadow: 0 0 0 1px var(--c-line);
    list-style: none;
  }
  .edit {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    padding: var(--s-3);
  }
  .edit + .edit {
    border-top: 1px solid var(--c-surface-2);
  }
  .text {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .path {
    display: block;
    padding: var(--s-1) 0;
    overflow: hidden;
    color: var(--c-text);
    font: var(--fs-md) var(--font-mono);
    text-decoration: none;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .state {
    font-size: var(--fs-md);
    font-weight: 600;
  }
  .state--pending {
    color: var(--c-warn);
  }
  .state--written {
    color: var(--c-ok-text);
  }
  .state--declined,
  .state--withdrawn {
    color: var(--c-text-muted);
  }
  .meta {
    color: var(--c-text-muted);
    font-size: var(--fs-sm);
  }
  .empty {
    margin: 0;
    padding: var(--s-4);
    border-radius: var(--r-xl);
    background: var(--c-surface);
    color: var(--c-text-muted);
    line-height: 1.45;
  }
  .error-text {
    margin: 0;
  }
</style>
