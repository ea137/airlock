<!-- The laptop app's window, in four sections. Approvals: devices asking to
     pair, the phone's edits to review, paired devices, settings and the
     audit log, refreshed whenever the hub says something changed.
     Terminals: Airlock's terminals, opened right here. Sessions: Claude
     sessions, live. History: what was kept of closed terminals and ended
     sessions. -->
<script lang="ts">
  import HistoryView from '../features/laptop/HistoryView.svelte';
  import SessionsView from '../features/laptop/SessionsView.svelte';
  import TerminalsView from '../features/laptop/TerminalsView.svelte';
  import WindowTerminal from '../features/laptop/WindowTerminal.svelte';
  import Activity from '../features/admin/Activity.svelte';
  import Devices from '../features/admin/Devices.svelte';
  import Edits from '../features/admin/Edits.svelte';
  import {
    type AuditEntry,
    type Change,
    type Device,
    followHub,
    hub,
    HubError,
    type Pairing,
    type Settings,
    type Theft,
  } from '../features/admin/hub';
  import Requests from '../features/admin/Requests.svelte';
  import SettingsPanel from '../features/admin/SettingsPanel.svelte';
  import { nowSecs } from '../lib/format';

  /** Also refreshed this often, so ages stay true and old requests drop off. */
  const REFRESH_MS = 10_000;

  type Snapshot = {
    pairings: Pairing[];
    changes: Change[];
    devices: Device[];
    settings: Settings;
    activity: AuditEntry[];
  };
  type View =
    | { status: 'loading' }
    | { status: 'down' }
    | { status: 'failed'; message: string }
    | { status: 'ready'; snapshot: Snapshot };

  type Section = 'approvals' | 'terminals' | 'sessions' | 'history';
  const SECTIONS: { id: Section; label: string }[] = [
    { id: 'approvals', label: 'Approvals' },
    { id: 'terminals', label: 'Terminals' },
    { id: 'sessions', label: 'Sessions' },
    { id: 'history', label: 'History' },
  ];

  let section = $state<Section>('approvals');
  let opened = $state<{ id: number; name: string } | null>(null);
  let view = $state<View>({ status: 'loading' });
  let now = $state(nowSecs());
  let thefts = $state<Theft[]>([]);
  let notice = $state<string | null>(null);
  /** Only the latest refresh lands, however the answers come back. */
  let latest = 0;

  async function refresh() {
    const mine = ++latest;
    try {
      const [pairings, changes, devices, settings, activity] = await Promise.all([
        hub.pairings(),
        hub.changes(),
        hub.devices(),
        hub.settings(),
        hub.activity(),
      ]);
      if (mine !== latest) return;
      view = { status: 'ready', snapshot: { pairings, changes, devices, settings, activity } };
    } catch (error) {
      if (mine !== latest) return;
      const failure = error instanceof HubError ? error : new HubError('broken', String(error));
      if (failure.down) view = { status: 'down' };
      // What's on screen stays when a refresh fails for another reason.
      else if (view.status === 'ready') notice = failure.message;
      else view = { status: 'failed', message: failure.message };
    }
    now = nowSecs();
  }

  /** Runs one answer from the window; its failure shows above the lists. */
  async function act(work: () => Promise<unknown>) {
    notice = null;
    try {
      await work();
    } catch (error) {
      notice = error instanceof Error ? error.message : String(error);
    }
    await refresh();
  }

  $effect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), REFRESH_MS);
    const stop = followHub({
      onchange: () => void refresh(),
      ontheft: (theft) => {
        thefts = [...thefts.filter((known) => known.id !== theft.id), theft];
      },
      onlink: (up) => {
        if (up) {
          void refresh();
          return;
        }
        // The hub's stream ends only when it stops; calls made while it
        // shuts down could hang, so this doesn't wait for one to fail.
        latest += 1;
        view = { status: 'down' };
      },
    });
    return () => {
      clearInterval(timer);
      stop();
    };
  });
</script>

