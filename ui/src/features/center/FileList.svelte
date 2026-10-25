<!-- Files with the lines each added and removed; the first few, then all on
     request. -->
<script lang="ts">
  import type { FileChange } from '../../lib/api';

  let { files, first = 6 }: { files: FileChange[]; first?: number } = $props();

  let all = $state(false);
  const shown = $derived(all ? files : files.slice(0, first));
</script>

<ul class="files">
  {#each shown as file (file.path)}
    <li class="file">
      <span class="file__path">{file.path}</span>
      {#if file.added === null}
        <span class="binary">binary</span>
      {:else}
        <span class="added">+{file.added}</span>
        <span class="removed">−{file.removed}</span>
      {/if}
    </li>
  {/each}
  {#if files.length > shown.length}
    <li>
      <button class="more" type="button" onclick={() => (all = true)}>All {files.length} files ›</button>
    </li>
  {/if}
</ul>

<style>
  .files {
    margin: 0;
    padding: 0;
    overflow: hidden;
    border-radius: var(--r-lg);
    background: var(--c-surface);
    box-shadow: 0 0 0 1px var(--c-line);
    font: var(--fs-sm) / 1.4 var(--font-mono);
    list-style: none;
  }
  li + li {
    border-top: 1px solid var(--c-surface-2);
  }
  .file {
    display: flex;
    gap: var(--s-2);
    padding: var(--s-2) var(--s-3);
  }
  .file__path {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .added {
    color: var(--c-add);
  }
  .removed {
    color: var(--c-del);
  }
  .binary {
    color: var(--c-text-muted);
  }
  .more {
    width: 100%;
    min-height: var(--tap);
    padding: 0 var(--s-3);
    border: 0;
    background: none;
    color: var(--c-accent-text);
    font: 600 var(--fs-md) var(--font-ui);
    text-align: left;
    cursor: pointer;
  }
</style>
