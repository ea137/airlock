<!-- Airlock's terminals, whether the phone or this window opened them: each
     with its tabs and its last lines. Open one to use it here, or in a
     window of the desktop's terminal app. -->
<script lang="ts">
  import { ago } from '../../lib/format';
  import { hub, type LiveTerminal } from '../admin/hub';

  let { now, onopen }: { now: number; onopen: (terminal: LiveTerminal) => void } = $props();

  const REFRESH_MS = 3000;

  let terminals = $state<LiveTerminal[] | null>(null);
  let problem = $state<string | null>(null);

  $effect(() => {
    const read = async () => {
      try {
        terminals = (await hub.terminals()).terminals;
        problem = null;
      } catch (error) {
        problem = error instanceof Error ? error.message : String(error);
      }
    };
    void read();
    const timer = setInterval(() => void read(), REFRESH_MS);
    return () => clearInterval(timer);
  });

  async function openInTerminalApp(terminal: LiveTerminal) {
    try {
      await hub.openInTerminalApp(terminal.id);
      problem = null;
    } catch (error) {
      problem = error instanceof Error ? error.message : String(error);
    }
  }
</script>

<section aria-labelledby="terminals-title">
  <h2 id="terminals-title">Terminals</h2>
  <p class="lead">
    Every terminal Airlock keeps, opened from the phone or from here. Open one here, or in a Terminal window;
    from any terminal, <code>airlock attach</code> lists them and asks which.
  </p>
  {#if problem}<p class="error-text" role="alert">{problem}</p>{/if}
  {#if terminals === null && !problem}
    <p class="note" role="status">Reading the terminals…</p>
  {:else if terminals && terminals.length === 0}
    <p class="empty">No terminals are open. Open one from the phone, and it shows up here.</p>
  {:else if terminals}
    <ul class="grid">
      {#each terminals as terminal (terminal.id)}
        <li class="card">
          <div class="card__head">
            <span class="card__name">{terminal.name}</span>
            <span class="card__when">active {ago(terminal.activity_at, now)}</span>
          </div>
          <div class="chips">
            {#each terminal.tabs as tab (tab.id)}
              <span class="chip" class:chip--active={tab.active}>{tab.name || tab.folder}{tab.command && tab.command !== 'bash' ? ` · ${tab.command}` : ''}</span>
            {/each}
          </div>
          {#if terminal.preview.length > 0}
            <pre class="preview">{terminal.preview.join('\n')}</pre>
          {/if}
          <div class="card__actions">
            <button class="btn btn--primary" type="button" onclick={() => onopen(terminal)}>Open here</button>
            <button class="btn" type="button" onclick={() => openInTerminalApp(terminal)}>Open in Terminal</button>
          </div>
        </li>
      {/each}
    </ul>
  {/if}
</section>

<style>
  section {
    display: flex;
    flex-direction: column;
    gap: var(--s-3);
  }
  h2 {
    margin: 0;
    font-size: var(--fs-xl);
  }
  .lead,
  .note {
    margin: 0;
    color: var(--c-text-muted);
    line-height: 1.45;
  }
  code {
    color: var(--c-text);
    font-family: var(--font-mono);
  }
  .empty {
    margin: 0;
    padding: var(--s-4);
    border-radius: var(--r-xl);
    background: var(--c-surface);
    color: var(--c-text-muted);
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
    gap: var(--s-3);
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .card {
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
    padding: var(--s-3);
    border-radius: var(--r-xl);
    background: var(--c-surface);
    box-shadow: 0 0 0 1px var(--c-line);
  }
  .card__head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--s-2);
  }
  .card__name {
    font-size: var(--fs-xl);
    font-weight: 600;
  }
  .card__when {
    color: var(--c-text-muted);
    font-size: var(--fs-sm);
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s-1);
  }
  .chip {
    padding: 2px var(--s-2);
    border-radius: var(--r-sm);
    background: var(--c-surface-2);
    color: var(--c-text-muted);
    font-size: var(--fs-sm);
  }
  .chip--active {
    background: var(--c-surface-3);
    color: var(--c-text);
  }
  .preview {
    margin: 0;
    padding: var(--s-2) var(--s-3);
    overflow: hidden;
    border-radius: var(--r-md);
    background: var(--c-terminal);
    color: var(--c-terminal-text);
    font: var(--fs-xs) / 1.5 var(--font-terminal);
    white-space: pre;
  }
  .card__actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s-2);
  }
  .error-text {
    margin: 0;
  }
</style>