<main class="laptop" class:laptop--wide={section !== 'approvals'}>
  <header class="top">
    <h1>Airlock</h1>
    <nav class="sections" aria-label="Sections">
      {#each SECTIONS as item (item.id)}
        {@const waiting =
          item.id === 'approvals' && view.status === 'ready'
            ? view.snapshot.pairings.length + view.snapshot.changes.filter((change) => change.state === 'pending').length
            : 0}
        <button
          type="button"
          aria-current={section === item.id ? 'page' : undefined}
          onclick={() => {
            section = item.id;
            if (item.id !== 'terminals') opened = null;
          }}
        >
          {item.label}{#if waiting > 0}<span class="badge" aria-label={`${waiting} waiting`}>{waiting}</span>{/if}
        </button>
      {/each}
    </nav>
    {#if view.status === 'ready'}
      <span class="link link--up">Hub running</span>
    {:else if view.status === 'down'}
      <span class="link link--down">Hub not running</span>
    {/if}
  </header>

  {#each thefts as theft (theft.id)}
    <div class="theft" role="alert">
      <p>
        <strong>Airlock cut off {theft.name}.</strong> Someone used a copy of its token. Pair it again once you
        have it back.
      </p>
      <button
        class="btn btn--quiet"
        type="button"
        onclick={() => (thefts = thefts.filter((known) => known.id !== theft.id))}
      >
        Dismiss
      </button>
    </div>
  {/each}

  {#if notice}
    <p class="error-text notice" role="alert">{notice}</p>
  {/if}

  {#if view.status === 'loading'}
    <p class="status" role="status">Checking the hub…</p>
  {:else if view.status === 'down'}
    <section class="down" aria-labelledby="down-title">
      <h2 id="down-title">The hub isn't running</h2>
      <p>Start it in a terminal with <code>airlock serve</code>. This window picks it up within seconds.</p>
    </section>
  {:else if view.status === 'failed'}
    <section class="down" aria-labelledby="failed-title">
      <h2 id="failed-title">Something went wrong</h2>
      <p role="alert">{view.message}</p>
      <button class="btn" type="button" onclick={() => void refresh()}>Try again</button>
    </section>
  {:else if section === 'terminals'}
    {#if opened}
      {#key opened.id}
        <WindowTerminal terminal={opened.id} name={opened.name} onback={() => (opened = null)} />
      {/key}
    {:else}
      <TerminalsView {now} onopen={(terminal) => (opened = { id: terminal.id, name: terminal.name })} />
    {/if}
  {:else if section === 'sessions'}
    <SessionsView
      {now}
      onopen={(id, name) => {
        section = 'terminals';
        opened = { id, name };
      }}
    />
  {:else if section === 'history'}
    <HistoryView {now} />
  {:else}
    <Requests
      pairings={view.snapshot.pairings}
      {now}
      onapprove={(pairing) => act(() => hub.approve(pairing))}
      ondeny={(pairing) => act(() => hub.deny(pairing))}
    />
    <Edits changes={view.snapshot.changes} {now} onchanged={() => void refresh()} />
    <Devices devices={view.snapshot.devices} {now} onrevoke={(device) => act(() => hub.revoke(device))} />
    <SettingsPanel settings={view.snapshot.settings} onchanged={() => void refresh()} />
    <Activity entries={view.snapshot.activity} {now} />
  {/if}
</main>

<style>
  .laptop {
    height: 100%;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: var(--s-6);
    max-width: 720px;
    margin: 0 auto;
    padding: var(--s-5) var(--s-6) var(--s-8);
    -webkit-user-select: text;
    user-select: text;
  }
  .laptop--wide {
    max-width: 1200px;
  }
  .top {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--s-3);
  }
  .sections {
    display: flex;
    gap: 2px;
    padding: 3px;
    border-radius: var(--r-lg);
    background: var(--c-surface-2);
  }
  .sections button {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    height: 34px;
    padding: 0 var(--s-3);
    border: 0;
    border-radius: var(--r-md);
    background: transparent;
    color: var(--c-text-muted);
    font-size: var(--fs-md);
    font-weight: 600;
    cursor: pointer;
  }
  .sections button:hover {
    color: var(--c-text);
  }
  .sections button[aria-current='page'] {
    background: var(--c-surface-hover);
    color: var(--c-text);
  }
  .badge {
    min-width: 18px;
    padding: 0 5px;
    border-radius: var(--r-pill);
    background: var(--c-warn);
    color: var(--c-bg);
    font-size: var(--fs-xs);
    font-weight: 700;
    line-height: 18px;
    text-align: center;
  }
  h1 {
    margin: 0;
    font-size: var(--fs-3xl);
  }
  .link {
    padding: var(--s-1) var(--s-3);
    border-radius: var(--r-pill);
    font-size: var(--fs-md);
    font-weight: 600;
  }
  .link--up {
    background: var(--c-ok-soft);
    color: var(--c-ok-text);
  }
  .link--down {
    background: var(--c-warn-soft);
    color: var(--c-warn);
  }
  .theft {
    display: flex;
    align-items: center;
    gap: var(--s-3);
    padding: var(--s-3) var(--s-3) var(--s-3) var(--s-4);
    border-radius: var(--r-xl);
    background: var(--c-danger-soft);
    color: var(--c-danger-text);
  }
  .theft p {
    flex: 1;
    margin: 0;
    line-height: 1.45;
  }
  .theft strong {
    color: var(--c-text);
  }
  .notice,
  .status {
    margin: 0;
  }
  .status {
    color: var(--c-text-muted);
  }
  .down {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--s-3);
    padding: var(--s-5);
    border-radius: var(--r-xl);
    background: var(--c-surface);
    box-shadow: 0 0 0 1px var(--c-line);
  }
  .down h2 {
    margin: 0;
    font-size: var(--fs-xl);
  }
  .down p {
    margin: 0;
    color: var(--c-text-muted);
    line-height: 1.45;
  }
  code {
    color: var(--c-text);
    font-family: var(--font-mono);
  }
</style>
