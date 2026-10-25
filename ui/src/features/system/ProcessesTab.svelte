<!-- Every process on the laptop, live: the laptop's CPU and memory over the
     last couple of minutes, then each process with its own CPU line,
     memory and kind. Search, filter by kind, sort, or put each app's
     helpers under it; tap one for everything about it. -->
<script lang="ts" module>
  import { api, type ProcessesView } from '../../lib/api';
  import { Polled } from '../../lib/polled.svelte';

  const REFRESH_MS = 3000;

  // Kept between visits: coming back shows the last of it at once while it
  // refreshes.
  const view = new Polled<ProcessesView>(() => api.processes(), REFRESH_MS);
</script>

<script lang="ts">
  import type { ProcessRow } from '../../lib/api';
  import Help from '../../lib/Help.svelte';
  import Problem from '../../lib/Problem.svelte';
  import { session } from '../../lib/session.svelte';
  import { HELP } from './help';
  import { bytes, duration, shortHome } from './labels';
  import ProcessDetails from './ProcessDetails.svelte';
  import {
    filterProcesses,
    groupByApp,
    KINDS,
    kindCounts,
    percent,
    type ProcessFilter,
    type Sort,
  } from './processes';
  import Sparkline from './Sparkline.svelte';
  import StopDialog from './StopDialog.svelte';

  /** Rows shown before "Show all". */
  const FIRST = 60;
  const VIEW_KEY = 'airlock.processesView';

  type Saved = { mine: boolean; sort: Sort; grouped: boolean };

  function saved(): Saved {
    try {
      const value: unknown = JSON.parse(localStorage.getItem(VIEW_KEY) ?? 'null');
      const fields = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
      const sorts: Sort[] = ['cpu', 'memory', 'name', 'newest'];
      return {
        mine: fields.mine !== false,
        sort: sorts.find((sort) => sort === fields.sort) ?? 'cpu',
        grouped: fields.grouped !== false,
      };
    } catch {
      return { mine: true, sort: 'cpu', grouped: true };
    }
  }

  const start = saved();
  let filter = $state<ProcessFilter>({ kind: 'all', mine: start.mine, words: '', sort: start.sort });
  let grouped = $state(start.grouped);
  let all = $state(false);
  let open = $state<string | null>(null);
  let openGroups = $state<string[]>([]);
  let stopping = $state<ProcessRow | null>(null);

  $effect(() => {
    const keep: Saved = { mine: filter.mine, sort: filter.sort, grouped };
    try {
      localStorage.setItem(VIEW_KEY, JSON.stringify(keep));
    } catch {
      // Not remembered; it still applies now.
    }
  });

  $effect(() => view.watch());

  const data = $derived(view.data);
  const home = $derived(session.state.status === 'paired' ? session.state.session.home : '');
  const previews = $derived(session.state.status === 'paired' && Boolean(session.state.session.preview_port));
  const rows = $derived(data ? filterProcesses(data.processes, filter) : []);
  const counts = $derived(data ? kindCounts(data.processes, filter) : null);
  const groups = $derived(grouped ? groupByApp(rows, filter.sort) : []);
  const cpuNow = $derived(data?.cpu.at(-1) ?? null);
  const memoryNow = $derived(data?.memory.at(-1) ?? null);
  const key = (row: ProcessRow) => `${row.pid}:${row.started}`;

  function stopDetails(process: ProcessRow): string {
    const where = process.cwd ? ` in ${shortHome(process.cwd, home)}` : '';
    const serving = process.ports.length ? ` It also stops serving ${process.ports.map((p) => `:${p}`).join(', ')}.` : '';
    return `${process.program}, process ${process.pid}, running for ${duration(process.running_for)}${where}.${serving}`;
  }
</script>

