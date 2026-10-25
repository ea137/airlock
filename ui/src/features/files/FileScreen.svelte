<!-- One file: source with colours, Markdown rendered, a web page in a
     sandbox, or an image. Edits go to the laptop for approval. -->
<script lang="ts">
  import { api, type FileRead, rawUrl } from '../../lib/api';
  import Problem from '../../lib/Problem.svelte';
  import { go, hrefFor } from '../../lib/router.svelte';
  import { handleError } from '../../lib/session.svelte';
  import SubHeader from '../../lib/SubHeader.svelte';
  import CodeView from './CodeView.svelte';
  import { fileLine, folderOf } from './labels';

  let { path }: { path: string } = $props();

  type Load = { status: 'loading' } | { status: 'ready'; file: FileRead } | { status: 'error'; message: string };
  let load = $state<Load>({ status: 'loading' });
  let view = $state<'preview' | 'source'>('preview');
  let notice = $state<{ text: string; error: boolean } | null>(null);

  async function fetchFile() {
    load = { status: 'loading' };
    try {
      load = { status: 'ready', file: await api.readFile(path) };
    } catch (error) {
      load = { status: 'error', message: handleError(error).message };
    }
  }

  $effect(() => {
    void fetchFile();
  });

  const folder = $derived(folderOf(path));
  const folderName = $derived(folder === '~' ? 'Home' : folder.slice(folder.lastIndexOf('/') + 1));
  const file = $derived(load.status === 'ready' ? load.file : null);
  const hasPreview = $derived(file?.kind === 'markdown' || file?.kind === 'html');
  const editable = $derived(file?.text !== undefined);

  async function copy() {
    if (file?.text === undefined) return;
    try {
      await navigator.clipboard.writeText(file.text);
      notice = { text: 'Copied.', error: false };
    } catch (error) {
      notice = { text: `Couldn't copy: ${(error as Error).message}`, error: true };
    }
  }

  async function terminalHere() {
    notice = null;
    try {
      const { id } = await api.createTerminal(folderName, folder);
      go({ name: 'terminal', id });
    } catch (error) {
      notice = { text: handleError(error).message, error: true };
    }
  }

  async function openOnLaptop() {
    notice = null;
    try {
      await api.openOnLaptop(path);
      notice = { text: 'Opened on the laptop.', error: false };
    } catch (error) {
      notice = { text: handleError(error).message, error: true };
    }
  }
</script>

