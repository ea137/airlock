<script lang="ts">
  import type { DiffFile } from './api';

  let { files, openFirst = 3 }: { files: DiffFile[]; openFirst?: number } = $props();

  const STATUS_LABEL = { added: 'new', deleted: 'deleted', renamed: 'renamed', modified: '' } as const;
</script>

{#each files as file, index (file.path)}
  <details class="file" open={index < openFirst}>
    <summary>
      <span class="path">{file.old_path ? `${file.old_path} → ${file.path}` : file.path}</span>
      {#if STATUS_LABEL[file.status]}<span class="status">{STATUS_LABEL[file.status]}</span>{/if}
      <span class="added">+{file.added}</span>
      <span class="removed">−{file.removed}</span>
    </summary>
    {#if file.binary}
      <p class="binary">Binary file.</p>
    {:else}
      <div class="code">
        {#each file.hunks as hunk, h (h)}
          <div class="hunk">{hunk.header}</div>
          {#each hunk.lines as line, l (l)}
            <div class={`line line--${line.kind}`}>
              <span class="sign" aria-hidden="true">{line.kind === 'add' ? '+' : line.kind === 'del' ? '−' : ' '}</span>{line.text}
            </div>
          {/each}
        {/each}
      </div>
    {/if}
  </details>
{/each}

<style>
  .file {
    overflow: hidden;
    border-radius: var(--r-lg);
    background: var(--c-surface);
    box-shadow: 0 0 0 1px var(--c-line);
  }
  .file + .file {
    margin-top: var(--s-3);
  }
  summary {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    min-height: var(--tap);
    padding: 0 var(--s-3);
    font: var(--fs-sm) / 1.4 var(--font-mono);
    cursor: pointer;
  }
  .file[open] summary {
    border-bottom: 1px solid var(--c-line);
  }
  .path {
    flex: 1;
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .status {
    color: var(--c-text-muted);
    font-family: var(--font-ui);
  }
  .added {
    color: var(--c-add);
  }
  .removed {
    color: var(--c-del);
  }
  .binary {
    margin: 0;
    padding: var(--s-3);
    color: var(--c-text-muted);
  }
  .code {
    overflow-x: auto;
    font: var(--fs-xs) / 1.55 var(--font-mono);
    -webkit-user-select: text;
    user-select: text;
  }
  .hunk {
    padding: var(--s-1) var(--s-3);
    background: var(--c-accent-soft);
    color: var(--c-accent-text);
    white-space: pre;
  }
  .line {
    min-width: max-content;
    padding: 0 var(--s-3) 0 var(--s-2);
    white-space: pre;
  }
  .line--add {
    background: var(--c-add-soft);
  }
  .line--del {
    background: var(--c-del-soft);
  }
  .sign {
    display: inline-block;
    width: 1.5ch;
    color: var(--c-text-faint);
  }
  .line--add .sign {
    color: var(--c-add);
  }
  .line--del .sign {
    color: var(--c-del);
  }
</style>
