<!-- Opens a terminal: the folder it starts in (see FolderPicker), and a
     name, which defaults to the folder's. -->
<script lang="ts">
  import { api } from '../../lib/api';
  import { go } from '../../lib/router.svelte';
  import { handleError, session } from '../../lib/session.svelte';
  import Sheet from '../../lib/Sheet.svelte';
  import FolderPicker from './FolderPicker.svelte';
  import { terminalList } from './terminals.svelte';

  let { onclose }: { onclose: () => void } = $props();

  let chosen = $state('');
  let name = $state('');
  let creating = $state(false);
  let notice = $state<string | null>(null);

  const home = $derived(session.state.status === 'paired' ? session.state.session.home : '');
  const chosenName = $derived(chosen === home ? 'Home' : (chosen.split('/').filter(Boolean).at(-1) ?? 'home'));

  async function create() {
    if (creating || !chosen) return;
    creating = true;
    notice = null;
    try {
      const { id } = await api.createTerminal(name.trim(), chosen);
      await terminalList.refresh();
      onclose();
      go({ name: 'terminal', id });
    } catch (error) {
      notice = handleError(error).message;
    } finally {
      creating = false;
    }
  }
</script>

<Sheet title="New terminal" {onclose}>
  <div class="name">
    <label for="terminal-name">Name</label>
    <input
      id="terminal-name"
      bind:value={name}
      placeholder={chosen ? chosenName : 'The folder name'}
      maxlength="40"
      autocomplete="off"
    />
  </div>

  <FolderPicker legend="Start in" bind:chosen />

  {#if notice}<p class="error-text" role="alert">{notice}</p>{/if}

  <button class="btn btn--primary btn--wide go" type="button" onclick={create} aria-disabled={creating || !chosen}>
    {#if creating}
      Opening…
    {:else}
      Open terminal{#if chosen}<span class="go__where">&nbsp;in {chosenName}</span>{/if}
    {/if}
  </button>
</Sheet>

<style>
  .name {
    display: flex;
    flex-direction: column;
    gap: var(--s-1);
  }
  .name label {
    color: var(--c-text-muted);
    font-size: var(--fs-sm);
    font-weight: 600;
  }
  .name input {
    height: 48px;
    padding: 0 var(--s-3);
    border: 1px solid var(--c-surface-3);
    border-radius: var(--r-lg);
    background: var(--c-bg);
    font-size: var(--fs-xl);
    -webkit-user-select: text;
    user-select: text;
  }
  .name input:focus-visible {
    outline-offset: 0;
    border-color: var(--c-accent);
  }
  .go {
    min-height: 50px;
    font-size: var(--fs-xl);
  }
  .go__where {
    overflow: hidden;
    max-width: 55%;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
