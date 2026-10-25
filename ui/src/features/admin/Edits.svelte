<!-- The phone's edits to files: waiting ones to review, then what became of
     the latest. Nothing is written until you approve it here. -->
<script lang="ts">
  import { ago } from '../../lib/format';
  import EditReview from './EditReview.svelte';
  import type { Change } from './hub';

  let { changes, now, onchanged }: { changes: Change[]; now: number; onchanged: () => void } = $props();

  const STATE_LABEL = {
    pending: 'waiting',
    written: 'written',
    declined: 'turned down',
    withdrawn: 'taken back',
  } as const;

  let reviewing = $state<Change | null>(null);

  const waiting = $derived(changes.filter((change) => change.state === 'pending'));
  const decided = $derived(changes.filter((change) => change.state !== 'pending').slice(0, 5));
</script>

{#if changes.length > 0}
  <section aria-labelledby="edits-title">
    <h2 id="edits-title">Edits from the phone</h2>
    {#if waiting.length === 0}
      <p class="empty">No edits are waiting.</p>
    {:else}
      <ul class="list">
        {#each waiting as change (change.id)}
          <li class="row">
            <div class="who">
              <span class="path">{change.path}</span>
              <span class="meta">
                {change.device_name} · {ago(change.created_at, now)}
                {#if change.conflict}<span class="conflict">· changed on the laptop since</span>{/if}
                {#if change.missing}<span class="conflict">· the file is gone</span>{/if}
              </span>
            </div>
            <button class="btn btn--primary" type="button" onclick={() => (reviewing = change)}>Review</button>
          </li>
        {/each}
      </ul>
    {/if}
    {#if decided.length > 0}
      <ul class="done">
        {#each decided as change (change.id)}
          <li>
            <span class="path">{change.path}</span>
            <span class="meta">{STATE_LABEL[change.state]}{#if change.outcome} · {change.outcome}{/if}</span>
          </li>
        {/each}
      </ul>
    {/if}
  </section>
{/if}

{#if reviewing}
  <EditReview
    change={reviewing}
    onclose={() => (reviewing = null)}
    ondone={() => {
      reviewing = null;
      onchanged();
    }}
  />
{/if}

<style>
  h2 {
    margin: 0 0 var(--s-3);
    font-size: var(--fs-xl);
    font-weight: 600;
  }
  .empty {
    margin: 0;
    color: var(--c-text-muted);
  }
  .list {
    margin: 0;
    padding: 0;
    list-style: none;
    border-radius: var(--r-xl);
    background: var(--c-surface);
    box-shadow: 0 0 0 1px var(--c-warn);
  }
  .row {
    display: flex;
    align-items: center;
    gap: var(--s-3);
    padding: var(--s-3) var(--s-3) var(--s-3) var(--s-4);
  }
  .row + .row {
    border-top: 1px solid var(--c-line);
  }
  .who {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: var(--s-1);
  }
  .path {
    overflow-wrap: anywhere;
    font: var(--fs-md) var(--font-mono);
  }
  .meta {
    color: var(--c-text-muted);
    font-size: var(--fs-md);
  }
  .conflict {
    color: var(--c-warn);
  }
  .done {
    display: flex;
    flex-direction: column;
    gap: var(--s-1);
    margin: var(--s-3) 0 0;
    padding: 0;
    list-style: none;
    font-size: var(--fs-md);
  }
  .done li {
    display: flex;
    gap: var(--s-2);
    color: var(--c-text-muted);
  }
  .done .path {
    color: var(--c-text-soft);
    font-size: var(--fs-sm);
  }
</style>
