<!-- What's running on the laptop, in three tabs. Overview: resources, who
     can reach which port and whether that should worry you, dev servers to
     preview, jobs left behind, and the busiest processes. Processes: all of
     them, live. Services: services and timers. Stopping anything asks
     first. -->
<script lang="ts" module>
  import { api, type SystemView } from '../../lib/api';
  import { Polled } from '../../lib/polled.svelte';

  const REFRESH_MS = 5000;

  // Kept between visits: coming back shows the last of it at once while it
  // refreshes.
  const system = new Polled<SystemView>(() => api.system(), REFRESH_MS);
</script>

<script lang="ts">
  import { untrack } from 'svelte';

  import type { PortView, ProcessView } from '../../lib/api';
  import Help from '../../lib/Help.svelte';
  import MainHeader from '../../lib/MainHeader.svelte';
  import Problem from '../../lib/Problem.svelte';
  import { hrefFor } from '../../lib/router.svelte';
  import type { SystemTab } from '../../lib/routes';
  import { session } from '../../lib/session.svelte';
  import { openTerminal } from '../center/open';
  import { HELP } from './help';
  import { bytes, DISK_WARN, diskSize, duration, exposureLabel, shortHome } from './labels';
  import PortSheet from './PortSheet.svelte';
  import ProcessesTab from './ProcessesTab.svelte';
  import ServicesTab from './ServicesTab.svelte';
  import StopDialog from './StopDialog.svelte';

  /** `port`: a listening port to open the details of, from a link; `unit`,
   * a service to open on the services tab. */
  let {
    tab = 'overview',
    port,
    unit,
  }: { tab?: SystemTab; port?: number; unit?: { name: string; scope: 'user' | 'system' } } = $props();

  const PORTS_FIRST = 6;
  /** The busiest processes the overview shows; the rest are a tab away. */
  const BUSIEST = 3;
  const TABS: { id: SystemTab; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'processes', label: 'Processes' },
    { id: 'services', label: 'Services & timers' },
  ];

  $effect(() => {
    if (tab === 'overview') return system.watch();
  });

  type Stopping = {
    name: string;
    details: string;
    stop: (force: boolean) => Promise<boolean>;
    canForce: boolean;
  };
  let stopping = $state<Stopping | null>(null);
  let allPorts = $state(false);
  /** The port whose details are open; the link's, at first. */
  let opened = $state<number | null>(untrack(() => port ?? null));

  const data = $derived(system.data);
  const paired = $derived(session.state.status === 'paired' ? session.state.session : null);
  const home = $derived(paired?.home ?? '');
  const previews = $derived(Boolean(paired?.preview_port));
  const ports = $derived(data ? (allPorts ? data.ports : data.ports.slice(0, PORTS_FIRST)) : []);
  const openPort = $derived(data?.ports.find((listener) => listener.port === opened) ?? null);
  const diskShare = $derived(data ? data.resources.disk_used / Math.max(1, data.resources.disk_total) : 0);

  function closePort() {
    opened = null;
    // Opened from a link: the address goes back to the overview's, without
    // a reload of the screen.
    if (port !== undefined) history.replaceState(history.state, '', hrefFor({ name: 'system' }));
  }

  function stopPort(listener: PortView) {
    closePort();
    const { container, pid, started } = listener;
    if (listener.owner === 'docker' && container) {
      stopping = {
        name: `the ${container} container`,
        details: `Docker stops ${container}${listener.image ? ` (${listener.image})` : ''}. Whatever uses it loses its connection; docker start ${container} starts it again.`,
        canForce: false,
        stop: async () => (await api.stopContainer(container)).stopped,
      };
    } else if (pid !== null && started !== null) {
      stopping = {
        name: listener.name,
        details: `Process ${pid}. It stops serving :${listener.port}.`,
        canForce: true,
        stop: async (force) => (await api.stopProcess(listener.name, pid, started, force)).stopped,
      };
    }
  }
  const nextTimer = $derived(
    data?.timers
      .filter((timer) => timer.next !== null)
      .sort((a, b) => (a.next ?? 0) - (b.next ?? 0))[0],
  );

  function stopProcess(process: ProcessView) {
    const where = process.cwd ? ` in ${shortHome(process.cwd, home)}` : '';
    const serving = process.ports.length ? ` It also stops serving ${process.ports.map((p) => `:${p}`).join(', ')}.` : '';
    stopping = {
      name: process.label,
      details: `${process.comm}, process ${process.pid}, running for ${duration(process.running_for)}${where}.${serving}`,
      canForce: true,
      stop: async (force) =>
        (await api.stopProcess(process.label, process.pid, process.started, force)).stopped,
    };
  }

  function time(seconds: number): string {
    return new Date(seconds * 1000).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  }
