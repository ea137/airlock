<!-- Game Boy: inside the case's small screen, a compact menu with the first
     terminal in reverse, where it is, and what the buttons do. -->
<script lang="ts">
  import type { Snippet } from 'svelte';

  import type { Terminal } from '../../../lib/api';
  import { hrefFor } from '../../../lib/router.svelte';
  import { activeTab, shortPath } from '../labels';

  let {
    terminals,
    home,
    onnew,
    top,
  }: { terminals: Terminal[]; home: string; onnew: () => void; top: Snippet } = $props();

  const first = $derived(terminals[0]);
</script>

<div class="scroll">
  {@render top()}
  <ul class="menu">
    {#each terminals as terminal, index (terminal.id)}
      <li>
        <a class="row" class:row--lead={index === 0} href={hrefFor({ name: 'terminal', id: terminal.id })}>
          <span class="mark" aria-hidden="true">▶</span>
          <span class="name">{terminal.name}</span>
          <span>{terminal.tabs.length}<span class="visually-hidden"> tabs</span></span>
        </a>
      </li>
    {/each}
  </ul>
  {#if first}
    <p class="where">
      {shortPath(activeTab(first)?.cwd ?? '', home)}<br />{first.preview.at(-1) ?? ''}<span class="cursor" aria-hidden="true"
        >_</span
      >
    </p>
  {/if}
</div>

<footer class="foot">
  <button class="new" type="button" onclick={onnew}>New terminal</button>
  <p class="hint" aria-hidden="true">A OPEN · B BACK · START NEW</p>
</footer>

<style>
  .scroll {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: var(--s-3);
    padding: var(--s-1) var(--s-3) var(--s-2);
    line-height: 1.8;
  }
  .menu {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .row {
    display: flex;
    gap: 6px;
    padding: var(--s-1);
    color: var(--c-text);
    text-decoration: none;
    text-transform: uppercase;
  }
  .row--lead {
    background: var(--c-text);
    color: var(--c-bg);
  }
  .mark {
    visibility: hidden;
  }
  .row--lead .mark {
    visibility: visible;
  }
  .name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .where {
    margin: 0;
    font-size: var(--fs-sm);
    overflow-wrap: anywhere;
  }
  :global(:root[data-motion='on']) .cursor {
    animation: blink 1s steps(1) infinite;
  }
  @keyframes blink {
    50% {
      opacity: 0;
    }
  }
  .foot {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: var(--s-2) var(--s-3) var(--s-3);
    border-top: 2px solid var(--c-text-muted);
  }
  .new {
    height: 36px;
    border: 0;
    background: var(--c-accent);
    color: var(--c-on-accent);
    font: inherit;
    font-size: var(--fs-sm);
    text-transform: uppercase;
    cursor: pointer;
  }
  .hint {
    margin: 0;
    font-size: var(--fs-xs);
    text-align: center;
  }
</style>
