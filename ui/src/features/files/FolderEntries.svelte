<!-- A folder's entries as a list (name, size, when) or a grid of tiles with
     thumbnails for small images, as Ubuntu's Files app shows them. -->
<script lang="ts">
  import { SvelteSet } from 'svelte/reactivity';

  import { type FileEntry, rawUrl } from '../../lib/api';
  import { hrefFor } from '../../lib/router.svelte';
  import { type FolderView, fileType, hasThumbnail } from './arrange';
  import FileIcon from './FileIcon.svelte';
  import { folderOf, humanSize, when } from './labels';

  let {
    entries,
    view,
    results,
  }: {
    entries: FileEntry[];
    view: FolderView;
    /** Search results: each says which folder it's in. */
    results: boolean;
  } = $props();

  /** Thumbnails that didn't load show the icon instead. */
  const broken = new SvelteSet<string>();

  function href(entry: FileEntry): string {
    return entry.kind === 'dir' ? hrefFor({ name: 'files', path: entry.path }) : hrefFor({ name: 'file', path: entry.path });
  }

  function items(entry: FileEntry): string {
    if (entry.items === null) return 'folder';
    return `${entry.items} ${entry.items === 1 ? 'item' : 'items'}`;
  }

  function meta(entry: FileEntry): string {
    if (results) return entry.path;
    return entry.kind === 'dir' ? items(entry) : `${humanSize(entry.size)} · ${when(entry.modified)}`;
  }

  function short(entry: FileEntry): string {
    if (results) return folderOf(entry.path);
    return entry.kind === 'dir' ? items(entry) : humanSize(entry.size);
  }
</script>

{#if view === 'list'}
  <ul class="list" aria-label={results ? 'Search results' : 'Files'}>
    {#each entries as entry (entry.path)}
      <li>
        <a class="row" href={href(entry)}>
          <FileIcon type={fileType(entry)} />
          <span class="text">
            <span class="name">{entry.name}</span>
            <span class="meta">
              {meta(entry)}
              {#if entry.sensitive}<span class="secret">· secret</span>{/if}
            </span>
          </span>
          {#if entry.kind === 'dir'}<span class="chev" aria-hidden="true">›</span>{/if}
        </a>
      </li>
    {/each}
  </ul>
{:else}
  <ul class="grid" aria-label={results ? 'Search results' : 'Files'}>
    {#each entries as entry (entry.path)}
      <li>
        <a class="tile" href={href(entry)}>
          <span class="art">
            {#if hasThumbnail(entry) && !broken.has(entry.path)}
              <img
                src={rawUrl(entry.path, entry.modified)}
                alt=""
                width="64"
                height="64"
                loading="lazy"
                decoding="async"
                onerror={() => broken.add(entry.path)}
              />
            {:else}
              <FileIcon type={fileType(entry)} size={48} />
            {/if}
          </span>
          <span class="tile-name">{entry.name}</span>
          <span class="tile-meta">
            {#if entry.sensitive}<span class="secret">secret</span>{:else}{short(entry)}{/if}
          </span>
        </a>
      </li>
    {/each}
  </ul>
{/if}

<style>
  .list,
  .grid {
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .list {
    overflow: hidden;
    border-radius: var(--r-lg);
    background: var(--c-surface);
    box-shadow: 0 0 0 1px var(--c-line);
  }
  .list li + li {
    border-top: 1px solid var(--c-surface-2);
  }
  .row {
    display: flex;
    align-items: center;
    gap: var(--s-3);
    min-height: 56px;
    padding: 0 var(--s-3);
    color: var(--c-text);
    text-decoration: none;
    transition-property: background-color;
    transition-duration: var(--t-hover);
  }
  .row:hover,
  .tile:hover {
    background: var(--c-surface-2);
  }
  .text {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .name {
    overflow: hidden;
    font-size: var(--fs-lg);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .meta {
    overflow: hidden;
    color: var(--c-text-muted);
    font-size: var(--fs-sm);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .secret {
    color: var(--c-warn);
  }
  .chev {
    color: var(--c-text-faint);
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
    gap: var(--s-2);
  }
  .tile {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--s-1);
    height: 100%;
    padding: var(--s-2) var(--s-1) var(--s-3);
    border-radius: var(--r-lg);
    color: var(--c-text);
    text-align: center;
    text-decoration: none;
    transition-property: background-color;
    transition-duration: var(--t-hover);
  }
  .art {
    display: grid;
    place-items: center;
    width: 64px;
    height: 64px;
  }
  .art img {
    width: 64px;
    height: 64px;
    border-radius: var(--r-md);
    background: var(--c-surface-2);
    box-shadow: 0 0 0 1px var(--c-line);
    object-fit: cover;
  }
  .tile-name {
    display: -webkit-box;
    max-width: 100%;
    overflow: hidden;
    font-size: var(--fs-md);
    line-height: 1.25;
    overflow-wrap: anywhere;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
  }
  .tile-meta {
    max-width: 100%;
    overflow: hidden;
    color: var(--c-text-muted);
    font-size: var(--fs-sm);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
