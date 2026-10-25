<!-- Teletext: an index page. Each terminal has a page number down a dotted
     leader; the first one's screen is shown as its page, on a red band. -->
<script lang="ts">
  import type { Snippet } from 'svelte';

  import type { Terminal } from '../../../lib/api';
  import { hrefFor } from '../../../lib/router.svelte';
  import { activeTab, running, shortPath, tabCount } from '../labels';

  let {
    terminals,
    home,
    onnew,
    top,
  }: { terminals: Terminal[]; home: string; onnew: () => void; top: Snippet } = $props();

  /** The terminals' pages follow the index, which is 101. */
  const page = (index: number) => 102 + index;
  const first = $derived(terminals[0]);
</script>

<div class="scroll">
  {@render top()}
  <ul class="index">
    {#each terminals as terminal, index (terminal.id)}
      {@const tab = activeTab(terminal)}
      <li>
        <a class="entry" href={hrefFor({ name: 'terminal', id: terminal.id })}>
          <span class="entry__line">
            <span class="entry__name">{terminal.name}</span>
            <span class="entry__dots" aria-hidden="true"></span>
            <span class="entry__page">{page(index)}</span>
          </span>
          <span class="entry__meta"
            >{tabCount(terminal)}{#if tab} · {shortPath(tab.cwd, home)}{/if}</span
          >
        </a>
      </li>
    {/each}
  </ul>

  {#if first}
    <section class="now" aria-labelledby="teletext-now">
      <h2 id="teletext-now">{page(0)} {first.name} · {running(first)}</h2>
      <pre>{first.preview.slice(-5).join('\n')}</pre>
    </section>
    <p class="hint">Tap a page number to open it ▶</p>
  {/if}
</div>

<footer class="foot">
  <button class="fastext" type="button" onclick={onnew}>New terminal</button>
</footer>

<style>
  .scroll {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: var(--s-3);
    padding: var(--s-1) var(--s-2) var(--s-3);
    line-height: 1.15;
  }
  .index {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .entry {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: var(--s-1);
    text-decoration: none;
  }
  .entry:hover {
    background: var(--c-tt-blue);
  }
  .entry__line {
    display: flex;
    align-items: baseline;
    color: var(--c-tt-cyan);
  }
  .entry__name {
    flex: 0 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  /* The dotted leader, as long as the line allows. */
  .entry__dots {
    flex: 1;
    min-width: var(--s-4);
    overflow: hidden;
    white-space: nowrap;
  }
  .entry__dots::after {
    content: '........................................................';
  }
  .entry__page {
    color: var(--c-tt-white);
  }
  .entry__meta {
    padding-left: var(--s-4);
    color: var(--c-tt-green);
  }
  .now h2 {
    margin: 0;
    padding: 2px 6px;
    background: var(--c-tt-red);
    color: var(--c-tt-white);
    font-size: var(--fs-xl);
    font-weight: 400;
    text-transform: uppercase;
  }
  .now pre {
    margin: 0;
    padding: 6px;
    overflow: hidden;
    color: var(--c-tt-white);
    font: inherit;
    white-space: pre;
  }
  .hint {
    margin: 0;
    color: var(--c-tt-yellow);
  }
  .foot {
    padding: var(--s-2) var(--s-2) calc(var(--s-4) + var(--safe-bottom));
  }
  .fastext {
    width: 100%;
    height: var(--tap);
    border: 0;
    background: transparent;
    color: var(--c-tt-red);
    font: inherit;
    font-size: var(--fs-xl);
    text-align: left;
    cursor: pointer;
  }
  .fastext::before {
    content: '■ ' / '';
  }
  .fastext:hover {
    background: var(--c-tt-red);
    color: var(--c-tt-black);
  }
</style>
