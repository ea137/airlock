<!-- A session's terminal, live: its screen as it is now and the history
     before it, refreshed every second or so, fitted to the phone and
     zoomable, staying on the newest lines unless you scroll back; and a way
     to type into it and press the keys Claude's prompts want. -->
<script lang="ts">
  import { tick } from 'svelte';

  import { api, type SessionScreen } from '../../lib/api';
  import { handleError } from '../../lib/session.svelte';
  import { css, parseAnsi } from './ansi';

  let { id, onopen }: { id: string; onopen: (() => void) | null } = $props();

  const REFRESH_MS = 1200;
  /** Keys a Claude prompt asks for, as the hub names them. */
  const KEYS = [
    { key: 'Enter', label: 'Enter' },
    { key: 'Escape', label: 'Esc' },
    { key: 'Up', label: '↑' },
    { key: 'Down', label: '↓' },
    { key: 'Tab', label: 'Tab' },
    { key: 'BTab', label: '⇧Tab' },
    { key: 'C-c', label: 'Ctrl C' },
  ];

  let screen = $state<SessionScreen | null>(null);
  let problem = $state<string | null>(null);
  let typed = $state('');
  let box: HTMLElement | undefined = $state();
  let width = $state(360);

  $effect(() => {
    let stopped = false;
    const look = async () => {
      if (document.hidden) return;
      try {
        screen = await api.sessionScreen(id);
        problem = null;
      } catch (error) {
        if (!stopped) problem = handleError(error).message;
      }
    };
    void look();
    const timer = setInterval(look, REFRESH_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  });

  $effect(() => {
    if (!box) return;
    const observer = new ResizeObserver(() => (width = box?.clientWidth ?? 360));
    observer.observe(box);
    return () => observer.disconnect();
  });

  const ZOOM_KEY = 'airlock.liveZoom';
  const ZOOM_MIN = 1;
  const ZOOM_MAX = 3;
  const ZOOM_STEP = 0.25;

  function savedZoom(): number {
    try {
      const zoom = Number(localStorage.getItem(ZOOM_KEY));
      return zoom >= ZOOM_MIN && zoom <= ZOOM_MAX ? zoom : ZOOM_MIN;
    } catch {
      return ZOOM_MIN;
    }
  }

  /** 1 fits the whole width; more is larger, and scrolls sideways. */
  let zoom = $state(savedZoom());
  /** Whether it follows the newest lines: until you scroll back. */
  let following = $state(true);

  function setZoom(next: number) {
    zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, next));
    try {
      localStorage.setItem(ZOOM_KEY, String(zoom));
    } catch {
      // Not remembered; it still applies now.
    }
  }

  function scrolled() {
    if (!box) return;
    following = box.scrollTop + box.clientHeight >= box.scrollHeight - 12;
  }

  function toNewest() {
    following = true;
    if (box) box.scrollTop = box.scrollHeight;
  }

  /** Monospace glyphs are about 0.6 of the font size wide: fit the columns. */
  const fitSize = $derived(screen ? Math.max(5, Math.min(13, (width - 16) / (screen.width * 0.6))) : 10);
  const fontSize = $derived(fitSize * zoom);
  const runs = $derived(screen ? parseAnsi(screen.text.replace(/\n+$/, '')) : []);

  // New lines in, or a new size: still on the newest lines if it was.
  $effect(() => {
    void runs;
    void fontSize;
    if (!following) return;
    void tick().then(() => {
      if (box && following) box.scrollTop = box.scrollHeight;
    });
  });

  async function send(body: { text: string } | { key: string }) {
    problem = null;
    try {
      await api.typeIntoSession(id, body);
    } catch (error) {
      problem = handleError(error).message;
    }
  }

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    const text = typed;
    if (!text) return send({ key: 'Enter' });
    typed = '';
    await send({ text });
    await send({ key: 'Enter' });
  }
</script>

