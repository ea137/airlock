<!-- 8-bit: the terminals as a BASIC listing, numbered in tens, and the
     first one's screen as if it had just been run. -->
<script lang="ts">
  import type { Snippet } from 'svelte';

  import type { Terminal } from '../../../lib/api';
  import { hrefFor } from '../../../lib/router.svelte';
  import { activeTab, shortPath, tabCount } from '../labels';

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
  {#if terminals.length > 0}
    <p aria-hidden="true">READY.<br />LIST</p>
    <ul class="listing">
      {#each terminals as terminal, index (terminal.id)}
        <li>
          <a class="line" class:line--lead={index === 0} href={hrefFor({ name: 'terminal', id: terminal.id })}>
            <span aria-hidden="true">{(index + 1) * 10}</span>
            <span class="name">{terminal.name}</span>
            <span>{tabCount(terminal)}</span>
          </a>
        </li>
      {/each}
    </ul>
  {/if}
  {#if first}
    <p aria-hidden="true">READY.<br />RUN 10</p>
    <pre class="run">{[
        `${shortPath(activeTab(first)?.cwd ?? '', home)}$`,
        ...first.preview.slice(-4),
      ].join('\n')}<span class="cursor" aria-hidden="true">&#160;</span></pre>
  {/if}
</div>

<footer class="foot">
  <button class="key" type="button" onclick={onnew}>New terminal</button>
  <a class="key" href={hrefFor({ name: 'files', path: '~' })}>Files</a>
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
    line-height: 1.9;
  }
  p {
    margin: 0;
  }
  .listing {
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .line {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 40px;
    padding: 0 var(--s-1);
    color: var(--c-text);
    text-decoration: none;
    text-transform: uppercase;
  }
  .line--lead,
  .line:hover {
    background: var(--c-text);
    color: var(--c-bg);
  }
  .name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .run {
    margin: 0;
    overflow: hidden;
    font: var(--fs-md) / 1.8 var(--font-mono);
    text-transform: uppercase;
    white-space: pre;
  }
  .cursor {
    background: var(--c-text);
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
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px;
    padding: var(--s-3) var(--s-3) calc(var(--s-4) + var(--safe-bottom));
  }
  .key {
    display: flex;
    align-items: center;
    justify-content: center;
    height: var(--tap);
    border: 0;
    background: var(--c-text);
    color: var(--c-bg);
    font: inherit;
    font-size: var(--fs-base);
    text-decoration: none;
    text-transform: uppercase;
    cursor: pointer;
  }
  .key:hover {
    background: var(--c-text-soft);
  }
</style>
