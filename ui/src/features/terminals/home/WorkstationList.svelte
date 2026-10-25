<!-- 90s workstation: a sunken list box with the first terminal selected,
     its screen in a black pane below, and the window's buttons bottom
     right. -->
<script lang="ts">
  import type { Snippet } from 'svelte';

  import type { Terminal } from '../../../lib/api';
  import { ago, nowSecs } from '../../../lib/format';
  import { hrefFor } from '../../../lib/router.svelte';
  import { activeTab, shortPath, tabCount } from '../labels';

  let {
    terminals,
    home,
    onnew,
    top,
  }: { terminals: Terminal[]; home: string; onnew: () => void; top: Snippet } = $props();

  const first = $derived(terminals[0]);
  const latest = $derived(Math.max(0, ...terminals.map((terminal) => terminal.activity_at)));
</script>

<div class="scroll">
  {@render top()}
  {#if terminals.length > 0}
    <div class="status">
      <span>{terminals.length === 1 ? '1 terminal' : `${terminals.length} terminals`}</span>
      <span>last used {ago(latest, nowSecs())}</span>
    </div>
    <ul class="box">
      {#each terminals as terminal, index (terminal.id)}
        {@const tab = activeTab(terminal)}
        <li>
          <a class="row" class:row--lead={index === 0} href={hrefFor({ name: 'terminal', id: terminal.id })}>
            <span class="row__text">
              <span class="row__name">{terminal.name}</span>
              <span class="row__meta"
                >{tabCount(terminal)}{#if tab} · {shortPath(tab.cwd, home)}{/if}</span
              >
            </span>
            <span aria-hidden="true">▸</span>
          </a>
        </li>
      {/each}
    </ul>
  {/if}
  {#if first}
    <section class="pane" aria-labelledby="ws-pane">
      <h2 id="ws-pane">{first.name}</h2>
      <pre>{first.preview.slice(-5).join('\n')}</pre>
    </section>
  {/if}
</div>

<footer class="foot">
  <a class="btn" href={hrefFor({ name: 'files', path: '~' })}>Files</a>
  <button class="btn" type="button" onclick={onnew}>New terminal <span aria-hidden="true">↵</span></button>
</footer>

<style>
  .scroll {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: var(--s-3);
    padding: var(--s-1) 10px var(--s-3);
  }
  .status {
    display: flex;
    justify-content: space-between;
    font-size: var(--fs-sm);
  }
  /* A sunken list box. */
  .box {
    margin: 0;
    padding: 2px;
    list-style: none;
    background: var(--c-ws-face);
    box-shadow:
      inset 1px 1px var(--c-ws-shade),
      inset -1px -1px var(--c-ws-light),
      inset 2px 2px var(--c-ws-dark);
  }
  .row {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    min-height: 48px;
    padding: 0 var(--s-2);
    color: var(--c-text);
    text-decoration: none;
  }
  li + li .row {
    border-top: 1px solid var(--c-ws-shade);
  }
  .row--lead,
  .row:hover {
    background: var(--c-ws-light);
  }
  .row__text {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
  .row__name {
    font-weight: 600;
  }
  .row__meta {
    overflow: hidden;
    font-size: var(--fs-sm);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .pane {
    display: flex;
    flex-direction: column;
    gap: var(--s-1);
  }
  .pane h2 {
    margin: 0;
    font-size: var(--fs-sm);
    font-weight: 400;
  }
  .pane pre {
    margin: 0;
    padding: var(--s-2);
    overflow: hidden;
    background: var(--c-terminal);
    color: var(--c-terminal-text);
    font: var(--fs-xs) / 1.5 var(--font-terminal);
    white-space: pre;
    box-shadow:
      inset 1px 1px var(--c-ws-shade),
      inset -1px -1px var(--c-ws-light);
  }
  .foot {
    display: flex;
    justify-content: flex-end;
    gap: var(--s-2);
    padding: var(--s-3) 10px calc(var(--s-4) + var(--safe-bottom));
  }
  .foot .btn {
    min-height: 40px;
    border-radius: 0;
    background: var(--c-ws-face);
    color: var(--c-text);
    font-weight: 400;
  }
</style>