<section class="live" aria-label="Its terminal, live">
  <div class="view">
    <div class="screen" bind:this={box} onscroll={scrolled}>
      {#if screen}
        <pre style:font-size={`${fontSize}px`}>{#each runs as run, index (index)}<span style={css(run.style)}>{run.text}</span>{/each}</pre>
      {:else if !problem}
        <div class="waiting" aria-hidden="true"></div>
        <span class="visually-hidden" role="status">Reading its screen</span>
      {/if}
    </div>
    <div class="zoom" role="group" aria-label="Zoom">
      <button type="button" aria-label="Zoom out" disabled={zoom <= ZOOM_MIN} onclick={() => setZoom(zoom - ZOOM_STEP)}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"
          ><circle cx="10.5" cy="10.5" r="6.5" /><path d="M15.5 15.5 21 21M7.5 10.5h6" /></svg
        >
      </button>
      <button type="button" aria-label="Zoom in" disabled={zoom >= ZOOM_MAX} onclick={() => setZoom(zoom + ZOOM_STEP)}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"
          ><circle cx="10.5" cy="10.5" r="6.5" /><path d="M15.5 15.5 21 21M7.5 10.5h6M10.5 7.5v6" /></svg
        >
      </button>
    </div>
    {#if !following}
      <button class="newest" type="button" onclick={toNewest}>To the newest</button>
    {/if}
  </div>

  {#if problem}<p class="error-text" role="alert">{problem}</p>{/if}

  <form class="type" onsubmit={submit}>
    <label class="visually-hidden" for={`type-${id}`}>Type into it</label>
    <input
      id={`type-${id}`}
      bind:value={typed}
      placeholder="Type to Claude…"
      autocomplete="off"
      autocapitalize="off"
      spellcheck="false"
    />
    <button class="btn btn--primary" type="submit">Send</button>
  </form>
  <div class="keys" role="group" aria-label="Keys">
    {#each KEYS as key (key.key)}
      <button type="button" aria-label={key.key === 'C-c' ? 'Control C' : key.key} onclick={() => send({ key: key.key })}>
        {key.label}
      </button>
    {/each}
    {#each ['1', '2', '3'] as digit (digit)}
      <button type="button" aria-label={`Choose ${digit}`} onclick={() => send({ text: digit })}>{digit}</button>
    {/each}
  </div>
  {#if onopen}
    <button class="btn btn--wide" type="button" onclick={onopen}>Open its terminal, full screen</button>
  {/if}
</section>

<style>
  .live {
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
  }
  .view {
    position: relative;
  }
  .screen {
    max-height: min(62vh, 560px);
    overflow: auto;
    overscroll-behavior: contain;
    padding: var(--s-2);
    border-radius: var(--r-lg);
    background: var(--c-terminal);
    box-shadow: 0 0 0 1px var(--c-line);
  }
  pre {
    margin: 0;
    color: var(--c-terminal-text);
    font-family: var(--font-terminal);
    line-height: 1.25;
    white-space: pre;
    -webkit-user-select: text;
    user-select: text;
  }
  .waiting {
    height: 160px;
  }
  .zoom {
    position: absolute;
    top: var(--s-2);
    right: var(--s-2);
    display: flex;
    gap: 4px;
  }
  .zoom button,
  .newest {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 36px;
    height: 36px;
    border: 0;
    border-radius: var(--r-md);
    background: var(--c-surface-2);
    color: var(--c-text);
    box-shadow: 0 0 0 1px var(--c-line);
    cursor: pointer;
    transition-property: background-color;
    transition-duration: var(--t-hover);
  }
  .zoom button:hover,
  .newest:hover {
    background: var(--c-surface-3);
  }
  .zoom button:disabled {
    background: var(--c-disabled-bg);
    color: var(--c-disabled-text);
    cursor: default;
  }
  .newest {
    position: absolute;
    right: var(--s-2);
    bottom: var(--s-2);
    padding: 0 var(--s-3);
    background: var(--c-accent);
    color: var(--c-on-accent);
    font-weight: 600;
  }
  .newest:hover {
    background: var(--c-accent-hover);
  }
  .type {
    display: flex;
    gap: var(--s-2);
  }
  .type input {
    flex: 1;
    min-width: 0;
    height: var(--tap);
    padding: 0 var(--s-3);
    border: 1px solid var(--c-surface-3);
    border-radius: var(--r-lg);
    background: var(--c-bg);
    font: var(--fs-lg) var(--font-mono);
    -webkit-user-select: text;
    user-select: text;
  }
  .type input:focus-visible {
    outline-offset: 0;
    border-color: var(--c-accent);
  }
  .keys {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .keys button {
    min-width: 44px;
    height: 36px;
    padding: 0 var(--s-2);
    border: 0;
    border-radius: var(--r-md);
    background: var(--c-surface-2);
    color: var(--c-text);
    font: 600 var(--fs-md) var(--font-mono);
    cursor: pointer;
  }
  .keys button:active {
    background: var(--c-surface-hover);
  }
  .error-text {
    margin: 0;
  }
</style>