{#snippet line(process: ProcessRow, inner: boolean)}
  {@const id = key(process)}
  <li class="proc" class:proc--inner={inner} class:proc--open={open === id}>
    <button class="proc__row" type="button" aria-expanded={open === id} onclick={() => (open = open === id ? null : id)}>
      <span class={`kind kind--${process.kind}`} aria-hidden="true"></span>
      <span class="proc__text">
        <span class="proc__name">{process.name}</span>
        <span class="proc__sub">
          {#if !inner && process.app && process.app !== process.name}{process.app} · {/if}{process.mine
            ? process.command || process.program
            : `${process.user} · ${process.command || process.program}`}
        </span>
      </span>
      <span class="proc__nums">
        <span class="proc__cpu" class:hot={(process.cpu ?? 0) >= 50}>{percent(process.cpu)}</span>
        <span class="proc__mem">{bytes(process.memory)}</span>
      </span>
      <Sparkline values={process.cpu_history} max={100} width={44} height={22} tone={(process.cpu ?? 0) >= 50 ? 'warn' : 'accent'} />
    </button>
    {#if open === id}
      <ProcessDetails {process} {home} {previews} onstop={(found) => (stopping = found)} />
    {/if}
  </li>
{/snippet}

<div class="tab">
  {#if data}
    <section class="gauges" aria-label="The laptop now">
      <div class="gauge">
        <span class="gauge__label">CPU <Help {...HELP.laptopCpu} /></span>
        <span class="gauge__value">{cpuNow === null ? '…' : `${Math.round(cpuNow)}%`}</span>
        <span class="gauge__sub">{data.cpus} cores</span>
        <div class="gauge__chart"><Sparkline values={data.cpu} max={100} width={150} height={40} /></div>
      </div>
      <div class="gauge">
        <span class="gauge__label">Memory <Help {...HELP.laptopMemory} /></span>
        <span class="gauge__value">{memoryNow === null ? '…' : bytes(memoryNow)}</span>
        <span class="gauge__sub">of {bytes(data.memory_total)}</span>
        <div class="gauge__chart">
          <Sparkline values={data.memory} max={data.memory_total} width={150} height={40} tone="ok" />
        </div>
      </div>
    </section>

    <div class="controls">
      <label class="search">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"
          ><circle cx="11" cy="11" r="7"></circle><path d="M21 21l-4.3-4.3"></path></svg
        >
        <span class="visually-hidden">Search processes</span>
        <input type="search" bind:value={filter.words} placeholder="Name, command or number" autocomplete="off" />
      </label>

      <div class="chips" role="group" aria-label="Kind">
        {#each KINDS as kind (kind.id)}
          {#if kind.id === 'all' || (counts?.[kind.id] ?? 0) > 0}
            <button
              class={`chip chip--${kind.id}`}
              type="button"
              aria-pressed={filter.kind === kind.id}
              onclick={() => (filter.kind = kind.id)}
            >
              {kind.label}<span class="chip__count">{counts?.[kind.id] ?? 0}</span>
            </button>
          {/if}
        {/each}
        <Help {...HELP.kind} />
      </div>

      <div class="options">
        <label class="sort">
          <span>Sort</span>
          <select bind:value={filter.sort}>
            <option value="cpu">CPU</option>
            <option value="memory">Memory</option>
            <option value="name">Name</option>
            <option value="newest">Newest</option>
          </select>
        </label>
        <button class="toggle" type="button" aria-pressed={grouped} onclick={() => (grouped = !grouped)}>By app</button>
        <Help {...HELP.group} />
        <button class="toggle" type="button" aria-pressed={filter.mine} onclick={() => (filter.mine = !filter.mine)}>
          Only mine
        </button>
      </div>
    </div>

    {#if rows.length === 0}
      <p class="empty">Nothing running matches.</p>
    {:else if grouped}
      <ul class="list">
        {#each all ? groups : groups.slice(0, FIRST) as group (group.key)}
          {#if group.rows.length === 1 && group.rows[0]}
            {@render line(group.rows[0], false)}
          {:else}
            {@const opened = openGroups.includes(group.key)}
            <li class="app">
              <button
                class="proc__row"
                type="button"
                aria-expanded={opened}
                onclick={() =>
                  (openGroups = opened ? openGroups.filter((other) => other !== group.key) : [...openGroups, group.key])}
              >
                <span class={`kind kind--${group.rows[0]?.kind ?? 'other'}`} aria-hidden="true"></span>
                <span class="proc__text">
                  <span class="proc__name">{group.name} <span class="count">{group.rows.length}</span></span>
                  <span class="proc__sub">{group.rows[0]?.about ?? `${group.rows.length} processes`}</span>
                </span>
                <span class="proc__nums">
                  <span class="proc__cpu" class:hot={group.cpu >= 50}>{percent(group.cpu)}</span>
                  <span class="proc__mem">{bytes(group.memory)}</span>
                </span>
                <Sparkline values={group.history} width={44} height={22} tone={group.cpu >= 50 ? 'warn' : 'accent'} />
              </button>
              {#if opened}
                <ul class="list list--inner">
                  {#each group.rows as process (key(process))}
                    {@render line(process, true)}
                  {/each}
                </ul>
              {/if}
            </li>
          {/if}
        {/each}
      </ul>
      {#if !all && groups.length > FIRST}
        <button class="more" type="button" onclick={() => (all = true)}>Show all {groups.length}</button>
      {/if}
    {:else}
      <ul class="list">
        {#each all ? rows : rows.slice(0, FIRST) as process (key(process))}
          {@render line(process, false)}
        {/each}
      </ul>
      {#if !all && rows.length > FIRST}
        <button class="more" type="button" onclick={() => (all = true)}>Show all {rows.length}</button>
      {/if}
    {/if}
  {:else if view.error}
    <Problem message={view.error.message} onretry={() => view.refresh()} />
  {:else}
    <div class="skeleton" aria-hidden="true"></div>
    <span class="visually-hidden" role="status">Reading the laptop's processes</span>
  {/if}
</div>

{#if stopping}
  {@const process = stopping}
  <StopDialog
    name={process.name}
    details={stopDetails(process)}
    canForce={true}
    stop={async (force) => (await api.stopProcess(process.name, process.pid, process.started, force)).stopped}
    onclose={() => (stopping = null)}
    ondone={() => {
      stopping = null;
      open = null;
      void view.refresh();
    }}
  />
{/if}

<style>
  .tab {
    display: flex;
    flex-direction: column;
    gap: var(--s-3);
  }
  .gauges {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--s-2);
  }
  .gauge {
    display: flex;
    flex-direction: column;
    padding: var(--s-3);
    border-radius: var(--r-xl);
    background: var(--c-surface);
    box-shadow: 0 0 0 1px var(--c-line);
  }
  .gauge__label {
    display: flex;
    align-items: center;
    gap: 2px;
    color: var(--c-text-muted);
    font-size: var(--fs-xs);
    font-weight: 700;
    letter-spacing: 0.4px;
    text-transform: uppercase;
  }
  .gauge__value {
    margin-top: var(--s-1);
    font-size: 22px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }
  .gauge__sub {
    color: var(--c-text-muted);
    font-size: var(--fs-sm);
  }
  .gauge__chart {
    margin-top: var(--s-2);
  }
  .gauge__chart :global(svg) {
    width: 100%;
  }
  .controls {
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
  }
  .search {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    height: 40px;
    padding: 0 var(--s-3);
    border-radius: var(--r-lg);
    background: var(--c-surface-2);
    color: var(--c-text-muted);
  }
  .search:focus-within {
    box-shadow: 0 0 0 2px var(--c-accent-text);
  }
  .search input {
    flex: 1;
    min-width: 0;
    border: 0;
    background: transparent;
    font-size: var(--fs-lg);
    -webkit-user-select: text;
    user-select: text;
  }
  .search input:focus-visible {
    outline: none;
  }
  .chips {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 0 calc(var(--s-4) * -1);
    padding: 2px var(--s-4);
    overflow-x: auto;
    scrollbar-width: none;
  }
  .chip {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 32px;
    padding: 0 var(--s-3);
    border: 0;
    border-radius: var(--r-pill);
    background: var(--c-surface-2);
    color: var(--c-text-muted);
    font-size: var(--fs-md);
    font-weight: 600;
    cursor: pointer;
  }
  .chip[aria-pressed='true'] {
    background: var(--c-accent);
    color: var(--c-on-accent);
  }
  .chip__count {
    font-size: var(--fs-xs);
    font-variant-numeric: tabular-nums;
    opacity: 0.8;
  }
  .options {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--s-2);
  }
  .sort {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    color: var(--c-text-muted);
    font-size: var(--fs-sm);
    font-weight: 600;
  }
  .sort select {
    height: 32px;
    padding: 0 var(--s-2);
    border: 0;
    border-radius: var(--r-md);
    background: var(--c-surface-2);
    color: var(--c-text);
    font-size: var(--fs-md);
  }
  .toggle {
    height: 32px;
    padding: 0 var(--s-3);
    border: 0;
    border-radius: var(--r-md);
    background: var(--c-surface-2);
    color: var(--c-text-muted);
    font-size: var(--fs-md);
    font-weight: 600;
    cursor: pointer;
  }
  .toggle[aria-pressed='true'] {
    background: var(--c-accent-soft);
    color: var(--c-accent-text);
    box-shadow: inset 0 0 0 1px var(--c-accent);
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
  .list--inner {
    border-radius: 0;
    background: var(--c-bg);
    box-shadow: none;
  }
  .proc + .proc,
  .app + .proc,
  .proc + .app,
  .app + .app {
    border-top: 1px solid var(--c-surface-2);
  }
  .proc--open {
    background: var(--c-surface-2);
  }
  .proc__row {
    width: 100%;
    display: flex;
    align-items: center;
    gap: var(--s-2);
    min-height: 56px;
    padding: var(--s-2) var(--s-3) var(--s-2) 0;
    border: 0;
    background: transparent;
    color: var(--c-text);
    text-align: left;
    cursor: pointer;
  }
  .proc--inner .proc__row {
    padding-left: var(--s-3);
  }
  .kind {
    flex: 0 0 auto;
    align-self: stretch;
    width: 3px;
    border-radius: 0 2px 2px 0;
    background: var(--c-surface-3);
  }
  .kind--app {
    background: var(--c-accent-text);
  }
  .kind--dev {
    background: var(--c-ok);
  }
  .kind--terminal {
    background: var(--c-merged);
  }
  .kind--service {
    background: var(--c-warn);
  }
  .kind--desktop {
    background: var(--c-folder);
  }
  .proc__text {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding-left: var(--s-2);
  }
  .proc__name {
    overflow: hidden;
    font-size: var(--fs-lg);
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .count {
    margin-left: var(--s-1);
    padding: 0 6px;
    border-radius: var(--r-pill);
    background: var(--c-surface-3);
    color: var(--c-text-soft);
    font-size: var(--fs-xs);
    font-weight: 700;
    vertical-align: middle;
  }
  .proc__sub {
    overflow: hidden;
    color: var(--c-text-muted);
    font: var(--fs-xs) / 1.4 var(--font-mono);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .proc__nums {
    flex: 0 0 auto;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    min-width: 52px;
    font-variant-numeric: tabular-nums;
  }
  .proc__cpu {
    font-size: var(--fs-md);
    font-weight: 700;
  }
  .proc__cpu.hot {
    color: var(--c-warn);
  }
  .proc__mem {
    color: var(--c-text-muted);
    font-size: var(--fs-xs);
  }
  .more {
    align-self: center;
    min-height: var(--tap);
    padding: 0 var(--s-3);
    border: 0;
    background: transparent;
    color: var(--c-accent-text);
    font-size: var(--fs-md);
    font-weight: 600;
    cursor: pointer;
  }
  .empty {
    margin: 0;
    padding: var(--s-4);
    border-radius: var(--r-xl);
    background: var(--c-surface);
    color: var(--c-text-muted);
  }
  .skeleton {
    height: 320px;
    border-radius: var(--r-xl);
    background: var(--c-surface);
  }
</style>
