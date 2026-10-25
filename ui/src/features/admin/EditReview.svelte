<!-- Reviewing one of the phone's edits. With the file unchanged since the
     phone read it: write it, or turn it down. Changed on the laptop since:
     see both changes, then merge them (when they don't overlap), use the
     phone's version, or keep the laptop's. -->
<script lang="ts">
  import DiffFiles from '../../lib/DiffFiles.svelte';
  import { ago, nowSecs } from '../../lib/format';
  import { type Change, type ChangeDetail, hub } from './hub';

  let { change, onclose, ondone }: { change: Change; onclose: () => void; ondone: () => void } = $props();

  const titleId = `review-${Math.random().toString(36).slice(2, 10)}`;
  let dialog: HTMLDialogElement | undefined = $state();
  let detail = $state<ChangeDetail | null>(null);
  let problem = $state<string | null>(null);
  let busy = $state(false);

  $effect(() => {
    dialog?.showModal();
  });

  $effect(() => {
    hub
      .change(change.id)
      .then((loaded) => (detail = loaded))
      .catch((error: Error) => (problem = error.message));
  });

  async function act(work: () => Promise<unknown>) {
    if (busy) return;
    busy = true;
    problem = null;
    try {
      await work();
      dialog?.close();
      ondone();
    } catch (error) {
      problem = error instanceof Error ? error.message : String(error);
    } finally {
      busy = false;
    }
  }

  const conflict = $derived(detail?.change.conflict ?? false);
  const missing = $derived(detail?.change.missing ?? false);
</script>

<dialog bind:this={dialog} class="review" aria-labelledby={titleId} {onclose}>
  <header>
    <h2 id={titleId}>Edit to {change.path}</h2>
    <p class="meta">From {change.device_name} · {ago(change.created_at, nowSecs())}</p>
  </header>

  <div class="body">
    {#if detail === null && problem === null}
      <p class="meta" role="status">Reading the edit…</p>
    {:else if detail}
      {#if missing}
        <p class="warn" role="alert">The file is gone from the laptop, so the edit can't be written.</p>
      {:else if conflict}
        <p class="warn" role="alert">This file changed on the laptop since the phone read it. Here are both changes.</p>
        <h3>What the laptop changed</h3>
        {#if detail.laptop_diff}<DiffFiles files={detail.laptop_diff.files} />{/if}
        <h3>What the phone changed</h3>
        <DiffFiles files={detail.phone_diff.files} />
        {#if !detail.can_merge}
          <p class="meta">The two changes overlap, so they can't be merged by themselves.</p>
        {/if}
      {:else}
        <h3>What the phone changed</h3>
        <DiffFiles files={detail.phone_diff.files} />
      {/if}
    {/if}
    {#if problem}<p class="error-text" role="alert">{problem}</p>{/if}
  </div>

  <footer class="actions">
    <button class="btn btn--quiet" type="button" onclick={() => dialog?.close()}>Later</button>
    {#if detail}
      {#if conflict && !missing}
        <button class="btn" type="button" aria-disabled={busy} onclick={() => act(() => hub.declineChange(change))}>
          Keep the laptop's
        </button>
        <button class="btn btn--danger" type="button" aria-disabled={busy} onclick={() => act(() => hub.applyChange(change, 'phone', true))}>
          Use the phone's version
        </button>
        {#if detail.can_merge}
          <button class="btn btn--primary" type="button" aria-disabled={busy} onclick={() => act(() => hub.applyChange(change, 'merge'))}>
            Merge both
          </button>
        {/if}
      {:else}
        <button class="btn" type="button" aria-disabled={busy} onclick={() => act(() => hub.declineChange(change))}>
          Turn down
        </button>
        {#if !missing}
          <button class="btn btn--primary" type="button" aria-disabled={busy} onclick={() => act(() => hub.applyChange(change, 'phone'))}>
            Write it
          </button>
        {/if}
      {/if}
    {/if}
  </footer>
</dialog>

<style>
  .review {
    display: flex;
    flex-direction: column;
    width: min(860px, calc(100% - 2 * var(--s-4)));
    max-height: calc(100% - 2 * var(--s-6));
    padding: 0;
    border: 0;
    border-radius: var(--r-xl);
    background: var(--c-bg);
    color: var(--c-text);
    box-shadow: var(--shadow-dialog);
  }
  .review:not([open]) {
    display: none;
  }
  .review::backdrop {
    background: var(--c-scrim);
  }
  header {
    padding: var(--s-5) var(--s-5) var(--s-3);
  }
  h2 {
    margin: 0 0 var(--s-1);
    font-size: var(--fs-2xl);
    font-weight: 600;
    overflow-wrap: anywhere;
  }
  h3 {
    margin: var(--s-4) 0 var(--s-2);
    color: var(--c-text-muted);
    font-size: var(--fs-md);
    font-weight: 700;
  }
  .meta {
    margin: 0;
    color: var(--c-text-muted);
    font-size: var(--fs-md);
  }
  .body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 0 var(--s-5) var(--s-4);
  }
  .warn {
    margin: 0;
    padding: var(--s-2) var(--s-3);
    border-radius: var(--r-md);
    background: var(--c-warn-soft);
    color: var(--c-warn);
  }
  .error-text {
    margin: var(--s-3) 0 0;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: var(--s-2);
    padding: var(--s-3) var(--s-5) var(--s-5);
    border-top: 1px solid var(--c-line);
  }
</style>
