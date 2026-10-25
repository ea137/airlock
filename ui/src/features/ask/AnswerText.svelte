<script lang="ts">
  import { blocks, type Inline } from './answer';

  let { text }: { text: string } = $props();

  const read = $derived(blocks(text));
</script>

{#snippet line(parts: Inline[])}
  {#each parts as part, index (index)}
    {#if part.kind === 'code'}<code>{part.text}</code>{:else if part.kind === 'strong'}<strong>{part.text}</strong>{:else}{part.text}{/if}
  {/each}
{/snippet}

<div class="answer">
  {#each read as block, index (index)}
    {#if block.kind === 'para'}
      <p>{@render line(block.parts)}</p>
    {:else if block.kind === 'code'}
      <pre>{block.text}</pre>
    {:else if block.ordered}
      <ol>
        {#each block.items as item, at (at)}<li>{@render line(item)}</li>{/each}
      </ol>
    {:else}
      <ul>
        {#each block.items as item, at (at)}<li>{@render line(item)}</li>{/each}
      </ul>
    {/if}
  {/each}
</div>

<style>
  .answer {
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
    line-height: 1.5;
    overflow-wrap: anywhere;
  }
  p,
  ul,
  ol,
  pre {
    margin: 0;
  }
  ul,
  ol {
    padding-left: 1.3em;
  }
  code,
  pre {
    font-family: var(--font-mono);
    font-size: var(--fs-sm);
  }
  code {
    padding: 1px 4px;
    border-radius: var(--r-sm);
    background: var(--c-surface-2);
  }
  pre {
    padding: var(--s-2) var(--s-3);
    overflow-x: auto;
    border-radius: var(--r-md);
    background: var(--c-terminal);
    color: var(--c-terminal-text);
    white-space: pre-wrap;
  }
</style>
