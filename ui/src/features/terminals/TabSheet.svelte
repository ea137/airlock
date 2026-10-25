<!-- A tab's options, opened by holding it: its name, and closing it. -->
<script lang="ts">
  import { untrack } from 'svelte';

  import { api, type Tab } from '../../lib/api';
  import { handleError } from '../../lib/session.svelte';
  import Sheet from '../../lib/Sheet.svelte';
  import { tabLabel } from './labels';

  let { tab, ondone, onclose }: { tab: Tab; ondone: () => void; onclose: () => void } = $props();

  // The field starts from the name you gave the tab, if any; later edits are yours.
  let name = $state(untrack(() => tab.name));
  let confirming = $state(false);
  let busy = $state(false);
  let notice = $state<string | null>(null);

  async function run(work: () => Promise<unknown>) {
    if (busy) return;
    busy = true;
    notice = null;
    try {
      await work();
      ondone();
      onclose();
    } catch (error) {
      notice = handleError(error).message;
    } finally {
      busy = false;
    }
  }
</script>

<Sheet title={tabLabel(tab)} {onclose}>
  {#if confirming}
    <p class="warning">Close "{tabLabel(tab)}"? Anything running in it stops.</p>
    <div class="pair">
      <button class="btn" type="button" onclick={() => (confirming = false)}>Keep it</button>
      <button class="btn btn--danger" type="button" aria-disabled={busy} onclick={() => run(() => api.closeTab(tab.id))}>
        Close tab
      </button>
    </div>
  {:else}
    <div class="field">
      <label for="tab-name">Name</label>
      <input id="tab-name" bind:value={name} placeholder={tab.folder} maxlength="40" autocomplete="off" />
    </div>
    <p class="hint">Leave it empty to name the tab after its folder and what's running.</p>
    <button
      class="btn btn--primary btn--wide"
      type="button"
      aria-disabled={busy}
      onclick={() => run(() => api.renameTab(tab.id, name.trim()))}
    >
      Save name
    </button>
    <button class="btn btn--quiet btn--wide danger" type="button" onclick={() => (confirming = true)}>Close tab…</button>
  {/if}
  {#if notice}<p class="error-text" role="alert">{notice}</p>{/if}
</Sheet>

<style>
  .hint,
  .warning {
    margin: 0;
    font-size: var(--fs-md);
    color: var(--c-text-muted);
  }
  .warning {
    font-size: var(--fs-lg);
    color: var(--c-text);
  }
  .pair {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--s-2);
  }
  .danger {
    color: var(--c-danger-text);
  }
</style>
