<!-- Services and timers, yours and the system's: what each is, whether it
     runs and since when, what it uses, and when a timer runs next. A failed
     one says why, whether that matters, and what to do. Yours can be
     stopped (after asking); the system's are for looking. -->
<script lang="ts" module>
  import { api, type UnitsView } from '../../lib/api';
  import { Polled } from '../../lib/polled.svelte';

  const REFRESH_MS = 5000;

  // Kept between visits: coming back shows the last of it at once while it
  // refreshes.
  const units = new Polled<UnitsView>(() => api.units(), REFRESH_MS);
</script>

<script lang="ts">
  import { untrack } from 'svelte';

  import type { ServiceView, TimerView, UnitWhy } from '../../lib/api';
  import Help from '../../lib/Help.svelte';
  import { ago, nowSecs } from '../../lib/format';
  import Problem from '../../lib/Problem.svelte';
  import { handleError } from '../../lib/session.svelte';
  import { askAbout } from '../ask/ask.svelte';
  import CopyCommand from './CopyCommand.svelte';
  import { HELP } from './help';
  import { bytes, duration } from './labels';
  import { serviceStory } from './services';
  import StopDialog from './StopDialog.svelte';
  import Verdict from './Verdict.svelte';

  type Scope = 'user' | 'system';

  /** `unit`: a service to open, from a link. */
  let { unit }: { unit?: { name: string; scope: Scope } } = $props();

  type StateFilter = 'all' | 'running' | 'failed' | 'stopped';

  let scope = $state<Scope>(untrack(() => unit?.scope ?? 'user'));
  let shown = $state<StateFilter>('all');
  let words = $state('');
  let open = $state<string | null>(untrack(() => unit?.name ?? null));
  let stopping = $state<{ unit: string; description: string } | null>(null);
  /** Why the open service failed, once read. */
  let why = $state<{ unit: string; facts: UnitWhy | null; problem: string | null } | null>(null);

  $effect(() => units.watch());

  const data = $derived(units.data);
  const status = (service: ServiceView): Exclude<StateFilter, 'all'> =>
    service.active === 'failed' ? 'failed' : service.active === 'active' || service.active === 'activating' ? 'running' : 'stopped';
  const inScope = $derived((data?.services ?? []).filter((service) => service.scope === scope));
  const counts = $derived({
    all: inScope.length,
    running: inScope.filter((service) => status(service) === 'running').length,
    failed: inScope.filter((service) => status(service) === 'failed').length,
    stopped: inScope.filter((service) => status(service) === 'stopped').length,
  });
  const find = (texts: string[]) => {
    const looking = words.trim().toLowerCase();
    return !looking || texts.some((text) => text.toLowerCase().includes(looking));
  };
  const services = $derived(
    inScope
      .filter((service) => shown === 'all' || status(service) === shown)
      .filter((service) => find([service.unit, service.description]))
      .sort((a, b) => {
        const rank = { failed: 0, running: 1, stopped: 2 };
        return rank[status(a)] - rank[status(b)] || a.unit.localeCompare(b.unit);
      }),
  );
  const timers = $derived(
    (data?.timers ?? [])
      .filter((timer) => timer.scope === scope)
      .filter((timer) => find([timer.unit, timer.description, timer.activates]))
      .sort((a, b) => (a.next ?? Infinity) - (b.next ?? Infinity)),
  );

  const short = (unit: string) => unit.replace(/\.(service|timer)$/, '');

  // The open service, if it failed: its log is read once each time it opens,
  // not with every refresh.
  const failedOpen = $derived(
    (data?.services ?? []).some((service) => service.unit === open && service.scope === scope && status(service) === 'failed')
      ? open
      : null,
  );
  $effect(() => {
    const unit = failedOpen;
    if (!unit) return;
    let current = true;
    why = { unit, facts: null, problem: null };
    api.unitWhy(unit, untrack(() => scope)).then(
      (facts) => {
        if (current) why = { unit, facts, problem: null };
      },
      (error: unknown) => {
        if (current) why = { unit, facts: null, problem: handleError(error).message };
      },
    );
    return () => {
      current = false;
    };
  });

  /** Brings the service a link opened into view, once it's listed. */
  function linked(node: HTMLElement, opened: boolean) {
    if (opened) requestAnimationFrame(() => node.scrollIntoView({ block: 'start' }));
  }

  function when(seconds: number | null): string {
    if (seconds === null) return 'not scheduled';
    const now = nowSecs();
    const clock = new Date(seconds * 1000).toLocaleString('en-GB', {
      weekday: seconds - now > 86_400 ? 'short' : undefined,
      hour: '2-digit',
      minute: '2-digit',
    });
    return seconds >= now ? `in ${duration(seconds - now)} · ${clock}` : `${ago(seconds, now)} · ${clock}`;
  }

  function enabledWord(service: ServiceView): string | null {
    switch (service.enabled) {
      case 'enabled':
        return service.scope === 'user' ? 'starts at login' : 'starts at boot';
      case 'static':
      case 'indirect':
        return 'started by something else';
      case 'disabled':
        return 'starts only by hand';
      default:
        return null;
    }
  }
