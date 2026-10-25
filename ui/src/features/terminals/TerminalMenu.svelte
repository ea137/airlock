<script lang="ts">
  import { untrack } from 'svelte';

  import { api, type Terminal } from '../../lib/api';
  import { go } from '../../lib/router.svelte';
  import { handleError } from '../../lib/session.svelte';
  import Sheet from '../../lib/Sheet.svelte';
  import { tabCount } from './labels';
  import { terminalList } from './terminals.svelte';

  let { terminal, onclose }: { terminal: Terminal; onclose: () => void } = $props();

  // The field starts from the current name; later edits are yours.
  let name = $state(untrack(() => terminal.name));
  let confirming = $state(false);
  let busy = $state(false);
  let notice = $state<string | null>(null);

  async function run(work: () => Promise<unknown>, after: () => void = () => {}) {
    if (busy) return;
    busy = true;
    notice = null;
    try {
      await work();
      await terminalList.refresh();
      onclose();
      after();
    } catch (error) {
      notice = handleError(error).message;
    } finally {
      busy = false;
    }
  }

  function rename() {
    const trimmed = name.trim();
    if (!trimmed) {
      notice = 'A terminal needs a name.';
      return;
    }
    void run(() => api.renameTerminal(terminal.id, trimmed));
  }
</script>

<Sheet title={terminal.name} {onclose}>
  {#if confirming}
    <p class="warning">Close "{terminal.name}" and its {tabCount(terminal)}? Anything running in them stops.</p>
    <div class="pair">
      <button class="btn" type="button" onclick={() => (confirming = false)}>Keep it</button>
      <button
        class="btn btn--danger"
        type="button"
        aria-disabled={busy}
        onclick={() => run(() => api.closeTerminal(terminal.id), () => go({ name: 'terminals' }))}
      >
        Close terminal
      </button>
    </div>
  {:else}
    <div class="field">
      <label for="terminal-rename">Name</label>
      <input id="terminal-rename" bind:value={name} maxlength="40" autocomplete="off" />
    </div>
    <button class="btn btn--primary btn--wide" type="button" aria-disabled={busy} onclick={rename}>Save name</button>
    <button class="btn btn--quiet btn--wide danger" type="button" onclick={() => (confirming = true)}>
      Close terminal…
    </button>
  {/if}
  {#if notice}<p class="error-text" role="alert">{notice}</p>{/if}
</Sheet>

<style>
  .warning {
    margin: 0;
    font-size: var(--fs-lg);
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
