<!-- What Airlock kept: terminals (their tabs' scrollback, colours and all)
     and Claude sessions (what they did), for two weeks after they were last
     used. Read any of them, or delete it sooner. -->
<script lang="ts">
  import { ago } from '../../lib/format';
  import { css, parseAnsi } from '../center/ansi';
  import { type History, hub, type SessionRecord, type TerminalRecord } from '../admin/hub';

  let { now }: { now: number } = $props();

  let history = $state<History | null>(null);
  let problem = $state<string | null>(null);
  let reading = $state<TerminalRecord | null>(null);
  let tabIndex = $state(0);
  let session = $state<SessionRecord | null>(null);
  /** The item asked "delete for good?", by its key or id. */
  let asking = $state<string | null>(null);

  async function load() {
    try {
      history = await hub.history();
      problem = null;
    } catch (error) {
      problem = error instanceof Error ? error.message : String(error);
    }
  }

  $effect(() => {
    void load();
  });

  async function readTerminal(record: TerminalRecord) {
    session = null;
    tabIndex = 0;
    try {
      reading = await hub.terminalRecord(record.key);
    } catch (error) {
      problem = error instanceof Error ? error.message : String(error);
    }
  }

  async function forget(kind: 'terminal' | 'session', id: string) {
    if (asking !== id) {
      asking = id;
      return;
    }
    asking = null;
    try {
      if (kind === 'terminal') await hub.deleteTerminalRecord(id);
      else await hub.deleteSessionRecord(id);
      if (reading?.key === id) reading = null;
      if (session?.id === id) session = null;
      await load();
    } catch (error) {
      problem = error instanceof Error ? error.message : String(error);
    }
  }

  const days = $derived(history ? Math.round(history.keep_secs / 86_400) : 14);
  const shownTab = $derived(reading?.tabs[tabIndex] ?? null);
  const runs = $derived(shownTab?.text ? parseAnsi(shownTab.text) : []);
  const date = (seconds: number) =>
    new Date(seconds * 1000).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
</script>

<section aria-labelledby="history-title">
  <div class="head">
    <h2 id="history-title">History</h2>
    <button class="btn btn--quiet" type="button" onclick={() => void load()}>Refresh</button>
  </div>
  <p class="lead">
    Terminals and Claude sessions are kept for {days} days after they were last used, then deleted. Delete any of them
    sooner here. Open terminals are saved every half minute.
  </p>
  {#if problem}<p class="error-text" role="alert">{problem}</p>{/if}

  {#if reading}
    <div class="reader" aria-label={`Kept terminal ${reading.name}`} role="region">
      <div class="reader__bar">
        <button class="btn btn--quiet" type="button" onclick={() => (reading = null)}><span aria-hidden="true">‹</span> History</button>
        <strong>{reading.name}</strong>
        <span class="muted">
          {reading.closed_at ? `closed ${date(reading.closed_at)}` : 'still open'} · opened {date(reading.created_at)}
        </span>
      </div>
      {#if reading.tabs.length > 1}
        <div class="tabs" role="group" aria-label="Tabs">
          {#each reading.tabs as tab, index (index)}
            <button type="button" aria-pressed={tabIndex === index} onclick={() => (tabIndex = index)}>{tab.name}</button>
          {/each}
        </div>
      {/if}
      <pre class="scrollback">{#each runs as run, index (index)}<span style={css(run.style)}>{run.text}</span>{/each}</pre>
    </div>
  {:else if session}
    <div class="reader" role="region" aria-label={`Kept session ${session.title ?? 'claude'}`}>
      <div class="reader__bar">
        <button class="btn btn--quiet" type="button" onclick={() => (session = null)}><span aria-hidden="true">‹</span> History</button>
        <strong>{session.title ?? 'claude'}</strong>
        <span class="muted">{session.cwd} · {session.ended_at ? `ended ${date(session.ended_at)}` : session.doing}</span>
      </div>
      <ol class="steps">
        {#each session.timeline as step (step.seq)}
          <li><span class="step__when">{date(step.at)}</span><span>{step.text}</span></li>
        {:else}
          <li class="muted">It didn't do anything worth keeping.</li>
        {/each}
      </ol>
    </div>
  {:else if history}
    <h3>Terminals</h3>
    {#if history.terminals.length === 0}
      <p class="empty">Nothing kept yet.</p>
    {:else}
      <ul class="list">
        {#each history.terminals as record (record.key)}
          <li class="item">
            <button class="item__open" type="button" onclick={() => readTerminal(record)}>
              <span class="item__name">{record.name}</span>
              <span class="item__meta">
                {record.tabs.length} {record.tabs.length === 1 ? 'tab' : 'tabs'} ·
                {record.tabs.reduce((sum, tab) => sum + (tab.lines ?? 0), 0)} lines ·
                {record.closed_at ? `closed ${ago(record.closed_at, now)}` : 'open now'}
              </span>
            </button>
            <button class="forget" class:forget--sure={asking === record.key} type="button" onclick={() => forget('terminal', record.key)}>
              {asking === record.key ? 'Delete for good?' : 'Delete'}
            </button>
          </li>
        {/each}
      </ul>
    {/if}

    <h3>Claude sessions</h3>
    {#if history.sessions.length === 0}
      <p class="empty">Nothing kept yet.</p>
    {:else}
      <ul class="list">
        {#each history.sessions as record (record.id)}
          <li class="item">
            <button class="item__open" type="button" onclick={() => ((session = record), (reading = null))}>
              <span class="item__name">{record.title ?? 'claude'}</span>
              <span class="item__meta">
                {record.cwd} · {record.timeline.length} steps ·
                {record.ended_at ? `ended ${ago(record.ended_at, now)}` : `last active ${ago(record.updated_at, now)}`}
              </span>
            </button>
            <button class="forget" class:forget--sure={asking === record.id} type="button" onclick={() => forget('session', record.id)}>
              {asking === record.id ? 'Delete for good?' : 'Delete'}
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  {:else if !problem}
    <p class="muted" role="status">Reading the history…</p>
  {/if}
</section>

<style>
  section {
    display: flex;
    flex-direction: column;
    gap: var(--s-3);
  }
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  h2 {
    margin: 0;
    font-size: var(--fs-xl);
  }
  h3 {
    margin: var(--s-2) 0 0;
    color: var(--c-text-muted);
    font-size: var(--fs-md);
  }
  .lead,
  .muted {
    margin: 0;
    color: var(--c-text-muted);
    line-height: 1.45;
  }
  .empty {
    margin: 0;
    padding: var(--s-4);
    border-radius: var(--r-xl);
    background: var(--c-surface);
    color: var(--c-text-muted);
  }
  .list {
    margin: 0;
    padding: 0;
    overflow: hidden;
    border-radius: var(--r-xl);
    background: var(--c-surface);
    box-shadow: 0 0 0 1px var(--c-line);
    list-style: none;
  }
  .item {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    padding-right: var(--s-3);
  }
  .item + .item {
    border-top: 1px solid var(--c-surface-2);
  }
  .item__open {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: var(--s-3);
    border: 0;
    background: transparent;
    color: var(--c-text);
    text-align: left;
    cursor: pointer;
  }
  .item__open:hover {
    background: var(--c-surface-2);
  }
  .item__name {
    font-weight: 600;
  }
  .item__meta {
    overflow: hidden;
    color: var(--c-text-muted);
    font-size: var(--fs-sm);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .forget {
    flex: 0 0 auto;
    min-height: 32px;
    padding: 0 var(--s-3);
    border: 0;
    border-radius: var(--r-md);
    background: var(--c-surface-2);
    color: var(--c-text-muted);
    font-size: var(--fs-sm);
    font-weight: 600;
    cursor: pointer;
  }
  .forget--sure {
    background: var(--c-danger);
    color: var(--c-on-accent);
  }
  .reader {
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
  }
  .reader__bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--s-3);
  }
  .tabs {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s-1);
  }
  .tabs button {
    height: 30px;
    padding: 0 var(--s-3);
    border: 0;
    border-radius: var(--r-md);
    background: var(--c-surface-2);
    color: var(--c-text-muted);
    cursor: pointer;
  }
  .tabs button[aria-pressed='true'] {
    background: var(--c-surface-3);
    color: var(--c-text);
  }
  .scrollback {
    max-height: 70vh;
    margin: 0;
    padding: var(--s-3);
    overflow: auto;
    border-radius: var(--r-lg);
    background: var(--c-terminal);
    color: var(--c-terminal-text);
    font: var(--fs-sm) / 1.4 var(--font-terminal);
    white-space: pre;
  }
  .steps {
    display: flex;
    flex-direction: column;
    gap: var(--s-1);
    margin: 0;
    padding: 0;
    font-size: var(--fs-md);
    list-style: none;
  }
  .steps li {
    display: flex;
    gap: var(--s-3);
  }
  .step__when {
    flex: 0 0 120px;
    color: var(--c-text-muted);
  }
  .error-text {
    margin: 0;
  }
</style>
