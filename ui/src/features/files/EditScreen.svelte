<!-- Editing a file from the phone. Nothing is written here: the edit goes to
     the laptop, which writes it once you approve it there. -->
<script lang="ts">
  import { api } from '../../lib/api';
  import Problem from '../../lib/Problem.svelte';
  import { go, hrefFor } from '../../lib/router.svelte';
  import { handleError } from '../../lib/session.svelte';
  import SubHeader from '../../lib/SubHeader.svelte';

  let { path }: { path: string } = $props();

  type Load =
    | { status: 'loading' }
    | { status: 'ready'; base: string; name: string }
    | { status: 'error'; message: string };
  let load = $state<Load>({ status: 'loading' });
  let text = $state('');
  let sending = $state(false);
  let problem = $state<string | null>(null);

  async function fetchFile() {
    load = { status: 'loading' };
    try {
      const file = await api.readFile(path);
      if (file.text === undefined) {
        load = { status: 'error', message: "This file isn't text, so it can't be edited here." };
        return;
      }
      load = { status: 'ready', base: file.text, name: file.name };
      text = file.text;
    } catch (error) {
      load = { status: 'error', message: handleError(error).message };
    }
  }

  $effect(() => {
    void fetchFile();
  });

  const changed = $derived(load.status === 'ready' && text !== load.base);

  async function send() {
    if (load.status !== 'ready' || !changed || sending) return;
    sending = true;
    problem = null;
    try {
      await api.proposeEdit(path, load.base, text);
      go({ name: 'edits' });
    } catch (error) {
      problem = handleError(error).message;
    } finally {
      sending = false;
    }
  }
</script>

<main class="screen">
  <SubHeader back={hrefFor({ name: 'file', path })} backLabel="Cancel" title={load.status === 'ready' ? load.name : 'Edit'} />
  <p class="sub">The laptop approves edits before they're written.</p>

  {#if load.status === 'ready'}
    <label class="visually-hidden" for="edit-text">Contents of {load.name}</label>
    <textarea
      id="edit-text"
      class="editor"
      bind:value={text}
      spellcheck="false"
      autocapitalize="off"
      autocomplete="off"
    ></textarea>
    {#if problem}<p class="error-text problem" role="alert">{problem}</p>{/if}
    <footer class="bar">
      <button class="btn btn--primary btn--wide" type="button" aria-disabled={!changed || sending} onclick={send}>
        {sending ? 'Sending…' : changed ? 'Send to the laptop' : 'No changes yet'}
      </button>
    </footer>
  {:else if load.status === 'error'}
    <div class="pad"><Problem message={load.message} onretry={() => fetchFile()} /></div>
  {:else}
    <span class="visually-hidden" role="status">Loading the file</span>
  {/if}
</main>

<style>
  .screen {
    height: 100%;
    display: flex;
    flex-direction: column;
    padding-top: var(--safe-top);
  }
  .sub {
    margin: 0;
    padding: 0 var(--s-4) var(--s-2);
    color: var(--c-text-muted);
    font-size: var(--fs-sm);
    text-align: center;
  }
  .editor {
    flex: 1;
    min-height: 0;
    margin: 0 var(--s-2);
    padding: var(--s-3);
    border: 1px solid var(--c-surface-3);
    border-radius: var(--r-lg);
    background: var(--c-code-bg);
    color: var(--c-code);
    font: var(--fs-md) / 1.55 var(--font-mono);
    white-space: pre;
    overflow: auto;
    resize: none;
    -webkit-user-select: text;
    user-select: text;
  }
  .editor:focus-visible {
    outline: none;
    border-color: var(--c-accent);
  }
  .problem {
    margin: var(--s-2) var(--s-4) 0;
  }
  .bar {
    padding: var(--s-3) var(--s-4) calc(var(--s-5) + var(--safe-bottom));
  }
  .pad {
    padding: 0 var(--s-4);
  }
</style>
