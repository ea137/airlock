<!-- One process opened up: what it is, how it was started, the package it
     came from, and everything else the system knows about it, each with a
     "?" that explains it. -->
<script lang="ts">
  import { api, type ProcessDetail, type ProcessRow } from '../../lib/api';
  import Help from '../../lib/Help.svelte';
  import { hrefFor } from '../../lib/router.svelte';
  import { askAbout } from '../ask/ask.svelte';
  import { openTerminal } from '../center/open';
  import { HELP } from './help';
  import { bytes, duration, shortHome } from './labels';
  import { percent } from './processes';

  let {
    process,
    home,
    previews,
    onstop,
  }: { process: ProcessRow; home: string; previews: boolean; onstop: (process: ProcessRow) => void } = $props();

  let detail = $state<ProcessDetail | null>(null);
  let failed = $state(false);

  // Read once per process: the list's refresh hands over a new row each
  // time, but the same pid and start time are the same process.
  const pid = $derived(process.pid);
  const started = $derived(process.started);
  $effect(() => {
    let current = true;
    api
      .processDetail(pid, started)
      .then((found) => {
        if (current) detail = found;
      })
      .catch(() => {
        if (current) failed = true;
      });
    return () => {
      current = false;
    };
  });

  const STATE_WORD = {
    running: 'Running',
    sleeping: 'Sleeping',
    disk: 'Waiting on the disk',
    stopped: 'Stopped',
    zombie: 'Finished (zombie)',
    idle: 'Idle',
  } as const;
</script>

<div class="details">
  {#if process.about || detail?.package_about}
    <p class="about">{process.about ?? detail?.package_about}</p>
  {/if}

  <div class="command">
    <span class="label">Command <Help {...HELP.command} /></span>
    <code>{detail?.command || process.command || '(none)'}</code>
  </div>

  <dl class="facts">
    <div><dt>PID <Help {...HELP.pid} /></dt><dd>{process.pid}</dd></div>
    <div>
      <dt>Started by <Help {...HELP.parent} /></dt>
      <dd>{detail?.parent ?? '…'} ({process.ppid})</dd>
    </div>
    <div><dt>User <Help {...HELP.user} /></dt><dd>{process.mine ? `${process.user} (you)` : process.user}</dd></div>
    <div><dt>State <Help {...HELP.state} /></dt><dd>{STATE_WORD[process.state]}</dd></div>
    <div><dt>CPU <Help {...HELP.cpu} /></dt><dd>{percent(process.cpu)}</dd></div>
    <div><dt>Memory <Help {...HELP.memory} /></dt><dd>{bytes(process.memory)}</dd></div>
    <div><dt>Threads <Help {...HELP.threads} /></dt><dd>{process.threads}</dd></div>
    <div><dt>Niceness <Help {...HELP.nice} /></dt><dd>{process.nice}</dd></div>
    <div><dt>Running for <Help {...HELP.started} /></dt><dd>{duration(process.running_for)}</dd></div>
    {#if process.ports.length > 0}
      <div><dt>Ports <Help {...HELP.ports} /></dt><dd>{process.ports.map((port) => `:${port}`).join(', ')}</dd></div>
    {/if}
    {#if process.cwd}
      <div class="wide"><dt>Working folder <Help {...HELP.cwd} /></dt><dd>{shortHome(process.cwd, home)}</dd></div>
    {/if}
    {#if process.unit}
      <div class="wide"><dt>Runs in <Help {...HELP.unit} /></dt><dd>{process.unit}</dd></div>
    {/if}
    {#if detail?.package}
      <div class="wide">
        <dt>Installed by</dt>
        <dd>{detail.package}{#if detail.package_about && detail.package_about !== process.about} · {detail.package_about}{/if}</dd>
      </div>
    {/if}
    {#if detail?.exe}
      <div class="wide"><dt>Program</dt><dd>{detail.exe}</dd></div>
    {/if}
  </dl>
  {#if failed}<p class="note">It stopped while being read.</p>{/if}

  <div class="actions">
    <button
      class="btn"
      type="button"
      onclick={() =>
        askAbout({
          title: `the process ${process.name}`,
          context: [
            `Process ${process.pid} (${process.name}), run by ${process.mine ? 'the owner' : process.user}, ${STATE_WORD[process.state].toLowerCase()}, for ${duration(process.running_for)}.`,
            `Command: ${detail?.command || process.command || '(none)'}`,
            `CPU ${percent(process.cpu)}, memory ${bytes(process.memory)}, ${process.threads} threads.`,
            process.cwd ? `Working folder: ${process.cwd}` : '',
            process.unit ? `Runs in: ${process.unit}` : '',
            process.ports.length ? `Listens on ports ${process.ports.join(', ')}.` : '',
            detail?.package ? `Installed by the package ${detail.package}.` : '',
            process.about ? `Airlock's note: ${process.about}` : '',
          ]
            .filter(Boolean)
            .join('\n'),
        })}>Ask Claude about it</button
    >
    {#if process.terminal}
      {@const link = process.terminal}
      <button class="btn" type="button" onclick={() => openTerminal(link)}>Its terminal</button>
    {/if}
    {#if previews && process.kind === 'dev' && process.ports[0]}
      <a class="btn" href={hrefFor({ name: 'preview', port: process.ports[0] })}>Preview :{process.ports[0]}</a>
    {/if}
    {#if process.keep}
      <p class="keep">{process.keep} <Help {...HELP.keep} /></p>
    {:else}
      <button class="btn btn--danger" type="button" onclick={() => onstop(process)}>Stop</button>
    {/if}
  </div>
</div>

<style>
  .details {
    display: flex;
    flex-direction: column;
    gap: var(--s-3);
    padding: var(--s-1) var(--s-3) var(--s-3) var(--s-4);
  }
  .about {
    margin: 0;
    color: var(--c-text-soft);
    font-size: var(--fs-md);
    line-height: 1.45;
  }
  .command {
    display: flex;
    flex-direction: column;
    gap: var(--s-1);
  }
  .label,
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
  code {
    padding: var(--s-2);
    border-radius: var(--r-md);
    background: var(--c-code-bg);
    color: var(--c-code);
    font: var(--fs-sm) / 1.45 var(--font-mono);
    overflow-wrap: anywhere;
    -webkit-user-select: text;
    user-select: text;
  }
  .facts {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--s-2) var(--s-3);
    margin: 0;
  }
  .facts .wide {
    grid-column: 1 / -1;
  }
  dd {
    margin: 2px 0 0;
    overflow-wrap: anywhere;
    font-size: var(--fs-md);
  }
  .note {
    margin: 0;
    color: var(--c-text-muted);
    font-size: var(--fs-sm);
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--s-2);
  }
  .actions .btn {
    min-height: 40px;
  }
  .keep {
    flex: 1;
    margin: 0;
    color: var(--c-text-muted);
    font-size: var(--fs-sm);
    line-height: 1.4;
  }
</style>