</script>

<div class="tab">
  {#if data}
    <div class="controls">
      <div class="scope" role="group" aria-label="Whose">
        <button type="button" aria-pressed={scope === 'user'} onclick={() => (scope = 'user')}>Yours</button>
        <button type="button" aria-pressed={scope === 'system'} onclick={() => (scope = 'system')}>System</button>
      </div>
      <Help {...HELP.scope} />
    </div>

    <label class="search">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"
        ><circle cx="11" cy="11" r="7"></circle><path d="M21 21l-4.3-4.3"></path></svg
      >
      <span class="visually-hidden">Search services and timers</span>
      <input type="search" bind:value={words} placeholder="Name or description" autocomplete="off" />
    </label>

    <div class="chips" role="group" aria-label="State">
      {#each [['all', 'All'], ['running', 'Running'], ['failed', 'Failed'], ['stopped', 'Stopped']] as const as [id, label] (id)}
        {#if id === 'all' || counts[id] > 0}
          <button class={`chip chip--${id}`} type="button" aria-pressed={shown === id} onclick={() => (shown = id)}>
            {label}<span class="chip__count">{counts[id]}</span>
          </button>
        {/if}
      {/each}
      <Help {...HELP.serviceState} />
    </div>

    <h2>SERVICES</h2>
    {#if services.length === 0}
      <p class="empty">No services match.</p>
    {:else}
      <ul class="list">
        {#each services as service (service.unit)}
          {@const state = status(service)}
          <li class="unit" class:unit--open={open === service.unit} use:linked={unit?.name === service.unit}>
            <button
              class="unit__row"
              type="button"
              aria-expanded={open === service.unit}
              onclick={() => (open = open === service.unit ? null : service.unit)}
            >
              <span class={`dot dot--${state}`} aria-hidden="true"></span>
              <span class="unit__text">
                <span class="unit__name">{short(service.unit)}</span>
                <span class="unit__about">{service.description || 'No description'}</span>
                <span class="unit__meta">
                  <span class={`state state--${state}`}>{state === 'running' ? service.sub : state}</span>
                  {#if state === 'running' && service.since}· {duration(nowSecs() - service.since)}{/if}
                  {#if service.memory}· {bytes(service.memory)}{/if}
                  {#if service.restarts}· restarted {service.restarts}×{/if}
                </span>
              </span>
            </button>
            {#if open === service.unit}
              <div class="details">
                <!-- A failed one says why first; the figures follow. -->
                {#if state === 'failed'}
                  {@const read = why?.unit === service.unit ? why : null}
                  {@const story = serviceStory(service, read?.facts ?? null)}
                  <Verdict {...story.verdict} />
                  {#if story.what}<p class="about">{story.what}</p>{/if}
                  <section class="part" aria-label="Why it failed">
                    <h3>Why it failed</h3>
                    {#if read?.problem}
                      <p class="error-text" role="alert">{read.problem}</p>
                    {:else if read?.facts}
                      {#if story.ended}<p>{story.ended}</p>{/if}
                      {#if read.facts.log.length > 0}
                        <pre class="log">{read.facts.log.join('\n')}</pre>
                      {:else if read.facts.log_note}
                        <p class="hint">{read.facts.log_note}</p>
                      {/if}
                      {#if read.facts.package}<p class="hint">Installed by the {read.facts.package} package.</p>{/if}
                    {:else}
                      <p class="hint" role="status">Reading its log…</p>
                    {/if}
                  </section>
                  {#if story.todo}
                    <section class="part" aria-label="What to do">
                      <h3>What to do</h3>
                      <p>{story.todo}</p>
                      {#if story.command}<CopyCommand command={story.command} />{/if}
                    </section>
                  {/if}
                  <p class="hint">Its whole log, on the laptop: <code>journalctl {service.scope === 'user' ? '--user ' : ''}-u {service.unit}</code></p>
                  <button
                    class="btn"
                    type="button"
                    onclick={() =>
                      askAbout({
                        title: `${service.unit}, which failed`,
                        context: [
                          `The ${service.scope === 'user' ? "user's own" : "system's"} service ${service.unit} (${service.description || 'no description'}) failed.`,
                          story.ended ?? '',
                          read?.facts?.package ? `It comes from the package ${read.facts.package}.` : '',
                          read?.facts?.file ? `Its unit was made from ${read.facts.file}.` : '',
                          read?.facts?.log.length ? `Its last log lines:\n${read.facts.log.join('\n')}` : '',
                        ]
                          .filter(Boolean)
                          .join('\n'),
                      })}>Ask Claude about it</button
                  >
                {/if}
                <dl class="facts">
                  <div><dt>State <Help {...HELP.serviceState} /></dt><dd>{service.active} · {service.sub}</dd></div>
                  <div>
                    <dt>Starts <Help {...HELP.enabled} /></dt><dd>{enabledWord(service) ?? service.enabled ?? '—'}</dd>
                  </div>
                  {#if service.since}<div><dt>Since</dt><dd>{when(service.since)}</dd></div>{/if}
                  {#if service.pid}<div><dt>Main PID <Help {...HELP.pid} /></dt><dd>{service.pid}</dd></div>{/if}
                  {#if service.memory}<div><dt>Memory <Help {...HELP.memory} /></dt><dd>{bytes(service.memory)}</dd></div>{/if}
                  {#if service.cpu_seconds !== null}
                    <div><dt>CPU time <Help {...HELP.serviceCpu} /></dt><dd>{duration(service.cpu_seconds)}</dd></div>
                  {/if}
                  {#if service.restarts !== null}
                    <div><dt>Restarts <Help {...HELP.restarts} /></dt><dd>{service.restarts}</dd></div>
                  {/if}
                  <div class="wide"><dt>Unit</dt><dd>{service.unit}</dd></div>
                </dl>
                {#if service.keep}
                  <p class="keep">{service.keep}</p>
                {:else if state === 'running'}
                  <button
                    class="btn btn--danger"
                    type="button"
                    onclick={() => (stopping = { unit: service.unit, description: service.description })}>Stop</button
                  >
                {/if}
              </div>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}

    <h2>TIMERS <Help {...HELP.timer} /></h2>
    {#if timers.length === 0}
      <p class="empty">No timers match.</p>
    {:else}
      <ul class="list">
        {#each timers as timer (timer.unit)}
          {@render timerRow(timer)}
        {/each}
      </ul>
    {/if}
  {:else if units.error}
    <Problem message={units.error.message} onretry={() => units.refresh()} />
  {:else}
    <div class="skeleton" aria-hidden="true"></div>
    <span class="visually-hidden" role="status">Reading the laptop's services</span>
  {/if}
</div>

{#snippet timerRow(timer: TimerView)}
  <li class="unit">
    <div class="unit__row unit__row--static">
      <span class="clock" aria-hidden="true">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
          ><circle cx="12" cy="12" r="9"></circle><path d="M12 7v5l3 2"></path></svg
        >
      </span>
      <span class="unit__text">
        <span class="unit__name">{short(timer.unit)}</span>
        {#if timer.description}<span class="unit__about">{timer.description}</span>{/if}
        <span class="unit__meta">next {when(timer.next)}</span>
        {#if timer.last}<span class="unit__meta">last ran {when(timer.last)}</span>{/if}
        {#if timer.activates}<span class="unit__meta">starts {short(timer.activates)}</span>{/if}
      </span>
      {#if !timer.keep}
        <button
          class="stop"
          type="button"
          onclick={() => (stopping = { unit: timer.unit, description: timer.description || `Runs ${timer.activates}` })}
          >Stop</button
        >
      {/if}
    </div>
  </li>
{/snippet}

{#if stopping}
  {@const unit = stopping}
  <StopDialog
    name={short(unit.unit)}
    details={unit.description
      ? `${unit.description}. It stays stopped until it is started again.`
      : 'It stays stopped until it is started again.'}
    canForce={false}
    stop={async () => (await api.stopUnit(unit.unit)).stopped}
    onclose={() => (stopping = null)}
    ondone={() => {
      stopping = null;
      void units.refresh();
    }}
  />
{/if}

<style>
  .tab {
    display: flex;
    flex-direction: column;
    gap: var(--s-3);
  }
  .controls {
    display: flex;
    align-items: center;
    gap: var(--s-2);
  }
  .scope {
    flex: 1;
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    padding: 3px;
    border-radius: var(--r-lg);
    background: var(--c-surface-2);
  }
  .scope button {
    height: 34px;
    border: 0;
    border-radius: var(--r-md);
    background: transparent;
    color: var(--c-text-muted);
    font-size: var(--fs-md);
    font-weight: 600;
    cursor: pointer;
  }
  .scope button[aria-pressed='true'] {
    background: var(--c-surface-hover);
    color: var(--c-text);
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
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
  }
  .chip {
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
  .chip--failed:not([aria-pressed='true']) {
    background: var(--c-danger-soft);
    color: var(--c-danger-text);
  }
  .chip__count {
    font-size: var(--fs-xs);
    font-variant-numeric: tabular-nums;
  }
  h2 {
    display: flex;
    align-items: center;
    gap: 2px;
    margin: var(--s-2) 0 0;
    color: var(--c-text-muted);
    font-size: var(--fs-md);
    font-weight: 700;
    letter-spacing: 0.5px;
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
  .unit + .unit {
    border-top: 1px solid var(--c-surface-2);
  }
  .unit--open {
    background: var(--c-surface-2);
  }
  .unit__row {
    width: 100%;
    display: flex;
    align-items: flex-start;
    gap: var(--s-3);
    padding: var(--s-3);
    border: 0;
    background: transparent;
    color: var(--c-text);
    text-align: left;
    cursor: pointer;
  }
  .unit__row--static {
    cursor: default;
  }
  .dot {
    flex: 0 0 auto;
    width: 10px;
    height: 10px;
    margin-top: 5px;
    border-radius: var(--r-pill);
    background: var(--c-text-faint);
  }
  .dot--running {
    background: var(--c-ok);
    box-shadow: 0 0 0 3px var(--c-ok-soft);
  }
  .dot--failed {
    background: var(--c-danger);
    box-shadow: 0 0 0 3px var(--c-danger-soft);
  }
  .clock {
    flex: 0 0 auto;
    margin-top: 2px;
    color: var(--c-accent-text);
  }
  .unit__text {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .unit__name {
    overflow: hidden;
    font-size: var(--fs-lg);
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .unit__about {
    color: var(--c-text-soft);
    font-size: var(--fs-md);
  }
  .unit__meta {
    color: var(--c-text-muted);
    font-size: var(--fs-sm);
  }
  .state--running {
    color: var(--c-ok-text);
    font-weight: 600;
  }
  .state--failed {
    color: var(--c-danger-text);
    font-weight: 700;
  }
  .details {
    display: flex;
    flex-direction: column;
    gap: var(--s-3);
    padding: 0 var(--s-3) var(--s-3) calc(var(--s-3) + 22px);
  }
  .details > .btn {
    align-self: flex-start;
  }
  .about,
  .part p {
    margin: 0;
    line-height: 1.45;
  }
  .part {
    display: flex;
    flex-direction: column;
    gap: var(--s-1);
  }
  h3 {
    margin: 0;
    color: var(--c-text-muted);
    font-size: var(--fs-md);
    font-weight: 700;
  }
  /* Its last log lines, as the journal has them: scrolled, never wrapped
     past the screen. */
  .log {
    max-height: 14rem;
    margin: 0;
    padding: var(--s-2) var(--s-3);
    overflow: auto;
    border-radius: var(--r-md);
    background: var(--c-terminal);
    color: var(--c-terminal-text);
    font: var(--fs-xs) / 1.5 var(--font-mono);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .facts {
    width: 100%;
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--s-2) var(--s-3);
    margin: 0;
  }
  .facts .wide {
    grid-column: 1 / -1;
  }
  dt {
    display: flex;
    align-items: center;
    gap: 2px;
    color: var(--c-text-muted);
    font-size: var(--fs-xs);
    font-weight: 600;
    letter-spacing: 0.3px;
    text-transform: uppercase;
  }
  dd {
    margin: 2px 0 0;
    overflow-wrap: anywhere;
    font-size: var(--fs-md);
  }
  .hint,
  .keep {
    margin: 0;
    color: var(--c-text-muted);
    font-size: var(--fs-sm);
    line-height: 1.45;
  }
  .hint code {
    font: var(--fs-sm) var(--font-mono);
    color: var(--c-text-soft);
    overflow-wrap: anywhere;
  }
  .stop {
    flex: 0 0 auto;
    align-self: center;
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
