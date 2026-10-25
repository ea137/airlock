<!-- A folder on the laptop: its files and folders as a list or a grid in the
     order you pick, a search by name, and a terminal or the laptop's file
     manager opened right there. -->
<script lang="ts">
  import { api, type FileEntry, type Folder, type MyChange } from '../../lib/api';
  import MainHeader from '../../lib/MainHeader.svelte';
  import { Polled } from '../../lib/polled.svelte';
  import Problem from '../../lib/Problem.svelte';
  import { go, hrefFor } from '../../lib/router.svelte';
  import { handleError } from '../../lib/session.svelte';
  import { arrange, type FolderView, SORT_ORDERS } from './arrange';
  import FolderEntries from './FolderEntries.svelte';
  import { crumbs } from './labels';
  import { arrangement, setOrder, setView } from './view.svelte';

  let { path }: { path: string } = $props();

  const REFRESH_MS = 10_000;
  const SEARCH_DELAY_MS = 300;

  let hidden = $state(false);
  let query = $state('');
  let found = $state<FileEntry[] | null>(null);
  let searching = $state(false);
  let notice = $state<{ text: string; error: boolean } | null>(null);
  let waiting = $state<MyChange[]>([]);

  const folder = new Polled<Folder>(() => api.folder(path, hidden), REFRESH_MS);
  $effect(() => folder.watch());

  $effect(() => {
    api
      .myEdits()
      .then(({ changes }) => (waiting = changes.filter((change) => change.state === 'pending')))
      .catch(() => {});
  });

  // Searching by name, a moment after typing stops.
  $effect(() => {
    const words = query.trim();
    if (!words) {
      found = null;
      return;
    }
    searching = true;
    const timer = setTimeout(async () => {
      try {
        found = (await api.searchFiles(path, words)).entries;
      } catch (error) {
        notice = { text: handleError(error).message, error: true };
      } finally {
        searching = false;
      }
    }, SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  });

  const data = $derived(folder.data);
  const shown = $derived(arrange(found ?? data?.entries ?? [], arrangement.order));
  const orderLabel = $derived(SORT_ORDERS.find((order) => order.value === arrangement.order)?.label ?? '');
  const VIEWS: readonly { value: FolderView; label: string }[] = [
    { value: 'list', label: 'List view' },
    { value: 'grid', label: 'Grid view' },
  ];

  function pickOrder(event: Event & { currentTarget: HTMLSelectElement }) {
    const picked = SORT_ORDERS.find((order) => order.value === event.currentTarget.value);
    if (picked) setOrder(picked.value);
  }

  function toggleHidden() {
    hidden = !hidden;
    void folder.refresh();
  }

  async function terminalHere() {
    notice = null;
    try {
      const name = data?.name === '~' ? 'home' : (data?.name ?? 'terminal');
      const { id } = await api.createTerminal(name, path);
      go({ name: 'terminal', id });
    } catch (error) {
      notice = { text: handleError(error).message, error: true };
    }
  }

  async function showOnLaptop() {
    notice = null;
    try {
      await api.openOnLaptop(path);
      notice = { text: 'Opened on the laptop.', error: false };
    } catch (error) {
      notice = { text: handleError(error).message, error: true };
    }
  }
</script>

<main class="files">
  <MainHeader current="files" />

  <!-- The path and tools scroll with the folder, so a short screen (the
       Game Boy's) still has room for the files. -->
  <div class="scroll">
    <nav class="crumbs" aria-label="Folder path">
      {#each crumbs(path) as crumb, index (crumb.path)}
        {#if index > 0}<span class="sep" aria-hidden="true">›</span>{/if}
        {#if crumb.path === path}
          <span aria-current="page" class="here">{crumb.label}</span>
        {:else}
          <a href={hrefFor({ name: 'files', path: crumb.path })}>{crumb.label}</a>
        {/if}
      {/each}
    </nav>

    <div class="tools">
      <div class="find">
        <label class="search">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"
            ><circle cx="11" cy="11" r="7"></circle><path d="M21 21l-4.3-4.3"></path></svg
          >
          <span class="visually-hidden">Search files</span>
          <input type="search" bind:value={query} placeholder={`Search in ${data?.name ?? 'this folder'}`} autocomplete="off" />
        </label>
        <div class="views" role="group" aria-label="Show as">
          {#each VIEWS as option (option.value)}
            <button
              class="view"
              type="button"
              aria-label={option.label}
              aria-pressed={arrangement.view === option.value}
              onclick={() => setView(option.value)}
            >
              {#if option.value === 'list'}
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"
                  ><path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"></path></svg
                >
              {:else}
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"
                  ><rect x="4" y="4" width="6.5" height="6.5" rx="1.5"></rect><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5"></rect><rect
                    x="4"
                    y="13.5"
                    width="6.5"
                    height="6.5"
                    rx="1.5"
                  ></rect><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5"></rect></svg
                >
              {/if}
            </button>
          {/each}
        </div>
      </div>
      <div class="actions">
        <button class="btn" type="button" onclick={terminalHere}>Terminal here</button>
        <button class="btn" type="button" onclick={showOnLaptop}>Show on laptop</button>
      </div>
      {#if waiting.length > 0}
        <a class="waiting" href={hrefFor({ name: 'edits' })}>
          {waiting.length} {waiting.length === 1 ? 'edit' : 'edits'} waiting on the laptop ›
        </a>
      {/if}
      {#if notice}
        <p class={notice.error ? 'error-text' : 'note'} role={notice.error ? 'alert' : 'status'}>{notice.text}</p>
      {/if}
    </div>

    {#if data === null && folder.error === null}
      <div class="list list--skeleton" aria-hidden="true"></div>
      <span class="visually-hidden" role="status">Loading the folder</span>
    {:else if folder.error && data === null}
      <Problem message={folder.error.message} onretry={() => folder.refresh()} />
    {:else}
      {#if found !== null && found.length === 0 && !searching}
        <p class="empty">Nothing here is called "{query.trim()}".</p>
      {:else if found === null && shown.length === 0}
        <p class="empty">This folder is empty.</p>
      {/if}
      {#if shown.length > 0}
        <div class="order">
          <span class="count">{shown.length} {shown.length === 1 ? 'item' : 'items'}</span>
          <label class="sort">
            <span class="visually-hidden">Sort by</span>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
              ><path d="M7 4v16M3 16l4 4 4-4M17 20V4M13 8l4-4 4 4"></path></svg
            >
            <span aria-hidden="true">{orderLabel}</span>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
              ><path d="M6 9l6 6 6-6"></path></svg
            >
            <!-- The phone's own picker, laid over the pill so the pill fits its words. -->
            <select value={arrangement.order} onchange={pickOrder}>
              {#each SORT_ORDERS as order (order.value)}
                <option value={order.value}>{order.label}</option>
              {/each}
            </select>
          </label>
        </div>
        <FolderEntries entries={shown} view={arrangement.view} results={found !== null} />
      {/if}
      {#if found === null && data && (data.hidden > 0 || hidden)}
        <button class="hidden" type="button" onclick={toggleHidden}>
          {hidden
            ? 'Hide hidden items'
            : `Show ${data.hidden} hidden ${data.hidden === 1 ? 'item' : 'items'}`}
        </button>
      {/if}
    {/if}
  </div>
</main>

<style>
  .files {
    height: 100%;
    display: flex;
    flex-direction: column;
    padding-top: var(--safe-top);
  }
  .crumbs {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--s-1);
    font-size: var(--fs-lg);
  }
  /* Big enough to tap, "~" included. */
  .crumbs a,
  .here {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 24px;
    min-height: 32px;
  }
  .crumbs a {
    color: var(--c-accent-text);
    text-decoration: none;
  }
  .sep {
    color: var(--c-text-faint);
  }
  .here {
    font-weight: 600;
  }
  .tools {
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
    padding-bottom: var(--s-2);
  }
  .find {
    display: flex;
    gap: var(--s-2);
  }
  .search {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: var(--s-2);
    height: 40px;
    padding: 0 var(--s-3);
    border-radius: var(--r-lg);
    background: var(--c-surface-2);
    color: var(--c-text-muted);
  }
  .search input {
    flex: 1;
    min-width: 0;
    border: 0;
    background: transparent;
    font-size: var(--fs-lg);
    -webkit-user-select: text;
    user-select: text;
  }
  .search input:focus-visible {
    outline: none;
  }
  .search:focus-within {
    box-shadow: 0 0 0 2px var(--c-accent-text);
  }
  .views {
    display: flex;
    flex: 0 0 auto;
    padding: 2px;
    border-radius: var(--r-lg);
    background: var(--c-surface-2);
  }
  .view {
    display: grid;
    place-items: center;
    width: 40px;
    height: 36px;
    border: 0;
    border-radius: var(--r-md);
    background: transparent;
    color: var(--c-text-muted);
    cursor: pointer;
    transition-property: background-color, color;
    transition-duration: var(--t-hover);
  }
  .view:hover {
    color: var(--c-text);
  }
  .view[aria-pressed='true'] {
    background: var(--c-surface-3);
    color: var(--c-text);
  }
  .view:focus-visible {
    outline: 2px solid var(--c-accent-text);
    outline-offset: -2px;
  }
  .order {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--s-2);
    padding: 0 var(--s-1) var(--s-2);
  }
  .count {
    color: var(--c-text-muted);
    font-size: var(--fs-sm);
  }
  .sort {
    position: relative;
    display: flex;
    align-items: center;
    gap: var(--s-1);
    min-height: 32px;
    padding: 0 var(--s-2);
    border-radius: var(--r-pill);
    color: var(--c-text-soft);
    font-size: var(--fs-md);
    font-weight: 600;
    transition-property: background-color;
    transition-duration: var(--t-hover);
  }
  .sort:hover {
    background: var(--c-surface-2);
  }
  .sort:focus-within {
    box-shadow: 0 0 0 2px var(--c-accent-text);
  }
  .sort select {
    position: absolute;
    inset: 0;
    width: 100%;
    /* iOS zooms into a focused field under 16px. */
    font-size: 16px;
    opacity: 0;
    cursor: pointer;
  }
  .actions {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--s-2);
  }
  .waiting {
    display: inline-flex;
    align-items: center;
    min-height: 32px;
    color: var(--c-warn);
    font-size: var(--fs-md);
    font-weight: 600;
    text-decoration: none;
  }
  .note {
    margin: 0;
    color: var(--c-ok-text);
    font-size: var(--fs-md);
  }
  .error-text {
    margin: 0;
  }
  .scroll {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    padding: var(--s-1) var(--s-4) calc(var(--s-5) + var(--safe-bottom));
  }
  .list--skeleton {
    height: 280px;
    border-radius: var(--r-lg);
    background: var(--c-surface);
    box-shadow: 0 0 0 1px var(--c-line);
  }
  .hidden {
    align-self: center;
    min-height: var(--tap);
    margin-top: var(--s-2);
    padding: 0 var(--s-3);
    border: 0;
    background: transparent;
    color: var(--c-text-muted);
    font-size: var(--fs-md);
    cursor: pointer;
  }
  .empty {
    margin: 0;
    padding: var(--s-4);
    border-radius: var(--r-xl);
    background: var(--c-surface);
    color: var(--c-text-muted);
  }
</style>
