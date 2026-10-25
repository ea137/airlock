<!-- The terminals as cards, each with a preview of its screen and its tabs:
     the current look, and Matrix's glowing frames. -->
<script lang="ts">
  import type { Snippet } from 'svelte';

  import type { Terminal } from '../../../lib/api';
  import { hrefFor } from '../../../lib/router.svelte';
  import { activeTab, shortPath, tabCount, tabLabel } from '../labels';

  let {
    terminals,
    home,
    onnew,
    top,
  }: { terminals: Terminal[]; home: string; onnew: () => void; top: Snippet } = $props();
</script>

<div class="scroll">
  {@render top()}
  {#each terminals as terminal, index (terminal.id)}
    {@const current = activeTab(terminal)}
    <a class="card" class:card--lead={index === 0} href={hrefFor({ name: 'terminal', id: terminal.id })}>
      <span class="card__head">
        <span class="card__name">{terminal.name}</span>
        <span class="card__meta">
          {tabCount(terminal)}{#if current} · {shortPath(current.cwd, home)}{/if}
        </span>
      </span>
      {#if terminal.preview.length > 0}
        <pre class="card__preview">{terminal.preview.join('\n')}</pre>
      {/if}
      <span class="chips">
        {#each terminal.tabs as tab (tab.id)}
          <span class="chip" class:chip--active={tab.active}>{tabLabel(tab)}</span>
        {/each}
      </span>
    </a>
  {/each}
</div>

<footer class="foot">
  <button class="btn btn--primary btn--wide" type="button" onclick={onnew}>
    <span aria-hidden="true">+</span> New terminal
  </button>
</footer>

<style>
  .scroll {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: var(--s-3);
    padding: var(--s-1) var(--s-4) var(--s-3);
  }
  .card {
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
    padding: var(--s-3);
    border-radius: var(--r-xl);
    background: var(--c-surface);
    box-shadow: 0 0 0 1px var(--c-line);
    color: var(--c-text);
    text-decoration: none;
    transition-property: background-color;
    transition-duration: var(--t-hover);
  }
  .card:hover,
  .card:active {
    background: var(--c-surface-2);
  }
  .card__head {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .card__name {
    font-size: var(--fs-xl);
    font-weight: 600;
  }
  .card__meta {
    font-size: var(--fs-sm);
    color: var(--c-text-muted);
  }
  .card__preview {
    margin: 0;
    padding: var(--s-2) var(--s-3);
    border-radius: var(--r-md);
    background: var(--c-terminal);
    color: var(--c-terminal-text);
    font: var(--fs-xs) / 1.5 var(--font-terminal);
    white-space: pre;
    overflow: hidden;
  }
  /* More tabs than fit fade out at the edge instead of stopping mid-word. */
  .chips {
    display: flex;
    gap: var(--s-2);
    overflow: hidden;
    mask-image: linear-gradient(to right, black calc(100% - 28px), transparent);
  }
  .chip {
    flex: 0 0 auto;
    padding: var(--s-1) var(--s-2);
    border-radius: var(--r-sm);
    background: var(--c-surface-2);
    color: var(--c-text-muted);
    font-size: var(--fs-sm);
    font-weight: 500;
  }
  .chip--active {
    background: var(--c-surface-3);
    color: var(--c-text);
  }
  .foot {
    padding: var(--s-3) var(--s-4) calc(var(--s-5) + var(--safe-bottom));
  }

  /* Matrix: frames of light, the first one brightest. */
  :global(:root[data-theme='matrix']) .card {
    border: 1px solid var(--c-text-muted);
    box-shadow: none;
  }
  :global(:root[data-theme='matrix']) .card--lead {
    border-color: var(--c-accent);
    box-shadow:
      0 0 14px rgb(0 255 65 / 0.3),
      inset 0 0 14px rgb(0 255 65 / 0.08);
  }
  :global(:root[data-theme='matrix']) .card__name {
    font-size: 18px;
    font-weight: 400;
    letter-spacing: 3px;
    text-transform: uppercase;
    text-shadow: 0 0 6px rgb(0 255 65 / 0.6);
  }
  :global(:root[data-theme='matrix']) .card__preview {
    border-left: 2px solid var(--c-text-muted);
    background: rgb(0 255 65 / 0.05);
    font-size: var(--fs-sm);
  }
  :global(:root[data-theme='matrix']) .chip {
    border: 1px solid var(--c-text-muted);
    background: transparent;
    color: var(--c-text);
  }
  :global(:root[data-theme='matrix']) .chip--active {
    border-color: var(--c-accent);
    background: var(--c-accent);
    color: var(--c-on-accent);
  }
  :global(:root[data-theme='matrix']) .foot :global(.btn) {
    height: 52px;
    font-size: 17px;
    letter-spacing: 4px;
  }
</style>
