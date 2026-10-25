<!-- Vector display: the terminals as outlined boxes, the first one glowing
     with corner marks, and two outlined buttons. -->
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
</script>

<div class="scroll">
  {@render top()}
  <ul class="list">
    {#each terminals as terminal, index (terminal.id)}
      {@const tab = activeTab(terminal)}
      <li>
        <a class="box" class:box--lead={index === 0} href={hrefFor({ name: 'terminal', id: terminal.id })}>
          <span class="box__text">
            <span class="box__name">{terminal.name}</span>
            <span class="box__meta"
              >{tabCount(terminal)}{#if tab} · {shortPath(tab.cwd, home)}{/if}</span
            >
          </span>
          <span class="box__run">◇ {running(terminal)}</span>
        </a>
      </li>
    {/each}
  </ul>
</div>

<footer class="foot">
  <button class="line line--lit" type="button" onclick={onnew}>+ New terminal</button>
  <a class="line" href={hrefFor({ name: 'files', path: '~' })}>Files</a>
</footer>

<style>
  .scroll {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: var(--s-3);
    padding: var(--s-2) var(--s-5) var(--s-3);
  }
  .list {
    display: flex;
    flex-direction: column;
    gap: var(--s-3);
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .box {
    position: relative;
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 64px;
    padding: var(--s-2) 14px;
    border: 1px solid var(--c-line);
    color: var(--c-text);
    text-decoration: none;
  }
  .box--lead,
  .box:hover {
    border-color: var(--c-accent);
    box-shadow:
      0 0 8px rgb(159 252 255 / 0.7),
      inset 0 0 8px rgb(159 252 255 / 0.25);
  }
  /* Corner marks, as a plotter would draw a selection. */
  .box--lead::before,
  .box--lead::after {
    content: '';
    position: absolute;
    width: 12px;
    height: 12px;
  }
  .box--lead::before {
    top: -6px;
    left: -6px;
    border-top: 1px solid var(--c-accent);
    border-left: 1px solid var(--c-accent);
  }
  .box--lead::after {
    right: -6px;
    bottom: -6px;
    border-right: 1px solid var(--c-accent);
    border-bottom: 1px solid var(--c-accent);
  }
  .box__text {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .box__name {
    font-size: var(--fs-xl);
  }
  .box__meta {
    overflow: hidden;
    font-size: var(--fs-sm);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .box__run {
    font-size: var(--fs-sm);
  }
  .foot {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 14px;
    padding: var(--s-3) var(--s-5) calc(var(--s-5) + var(--safe-bottom));
  }
  .line {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 52px;
    border: 1px solid var(--c-line);
    background: transparent;
    color: var(--c-text);
    font-family: 'Major Mono Display', var(--font-mono);
    font-size: var(--fs-md);
    text-decoration: none;
    text-transform: lowercase;
    cursor: pointer;
  }
  .line--lit {
    border-color: var(--c-accent);
    box-shadow:
      0 0 10px rgb(159 252 255 / 0.7),
      inset 0 0 10px rgb(159 252 255 / 0.3);
  }
</style>