<main class="screen">
  <SubHeader back={hrefFor({ name: 'files', path: folder })} backLabel={folderName} title={file?.name ?? path.slice(path.lastIndexOf('/') + 1)} />
  {#if file}
    <p class="sub">{fileLine(file)}</p>
  {/if}

  {#if file && hasPreview}
    <div class="toggle" role="group" aria-label="View">
      <button type="button" aria-pressed={view === 'preview'} onclick={() => (view = 'preview')}>Preview</button>
      <button type="button" aria-pressed={view === 'source'} onclick={() => (view = 'source')}>Source</button>
    </div>
  {/if}

  <div class="body">
    {#if load.status === 'loading'}
      <span class="visually-hidden" role="status">Loading the file</span>
    {:else if load.status === 'error'}
      <Problem message={load.message} onretry={() => fetchFile()} />
    {:else if file}
      {#if file.kind === 'image'}
        <img class="image" src={rawUrl(file.path)} alt={file.name} />
      {:else if file.kind === 'binary'}
        <p class="note">
          {file.too_big ? "It's too big to show on the phone." : "This file isn't text, so it can't be shown here."}
          Open it on the laptop instead.
        </p>
      {:else if file.kind === 'markdown' && view === 'preview'}
        <!-- Rendered by the hub, with any HTML in the file escaped. -->
        <article class="markdown">{@html file.html ?? ''}</article>
      {:else if file.kind === 'html' && view === 'preview'}
        <iframe class="page" title={file.name} src={rawUrl(file.path)} sandbox=""></iframe>
      {:else}
        <CodeView text={file.text ?? ''} language={file.language} />
      {/if}
    {/if}
  </div>

  {#if notice}
    <p class={notice.error ? 'error-text notice' : 'notice ok'} role={notice.error ? 'alert' : 'status'}>{notice.text}</p>
  {/if}

  <footer class="bar">
    <button type="button" onclick={copy} disabled={!editable}>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
        ><rect x="9" y="9" width="12" height="12" rx="2"></rect><path d="M5 15V5a2 2 0 0 1 2-2h10"></path></svg
      >
      Copy
    </button>
    <button type="button" onclick={terminalHere}>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
        ><path d="M4 17l6-5-6-5"></path><path d="M12 19h8"></path></svg
      >
      Terminal here
    </button>
    <button type="button" onclick={openOnLaptop}>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
        ><rect x="4" y="5" width="16" height="11" rx="1.5"></rect><path d="M2 19h20"></path></svg
      >
      Open on laptop
    </button>
    {#if editable}
      <a href={hrefFor({ name: 'edit', path })}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
          ><path d="M4 20h4L19 9l-4-4L4 16z"></path></svg
        >
        Edit
      </a>
    {:else}
      <button type="button" disabled>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
          ><path d="M4 20h4L19 9l-4-4L4 16z"></path></svg
        >
        Edit
      </button>
    {/if}
  </footer>
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
  .toggle {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 2px;
    margin: var(--s-1) var(--s-4) var(--s-3);
    padding: 3px;
    border-radius: var(--r-md);
    background: var(--c-surface-2);
  }
  .toggle button {
    height: 34px;
    border: 0;
    border-radius: var(--r-sm);
    background: transparent;
    color: var(--c-text-muted);
    font-size: var(--fs-md);
    font-weight: 600;
    cursor: pointer;
  }
  .toggle button[aria-pressed='true'] {
    background: var(--c-surface-hover);
    color: var(--c-text);
  }
  .body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    padding: 0 var(--s-2);
  }
  .image {
    max-width: 100%;
    margin: auto;
    border-radius: var(--r-md);
  }
  .page {
    flex: 1;
    min-height: 400px;
    border: 0;
    border-radius: var(--r-md);
    background: var(--c-web-page);
  }
  .note {
    margin: var(--s-4) var(--s-2);
    color: var(--c-text-muted);
    line-height: 1.45;
  }
  .markdown {
    padding: var(--s-1) var(--s-3) var(--s-4);
    font-size: var(--fs-lg);
    line-height: 1.55;
    overflow-wrap: anywhere;
    -webkit-user-select: text;
    user-select: text;
  }
  .markdown :global(h1) {
    margin: 0 0 var(--s-3);
    padding-bottom: var(--s-2);
    border-bottom: 1px solid var(--c-line);
    font-size: 24px;
  }
  .markdown :global(h2) {
    margin: var(--s-5) 0 var(--s-2);
    font-size: 19px;
  }
  .markdown :global(h3) {
    margin: var(--s-4) 0 var(--s-2);
    font-size: var(--fs-2xl);
  }
  .markdown :global(p) {
    margin: 0 0 var(--s-3);
  }
  .markdown :global(ul),
  .markdown :global(ol) {
    margin: 0 0 var(--s-3);
    padding-left: var(--s-5);
  }
  .markdown :global(li + li) {
    margin-top: var(--s-1);
  }
  .markdown :global(a) {
    color: var(--c-accent-text);
  }
  .markdown :global(code) {
    padding: 1px 5px;
    border-radius: 4px;
    background: var(--c-surface-2);
    font: var(--fs-md) var(--font-mono);
  }
  .markdown :global(pre) {
    margin: 0 0 var(--s-3);
    padding: var(--s-2) var(--s-3);
    overflow-x: auto;
    border-radius: var(--r-md);
    background: var(--c-code-bg);
  }
  .markdown :global(pre code) {
    padding: 0;
    background: none;
    color: var(--c-code);
    font-size: var(--fs-sm);
    line-height: 1.5;
  }
  .markdown :global(blockquote) {
    margin: 0 0 var(--s-3);
    padding-left: var(--s-3);
    border-left: 3px solid var(--c-surface-3);
    color: var(--c-text-muted);
  }
  .markdown :global(table) {
    margin: 0 0 var(--s-3);
    border-collapse: collapse;
    font-size: var(--fs-md);
  }
  .markdown :global(th),
  .markdown :global(td) {
    padding: var(--s-1) var(--s-2);
    border: 1px solid var(--c-line);
  }
  .markdown :global(img) {
    max-width: 100%;
  }
  .notice {
    margin: 0;
    padding: var(--s-2) var(--s-4) 0;
    font-size: var(--fs-md);
  }
  .ok {
    color: var(--c-ok-text);
  }
  .bar {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: var(--s-1);
    padding: var(--s-2) var(--s-2) calc(var(--s-5) + var(--safe-bottom));
    border-top: 1px solid var(--c-surface-2);
  }
  .bar button,
  .bar a {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--s-1);
    height: 56px;
    border: 0;
    border-radius: var(--r-lg);
    background: transparent;
    color: var(--c-accent-text);
    font-size: var(--fs-xs);
    font-weight: 600;
    text-decoration: none;
    cursor: pointer;
  }
  .bar button:hover,
  .bar a:hover {
    background: var(--c-surface-2);
  }
  .bar button:disabled {
    color: var(--c-disabled-text);
    background: transparent;
    cursor: default;
  }
</style>