</script>

<main class="system">
  <MainHeader current="system" />

  <nav class="tabs" aria-label="System">
    {#each TABS as item (item.id)}
      <a href={hrefFor({ name: 'system', tab: item.id })} aria-current={tab === item.id ? 'page' : undefined}>{item.label}</a>
    {/each}
  </nav>

  <div class="scroll">
    {#if tab === 'processes'}
      <ProcessesTab />
    {:else if tab === 'services'}
      <ServicesTab {unit} />
    {:else if data}
      {@const r = data.resources}
      <div class="tiles">
        <div class="tile">
          <span class="value">{r.load.toFixed(1)}</span>
          <span class="label">load · {r.cpus} cores <Help {...HELP.load} /></span>
        </div>
        <div class="tile">
          <span class="value">{bytes(r.memory_used)}</span>
          <span class="label">of {bytes(r.memory_total)}</span>
        </div>
        <div class="tile" class:tile--warn={diskShare >= DISK_WARN}>
          <span class="value">{diskSize(Math.max(0, r.disk_total - r.disk_used))}</span>
          <span class="label">free of {diskSize(r.disk_total)}</span>
          <span class="meter" role="img" aria-label={`Disk ${Math.round(diskShare * 100)}% used`}
            ><span class="meter__used" style:width={`${Math.round(diskShare * 100)}%`}></span></span
          >
        </div>
        <div class="tile">
          <span class="value">{r.battery === null ? '—' : `${r.battery}%`}</span>
          <span class="label">{r.battery === null ? 'no battery' : r.charging ? 'charging' : 'on battery'}</span>
        </div>
      </div>

      <section aria-labelledby="ports-title">
        <h2 id="ports-title">LISTENING PORTS</h2>
        <ul class="list">
          {#each ports as listener (listener.port)}
            <li class="row">
              <button class="row__main" type="button" onclick={() => (opened = listener.port)}>
                <span class="port">:{listener.port}</span>
                <span class="what"><span>{listener.name}</span></span>
                <span class={`chip chip--${listener.verdict}`}>{exposureLabel(listener.exposure)}</span>
                <span class="chev" aria-hidden="true">›</span>
              </button>
              {#if listener.dev && previews}
                <a class="preview" href={hrefFor({ name: 'preview', port: listener.port })}>Preview</a>
              {/if}
            </li>
          {/each}
          {#if data.ports.length > PORTS_FIRST}
            <li>
              <button class="more" type="button" onclick={() => (allPorts = !allPorts)}>
                {allPorts ? 'Show fewer' : `Show ${data.ports.length - PORTS_FIRST} more`}
              </button>
            </li>
          {/if}
        </ul>
      </section>

      {#if data.jobs.length > 0}
        <section aria-labelledby="jobs-title">
          <h2 id="jobs-title">BACKGROUND JOBS</h2>
          <ul class="list">
            {#each data.jobs as job (job.pid)}
              <li class="row row--padded">
                <span class="what">
                  <span class="strong">{job.label} <span class="sub">· {job.comm} · {duration(job.running_for)}</span></span>
                  {#if job.cwd}<span class="sub">{shortHome(job.cwd, home)}</span>{/if}
                  <span class="warn">Its terminal is gone</span>
                </span>
                <button class="stop" type="button" onclick={() => stopProcess(job)}>Stop</button>
              </li>
            {/each}
          </ul>
        </section>
      {/if}

      <section aria-labelledby="heavy-title">
        <h2 id="heavy-title">BUSIEST NOW</h2>
        <ul class="list">
          {#each data.heavy.slice(0, BUSIEST) as process (process.pid)}
            <li class="row row--padded">
              <span class="what">
                <span class="strong">{process.label}</span>
                <span class="sub">
                  {process.cpu === null ? '…' : `${Math.round(process.cpu)}% CPU`} · {bytes(process.memory)} · {duration(process.running_for)}
                </span>
              </span>
              {#if process.terminal}
                {@const link = process.terminal}
                <button class="link" type="button" onclick={() => openTerminal(link)}>Terminal</button>
              {/if}
              <button class="stop" type="button" onclick={() => stopProcess(process)}>Stop</button>
            </li>
          {/each}
          <li>
            <a class="row row--padded row--button" href={hrefFor({ name: 'system', tab: 'processes' })}>
              <span class="what"><span>Every process, live</span><span class="sub">filter, sort, group by app</span></span>
              <span class="chev" aria-hidden="true">›</span>
            </a>
          </li>
        </ul>
      </section>

      <section aria-labelledby="services-title">
        <h2 id="services-title">SERVICES &amp; TIMERS</h2>
        <ul class="list">
          <li>
            <a class="row row--padded row--button" href={hrefFor({ name: 'system', tab: 'services' })}>
              <span class="dot" aria-hidden="true"></span>
              <span class="what">
                <span>{data.services.length} of yours running · {data.timers.length} {data.timers.length === 1 ? 'timer' : 'timers'}</span>
                {#if nextTimer?.next}
                  <span class="sub">next: {nextTimer.unit.replace(/\.timer$/, '')} at {time(nextTimer.next)}</span>
                {/if}
              </span>
              <span class="chev" aria-hidden="true">›</span>
            </a>
          </li>
        </ul>
      </section>
    {:else if system.error}
      <Problem message={system.error.message} onretry={() => system.refresh()} />
    {:else}
      <div class="tiles tiles--skeleton" aria-hidden="true"></div>
      <span class="visually-hidden" role="status">Loading the laptop's state</span>
    {/if}
  </div>

  {#if openPort && data}
    {@const listener = openPort}
    <PortSheet
      port={listener}
      firewall={data.firewall}
      {previews}
      onstop={() => stopPort(listener)}
      onterminal={() => listener.terminal && openTerminal(listener.terminal)}
      onclose={closePort}
    />
  {/if}

  {#if stopping}
    <StopDialog
      name={stopping.name}
      details={stopping.details}
      stop={stopping.stop}
      canForce={stopping.canForce}
      onclose={() => (stopping = null)}
      ondone={() => {
        stopping = null;
        void system.refresh();
      }}
    />
  {/if}
</main>

<style>
  .system {
    height: 100%;
    display: flex;
    flex-direction: column;
    padding-top: var(--safe-top);
  }
  .scroll {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: var(--s-4);
    padding: var(--s-1) var(--s-4) calc(var(--s-6) + var(--safe-bottom));
    container-type: inline-size;
  }
  /* Four across, or two by two on a narrow screen (the Game Boy's). */
  .tiles {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 6px;
  }
  @container (max-width: 340px) {
    .tiles {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
  .tiles--skeleton {
    height: 58px;
    border-radius: var(--r-lg);
    background: var(--c-surface);
  }
  .tile {
    display: flex;
    flex-direction: column;
    padding: var(--s-2);
    border-radius: var(--r-lg);
    background: var(--c-surface);
    box-shadow: 0 0 0 1px var(--c-line);
  }
  .tile--warn {
    background: var(--c-warn-soft);
    box-shadow: 0 0 0 1px var(--c-warn);
  }
  .value {
    font-size: var(--fs-2xl);
    font-weight: 700;
  }
  .tile--warn .value {
    color: var(--c-warn);
  }
  .meter {
    height: 4px;
    margin-top: var(--s-1);
    overflow: hidden;
    border-radius: var(--r-pill);
    background: var(--c-surface-2);
  }
  .meter__used {
    display: block;
    height: 100%;
    background: var(--c-text-muted);
  }
  .tile--warn .meter__used {
    background: var(--c-warn);
  }
  .label {
    color: var(--c-text-muted);
    font-size: var(--fs-xs);
  }
  h2 {
    margin: 0 0 6px;
    color: var(--c-text-muted);
    font-size: var(--fs-md);
    font-weight: 700;
    letter-spacing: 0.5px;
  }
  .list {
    margin: 0;
    padding: 0;
    overflow: hidden;
    border-radius: var(--r-lg);
    background: var(--c-surface);
    box-shadow: 0 0 0 1px var(--c-line);
    list-style: none;
  }
  .list > li + li {
    border-top: 1px solid var(--c-surface-2);
  }
  .row {
    display: flex;
    align-items: center;
  }
  .row--padded {
    gap: var(--s-3);
    min-height: 46px;
    padding: var(--s-2) var(--s-3);
  }
  .row--button {
    width: 100%;
    border: 0;
    background: none;
    color: var(--c-text);
    text-align: left;
    text-decoration: none;
    cursor: pointer;
  }
  .row--button:hover {
    background: var(--c-surface-2);
  }
  /* Equal thirds; a label too long for its third (in a wide pixel face)
     wraps instead of running past the screen. */
  .tabs {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 2px;
    margin: 0 var(--s-4) var(--s-2);
    border-bottom: 1px solid var(--c-line);
  }
  .tabs a {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 40px;
    padding: var(--s-1);
    border-bottom: 2px solid transparent;
    color: var(--c-text-muted);
    font-size: var(--fs-md);
    font-weight: 600;
    line-height: 1.2;
    text-align: center;
    text-decoration: none;
  }
  .tabs a[aria-current='page'] {
    border-bottom-color: var(--c-accent-text);
    color: var(--c-text);
  }
  .row__main {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: var(--s-3);
    min-height: 46px;
    padding: 0 var(--s-3);
    border: 0;
    background: none;
    color: var(--c-text);
    font: inherit;
    text-align: left;
    cursor: pointer;
    transition-property: background-color;
    transition-duration: var(--t-hover);
  }
  .row__main:hover {
    background: var(--c-surface-2);
  }
  .preview {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    align-self: stretch;
    padding: 0 var(--s-3);
    border-left: 1px solid var(--c-surface-2);
    color: var(--c-accent-text);
    font-size: var(--fs-md);
    font-weight: 600;
    text-decoration: none;
  }
  .preview:hover {
    background: var(--c-surface-2);
  }
  .port {
    flex: 0 0 56px;
    font-family: var(--font-mono);
    font-weight: 600;
  }
  .what {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
    overflow-wrap: anywhere;
  }
  .strong {
    font-weight: 600;
  }
  .sub {
    color: var(--c-text-muted);
    font-size: var(--fs-sm);
    font-weight: 400;
  }
  .warn {
    color: var(--c-warn);
    font-size: var(--fs-sm);
  }
  .chip {
    padding: 2px 7px;
    border-radius: var(--r-pill);
    background: var(--c-surface-2);
    color: var(--c-text-soft);
    font-size: var(--fs-xs);
    white-space: nowrap;
  }
  /* Coloured by whether it should worry you, not only by who can reach it. */
  .chip--look {
    background: var(--c-warn-soft);
    color: var(--c-warn);
  }
  .chip--worry {
    background: var(--c-danger-soft);
    color: var(--c-danger-text);
  }
  .chev {
    color: var(--c-text-faint);
  }
  .more {
    width: 100%;
    height: 40px;
    padding: 0 var(--s-3);
    border: 0;
    background: transparent;
    color: var(--c-accent-text);
    font-size: var(--fs-md);
    text-align: left;
    cursor: pointer;
  }
  .stop {
    min-height: 36px;
    padding: 0 var(--s-3);
    border: 0;
    border-radius: var(--r-md);
    background: var(--c-danger-soft);
    color: var(--c-danger-text);
    font-size: var(--fs-md);
    font-weight: 600;
    cursor: pointer;
  }
  .link {
    min-height: 36px;
    padding: 0 var(--s-2);
    border: 0;
    background: none;
    color: var(--c-accent-text);
    font-size: var(--fs-md);
    cursor: pointer;
  }
  .dot {
    flex: 0 0 auto;
    width: 8px;
    height: 8px;
    border-radius: var(--r-pill);
    background: var(--c-ok);
  }
  .dot--idle {
    background: none;
    box-shadow: inset 0 0 0 1.5px var(--c-text-muted);
  }
</style>
