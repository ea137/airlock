<!-- One terminal: its tabs, its screen and the key bar. Swipe the header
     sideways to move to the next or previous terminal; hold it to open the
     secret game. -->
<script lang="ts">
  import { api, attachUrl, type Tab } from '../../lib/api';
  import { go, hrefFor } from '../../lib/router.svelte';
  import { handleError } from '../../lib/session.svelte';
  import { secretDoor } from '../game/door.svelte';
  import type { LinkStatus } from './link';
  import TabSheet from './TabSheet.svelte';
  import TabStrip from './TabStrip.svelte';
  import TerminalMenu from './TerminalMenu.svelte';
  import { terminalList } from './terminals.svelte';
  import TerminalView from './TerminalView.svelte';

  let { id }: { id: number } = $props();

  /** A sideways swipe this far on the header switches terminals. */
  const SWIPE_PX = 70;

  let view: TerminalView | undefined = $state();
  let status = $state<LinkStatus>('connecting');
  let holding = $state<Tab | null>(null);
  let menuOpen = $state(false);
  let notice = $state<string | null>(null);

  $effect(() => terminalList.watch());

  const terminals = $derived(terminalList.data);
  const terminal = $derived(terminals?.find((t) => t.id === id));
  const position = $derived(terminals?.findIndex((t) => t.id === id) ?? -1);

  // Closed here or elsewhere: back to the list.
  $effect(() => {
    if (terminals && !terminal) go({ name: 'terminals' });
  });

  async function act(work: () => Promise<unknown>) {
    notice = null;
    try {
      await work();
      await terminalList.refresh();
    } catch (error) {
      notice = handleError(error).message;
    }
    view?.focus();
  }

  /** Sideways swipes on `node` move to the next or previous terminal. */
  function swipeBetweenTerminals(node: HTMLElement) {
    let from: { x: number; y: number } | null = null;
    const start = (event: TouchEvent) => {
      const touch = event.touches[0];
      from = touch ? { x: touch.clientX, y: touch.clientY } : null;
    };
    const end = (event: TouchEvent) => {
      const touch = event.changedTouches[0];
      const origin = from;
      from = null;
      if (!origin || !touch || !terminals) return;
      const dx = touch.clientX - origin.x;
      if (Math.abs(dx) < SWIPE_PX || Math.abs(touch.clientY - origin.y) > SWIPE_PX / 2) return;
      const next = terminals[position + (dx < 0 ? 1 : -1)];
      if (next) go({ name: 'terminal', id: next.id });
    };
    node.addEventListener('touchstart', start, { passive: true });
    node.addEventListener('touchend', end, { passive: true });
    return {
      destroy() {
        node.removeEventListener('touchstart', start);
        node.removeEventListener('touchend', end);
      },
    };
  }
</script>

<main class="screen">
  <header class="head" use:swipeBetweenTerminals use:secretDoor>
    <a class="btn btn--quiet back" href={hrefFor({ name: 'terminals' })}>
      <span aria-hidden="true">‹</span> Terminals
    </a>
    <div class="title">
      <h1>{terminal?.name ?? ''}</h1>
      {#if terminals && terminals.length > 1}
        <span class="dots" role="img" aria-label={`Terminal ${position + 1} of ${terminals.length}`}>
          {#each terminals as other (other.id)}
            <span class="dot" class:dot--on={other.id === id}></span>
          {/each}
        </span>
      {/if}
    </div>
    <button class="btn btn--quiet more" type="button" aria-label="Terminal options" onclick={() => (menuOpen = true)}>
      ⋯
    </button>
  </header>

  <TabStrip
    tabs={terminal?.tabs ?? []}
    {status}
    onselect={(tab) => act(() => api.selectTab(tab.id))}
    onnew={() => act(() => api.newTab(id))}
    onhold={(tab) => (holding = tab)}
    onreconnect={() => view?.reconnect()}
  />

  {#if status === 'lost'}
    <p class="banner" role="status">The link dropped. Reconnecting…</p>
  {/if}
  {#if notice}
    <p class="error-text notice" role="alert">{notice}</p>
  {/if}

  <TerminalView
    bind:this={view}
    url={(cols, rows) => attachUrl(id, cols, rows)}
    onbottom={() => api.terminalToBottom(id)}
    history={async () => (await api.terminalText(id)).text}
    onstatus={(next) => {
      status = next;
      if (next === 'ended') go({ name: 'terminals' });
    }}
  />

  {#if holding}
    <TabSheet tab={holding} ondone={() => terminalList.refresh()} onclose={() => (holding = null)} />
  {/if}
  {#if menuOpen && terminal}
    <TerminalMenu {terminal} onclose={() => (menuOpen = false)} />
  {/if}
</main>

<style>
  .screen {
    height: 100%;
    display: flex;
    flex-direction: column;
    padding-top: var(--safe-top);
  }
  /* Back and the menu keep their full size; the name takes what's left and
     ends in an ellipsis rather than running into them. */
  .head {
    display: grid;
    grid-template-columns: minmax(max-content, 1fr) minmax(0, max-content) minmax(max-content, 1fr);
    align-items: center;
    gap: var(--s-1);
    padding: var(--s-1) var(--s-1) 0;
  }
  .back {
    justify-self: start;
    padding: 0 var(--s-2);
  }
  .more {
    justify-self: end;
    width: var(--tap);
    padding: 0;
    font-size: var(--fs-xl);
  }
  .title {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--s-1);
    min-width: 0;
  }
  h1 {
    max-width: 100%;
    margin: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--fs-xl);
    font-weight: 600;
  }
  .dots {
    display: flex;
    gap: var(--s-1);
  }
  .dot {
    width: 6px;
    height: 6px;
    border-radius: var(--r-pill);
    background: var(--c-surface-hover);
  }
  .dot--on {
    background: var(--c-text);
  }
  .banner,
  .notice {
    margin: 0;
    padding: var(--s-1) var(--s-3);
    font-size: var(--fs-md);
  }
  .banner {
    background: var(--c-warn-soft);
    color: var(--c-warn);
  }
</style>
