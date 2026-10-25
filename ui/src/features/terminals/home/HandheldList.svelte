<!-- Handheld console: the terminals as thick-framed menu items with a
     bobbing cursor on the first, their tabs as squares, and a dialog box
     telling where the first one is. -->
<script lang="ts">
  import type { Snippet } from 'svelte';

  import type { Terminal } from '../../../lib/api';
  import { hrefFor } from '../../../lib/router.svelte';
  import { activeTab, running, shortPath } from '../labels';

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
        <a class="item" class:item--lead={index === 0} href={hrefFor({ name: 'terminal', id: terminal.id })}>
          <span class="cursor" aria-hidden="true">▶</span>
          <span class="item__text">
            <span class="item__name">{terminal.name}</span>
            <span class="tabs">
              TABS
              <span class="visually-hidden">{terminal.tabs.length}</span>
              {#each terminal.tabs as tab (tab.id)}
                <span class="tab" class:tab--on={tab.active} aria-hidden="true"></span>
              {/each}
            </span>
          </span>
          <span class="badge">{running(terminal)}</span>
        </a>
      </li>
    {/each}
  </ul>

  {#if first}
    <section class="dialog" aria-label={`About ${first.name}`}>
      <p>{first.name} is in {shortPath(activeTab(first)?.cwd ?? '', home)}.</p>
      <p>{first.preview.at(-1) ?? ''}</p>
      <span class="more" aria-hidden="true">▼</span>
    </section>
  {/if}
</div>

<footer class="foot">
  <button class="pill pill--dark" type="button" onclick={onnew}>New terminal</button>
  <a class="pill" href={hrefFor({ name: 'files', path: '~' })}>Files</a>
</footer>

<style>
  .scroll {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: var(--s-3);
    padding: var(--s-1) var(--s-3) var(--s-3);
    line-height: 1.7;
  }
  .menu {
    display: flex;
    flex-direction: column;
    gap: 10px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .item {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px;
    border: 4px solid var(--c-line);
    border-radius: var(--r-lg);
    color: var(--c-text);
    text-decoration: none;
  }
  .item--lead,
  .item:hover {
    border-color: var(--c-text);
    background: var(--c-surface);
  }
  .cursor {
    visibility: hidden;
  }
  .item--lead .cursor {
    visibility: visible;
  }
  :global(:root[data-motion='on']) .item--lead .cursor,
  :global(:root[data-motion='on']) .more {
    animation: bob 0.8s steps(1) infinite;
  }
  @keyframes bob {
    50% {
      transform: translateY(3px);
    }
  }
  .item__text {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .item__name {
    overflow: hidden;
    text-overflow: ellipsis;
    text-transform: uppercase;
    white-space: nowrap;
  }
  .tabs {
    display: flex;
    align-items: center;
    gap: var(--s-1);
    font-size: var(--fs-sm);
  }
  .tab {
    width: 10px;
    height: 10px;
    border: 2px solid var(--c-text-muted);
  }
  .tab--on {
    border-color: var(--c-text);
    background: var(--c-text);
  }
  .badge {
    padding: var(--s-1) 6px;
    background: var(--c-text);
    color: var(--c-bg);
    font-size: var(--fs-sm);
    text-transform: uppercase;
  }
  .dialog {
    position: relative;
    padding: var(--s-3) var(--s-3) 14px;
    border: 4px solid var(--c-text);
    border-radius: var(--r-lg);
    box-shadow:
      inset 0 0 0 3px var(--c-bg),
      inset 0 0 0 5px var(--c-text-muted);
  }
  .dialog p {
    margin: 0;
    overflow-wrap: anywhere;
  }
  .dialog p + p {
    margin-top: 6px;
  }
  .more {
    position: absolute;
    right: var(--s-3);
    bottom: 6px;
  }
  .foot {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px;
    padding: var(--s-3) var(--s-3) calc(var(--s-4) + var(--safe-bottom));
  }
  .pill {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 48px;
    border: 4px solid var(--c-text);
    border-radius: 24px;
    background: transparent;
    color: var(--c-text);
    font: inherit;
    font-size: var(--fs-md);
    text-decoration: none;
    text-transform: uppercase;
    cursor: pointer;
  }
  .pill--dark {
    background: var(--c-text);
    color: var(--c-bg);
  }
</style>
