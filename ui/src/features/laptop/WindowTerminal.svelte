<!-- One of Airlock's terminals, open in the laptop window: the same tmux
     terminal the phone sees, typed into from here. Leaving only detaches;
     the terminal keeps running. -->
<script lang="ts">
  import { FitAddon } from '@xterm/addon-fit';
  import { Terminal } from '@xterm/xterm';
  import { onMount } from 'svelte';

  import { hub } from '../admin/hub';

  let { terminal, name, onback }: { terminal: number; name: string; onback: () => void } = $props();

  let host: HTMLElement | undefined = $state();
  let ended = $state(false);
  let problem = $state<string | null>(null);

  function token(property: string): string {
    return getComputedStyle(document.documentElement).getPropertyValue(property).trim();
  }

  onMount(() => {
    if (!host) return;
    const term = new Terminal({
      fontSize: 14,
      fontFamily: token('--font-terminal') || 'monospace',
      cursorBlink: true,
      scrollback: 2000,
      theme: { background: token('--c-terminal'), foreground: token('--c-terminal-text') },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);
    fit.fit();
    let screen: number | null = null;
    let closed = false;

    hub
      .openTerminal(terminal, term.cols, term.rows, (bytes) => {
        if (bytes.length === 0) ended = true;
        else term.write(bytes);
      })
      .then((opened) => {
        if (closed) void hub.closeTerminal(opened).catch(() => {});
        else screen = opened;
      })
      .catch((error: unknown) => (problem = error instanceof Error ? error.message : String(error)));

    const typing = term.onData((data) => {
      if (screen !== null) void hub.terminalInput(screen, data).catch(() => {});
    });
    const observer = new ResizeObserver(() => {
      fit.fit();
      if (screen !== null) void hub.terminalResize(screen, term.cols, term.rows).catch(() => {});
    });
    observer.observe(host);
    term.focus();

    return () => {
      closed = true;
      observer.disconnect();
      typing.dispose();
      if (screen !== null) void hub.closeTerminal(screen).catch(() => {});
      term.dispose();
    };
  });
</script>

<section class="window" aria-labelledby="window-title">
  <header class="bar">
    <button class="btn btn--quiet" type="button" onclick={onback}><span aria-hidden="true">‹</span> All terminals</button>
    <h2 id="window-title">{name}</h2>
    <span class="note">Leaving keeps it running</span>
  </header>
  {#if problem}<p class="error-text" role="alert">{problem}</p>{/if}
  {#if ended}<p class="ended" role="status">This terminal has closed.</p>{/if}
  <div class="term" bind:this={host}></div>
</section>

<style>
  .window {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
  }
  .bar {
    display: flex;
    align-items: center;
    gap: var(--s-3);
  }
  h2 {
    flex: 1;
    margin: 0;
    font-size: var(--fs-xl);
  }
  .note {
    color: var(--c-text-muted);
    font-size: var(--fs-sm);
  }
  .term {
    flex: 1;
    min-height: 420px;
    padding: var(--s-2);
    border-radius: var(--r-lg);
    background: var(--c-terminal);
  }
  .ended {
    margin: 0;
    color: var(--c-warn);
  }
  .error-text {
    margin: 0;
  }
</style>
