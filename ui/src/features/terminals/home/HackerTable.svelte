<!-- Hacker: the terminals as a session table, the first one's name and
     folder as a hex dump, its last lines as a tail, and a prompt with
     bracketed hotkeys. -->
<script lang="ts">
  import type { Snippet } from 'svelte';

  import type { Terminal } from '../../../lib/api';
  import { ago, nowSecs } from '../../../lib/format';
  import { hrefFor } from '../../../lib/router.svelte';
  import { activeTab, hexDump, running, shortPath } from '../labels';

  let {
    terminals,
    home,
    host,
    onnew,
    top,
  }: { terminals: Terminal[]; home: string; host: string; onnew: () => void; top: Snippet } = $props();

  const first = $derived(terminals[0]);
  const dump = $derived(
    first ? hexDump(`${first.name.toLowerCase()}\0${shortPath(activeTab(first)?.cwd ?? '', home)}`, 4) : [],
  );
  const sid = (index: number) => String(index + 1).padStart(2, '0');
</script>

<div class="scroll">
  {@render top()}
  {#if terminals.length > 0}
    <section aria-label="Sessions">
      <div class="grid head" aria-hidden="true">
        <span></span><span>SID</span><span>NAME</span><span>TABS</span><span>RUN</span><span>AGE</span>
      </div>
      <ul class="rows">
        {#each terminals as terminal, index (terminal.id)}
          <li>
            <a class="grid row" class:row--lead={index === 0} href={hrefFor({ name: 'terminal', id: terminal.id })}>
              <span aria-hidden="true">{index === 0 ? '>' : ''}</span>
              <span class="dim" aria-hidden="true">{sid(index)}</span>
              <span class="cut lower">{terminal.name}</span>
              <span>{terminal.tabs.length}<span class="visually-hidden"> tabs</span></span>
              <span class="cut run">{running(terminal)}</span>
              <span class="dim">{ago(terminal.activity_at, nowSecs())}</span>
            </a>
          </li>
        {/each}
      </ul>
    </section>
  {/if}

  {#if first}
    <section class="block" aria-hidden="true">
      <div class="rule">── xxd session/{sid(0)} ──────────────────────</div>
      {#each dump as line (line)}
        <div class="hex">
          <span class="dim">{line.slice(0, 5)}</span>
          <span class="bytes">{line.slice(6, 29)}</span>
          <span class="text">{line.slice(31)}</span>
        </div>
      {/each}
    </section>
    <section class="block" aria-label={`Last lines of ${first.name}`}>
      <div class="rule" aria-hidden="true">── tail -f {first.name.toLowerCase()} ──────────────</div>
      <pre>{first.preview.slice(-5).join('\n')}</pre>
    </section>
  {/if}
</div>

<footer class="foot">
  <div class="prompt" aria-hidden="true">
    <span class="user">root@{host.toLowerCase()}</span>:<span class="where">~</span># <span class="cursor"
      >&#160;</span
    >
  </div>
  <div class="keys">
    <button class="key key--hot" type="button" aria-label="New terminal" onclick={onnew}>[N]EW</button>
    <a class="key" href={hrefFor({ name: 'files', path: '~' })} aria-label="Files">[F]ILES</a>
    <a class="key" href={hrefFor({ name: 'system' })} aria-label="System">[S]YSTEM</a>
    <a class="key key--quiet" href={hrefFor({ name: 'center' })} aria-label="Work">[W]ORK</a>
  </div>
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
    font-size: var(--fs-sm);
    line-height: 1.5;
  }
  .grid {
    display: grid;
    grid-template-columns: 14px 24px minmax(0, 1fr) 36px 64px 64px;
    align-items: center;
    gap: var(--s-1);
    padding: 0 6px;
  }
  .head {
    background: var(--c-accent-text);
    color: var(--c-bg);
    font-size: var(--fs-xs);
    font-weight: 700;
  }
  .rows {
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .row {
    min-height: 40px;
    border-bottom: 1px solid var(--c-line);
    color: var(--c-text);
    text-decoration: none;
  }
  .row--lead,
  .row:hover {
    background: var(--c-accent);
    color: var(--c-on-accent);
    font-weight: 700;
  }
  .row--lead .dim,
  .row:hover .dim {
    color: var(--c-on-accent);
  }
  .dim {
    color: var(--c-text-muted);
  }
  .cut {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .lower {
    text-transform: lowercase;
  }
  .run {
    color: var(--c-accent-text);
  }
  .row--lead .run,
  .row:hover .run {
    color: inherit;
  }
  .block {
    font-size: var(--fs-xs);
    line-height: 1.45;
  }
  .rule {
    overflow: hidden;
    color: var(--c-text-muted);
    white-space: nowrap;
  }
  .hex {
    white-space: pre;
  }
  .bytes {
    color: var(--c-accent-text);
  }
  .text {
    color: var(--c-ok);
  }
  .block pre {
    margin: 0;
    overflow: hidden;
    font: inherit;
    white-space: pre;
  }
  .foot {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: var(--s-3) var(--s-3) calc(var(--s-4) + var(--safe-bottom));
  }
  .prompt {
    font-size: var(--fs-md);
  }
  .user {
    color: var(--c-accent);
    font-weight: 700;
  }
  .where {
    color: var(--c-accent-text);
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
  .keys {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 6px;
  }
  .key {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 46px;
    border: 1px solid var(--c-accent-text);
    background: transparent;
    color: var(--c-accent-text);
    font: inherit;
    font-size: var(--fs-sm);
    font-weight: 700;
    text-decoration: none;
    cursor: pointer;
  }
  .key--hot {
    border-color: var(--c-accent);
    background: var(--c-accent);
    color: var(--c-on-accent);
  }
  .key--quiet {
    border-color: var(--c-surface-hover);
    color: var(--c-text);
  }
</style>
