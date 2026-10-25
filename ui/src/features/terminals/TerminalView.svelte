<!-- A terminal on screen and the key bar under it: one of Airlock's
     terminals or a tab of the laptop's own terminal app, whichever `url`
     streams. Gestures scroll and zoom; Copy, Go to… and the font size are
     on the key bar. It checks its link when the phone comes back. -->
<script lang="ts">
  import { onMount } from 'svelte';

  import CopyView from './CopyView.svelte';
  import { attachGestures, clampFont } from './gestures';
  import GoToSheet from './GoToSheet.svelte';
  import KeyBar from './KeyBar.svelte';
  import {
    applyModifiers,
    arrowSequence,
    DOUBLE_TAP_MS,
    type Key,
    type Modifier,
    type Mods,
    NO_MODS,
    tapModifier,
  } from './keys';
  import type { LinkStatus, StreamUrl, TerminalLink } from './link';

  /** `onbottom`: takes the terminal's program back to its newest lines (tmux's
   * history view); `history`: its text for copying, history included. Without
   * them, the screen's own scrollback is what there is. */
  let {
    url,
    onstatus,
    onbottom,
    history,
  }: {
    url: StreamUrl;
    onstatus: (status: LinkStatus) => void;
    onbottom?: () => Promise<unknown>;
    history?: () => Promise<string>;
  } = $props();

  const FONT_KEY = 'airlock.fontSize';
  const DEFAULT_FONT = 15;
  /** Back from the background after this long, the link gets checked. */
  const PROBE_AFTER_MS = 2000;

  // The font size is this phone's preference; storage can be unavailable
  // (private browsing), and then it isn't remembered.
  function savedFont(): number {
    try {
      const size = Number(localStorage.getItem(FONT_KEY));
      return size ? clampFont(size) : DEFAULT_FONT;
    } catch {
      return DEFAULT_FONT;
    }
  }

  let host: HTMLElement | undefined = $state();
  let link: TerminalLink | null = null;
  let mods = $state<Mods>(NO_MODS);
  let lastTap: { which: Modifier | null; at: number } = { which: null, at: 0 };
  let copyText = $state<string | null>(null);
  let goingTo = $state(false);
  let notice = $state<string | null>(null);
  let keyboardUp = $state(false);
  /** Swiped back into older lines: the way back to the bottom shows. */
  let scrolledBack = $state(false);

  async function toBottom() {
    scrolledBack = false;
    link?.scrollToBottom();
    try {
      await onbottom?.();
    } catch (error) {
      notice = `Couldn't go back to the bottom: ${(error as Error).message}`;
    }
  }

  async function copy() {
    const current = link;
    if (!current) return;
    try {
      copyText = history ? await history() : current.allText();
    } catch {
      copyText = current.allText();
    }
  }

  export function reconnect() {
    link?.reconnect();
  }

  export function focus() {
    link?.term.focus();
  }

  function typed(data: string) {
    // Typing takes tmux out of its history view, as the program comes back.
    scrolledBack = false;
    const result = applyModifiers(data, mods);
    mods = result.mods;
    link?.send(result.data);
  }

  function setFont(size: number) {
    const clamped = clampFont(size);
    link?.setFontSize(clamped);
    try {
      localStorage.setItem(FONT_KEY, String(clamped));
    } catch {
      // Not remembered; the size still applies now.
    }
  }

  onMount(() => {
    const into = host;
    if (!into) return;
    let stop: (() => void) | undefined;
    let gone = false;
    // xterm, the largest part of the app, loads the first time a terminal
    // opens rather than with the app; the phone keeps it from then on.
    import('./link').then(
      ({ TerminalLink }) => {
        if (gone) return;
        const current = new TerminalLink(into, url, {
          fontSize: savedFont(),
          onStatus: onstatus,
          onInput: typed,
          onKeyboard: (up) => (keyboardUp = up),
        });
        stop = start(current, into);
      },
      (error: unknown) => {
        notice = `Couldn't load the terminal: ${(error as Error).message}`;
      },
    );
    return () => {
      gone = true;
      stop?.();
    };
  });

  /** Puts the terminal to work; returns what takes it down. */
  function start(current: TerminalLink, into: HTMLElement): () => void {
    link = current;
    const detachGestures = attachGestures(into, current.term, (data) => current.sendBinary(data), {
      get: () => current.fontSize,
      set: setFont,
    }, (older) => {
      if (older) scrolledBack = true;
    });

    let hiddenAt = 0;
    const onVisibility = () => {
      if (document.hidden) hiddenAt = Date.now();
      else if (hiddenAt && Date.now() - hiddenAt > PROBE_AFTER_MS) current.probe();
    };
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) current.probe();
    };
    const onOnline = () => current.probe();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pageshow', onPageShow);
    window.addEventListener('online', onOnline);
    current.term.focus();

    return () => {
      detachGestures();
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pageshow', onPageShow);
      window.removeEventListener('online', onOnline);
      current.dispose();
      link = null;
    };
  }

  async function paste() {
    try {
      const text = await navigator.clipboard.readText();
      if (text) link?.term.paste(text);
    } catch (error) {
      notice = `Couldn't paste: ${(error as Error).message}`;
    }
  }

  async function onkey(key: Key) {
    const current = link;
    if (!current) return;
    notice = null;
    if ('send' in key) {
      typed(key.send);
    } else if ('modifier' in key) {
      const now = Date.now();
      const double = lastTap.which === key.modifier && now - lastTap.at < DOUBLE_TAP_MS;
      lastTap = { which: key.modifier, at: now };
      mods = tapModifier(mods, key.modifier, double);
    } else if ('arrow' in key) {
      const result = arrowSequence(key.arrow, mods, current.term.modes.applicationCursorKeysMode);
      mods = result.mods;
      current.send(result.data);
    } else if (key.action === 'paste') {
      await paste();
    } else if (key.action === 'copy') {
      await copy();
      return;
    } else if (key.action === 'go-to') {
      goingTo = true;
      return;
    } else {
      const size = current.fontSize;
      setFont(key.action === 'font-larger' ? size + 1 : size - 1);
    }
    current.term.focus();
  }
</script>

{#if notice}
  <p class="error-text notice" role="alert">{notice}</p>
{/if}

<div class="frame">
  <div class="term" bind:this={host}></div>
  {#if scrolledBack}
    <!-- pointerdown's preventDefault keeps the keyboard where it was. -->
    <button
      class="bottom"
      type="button"
      onpointerdown={(event) => event.preventDefault()}
      onmousedown={(event) => event.preventDefault()}
      onclick={toBottom}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
        ><path d="M12 5v14M5 12l7 7 7-7" /></svg
      >
      To the bottom
    </button>
  {/if}
</div>

<KeyBar {mods} {onkey} keyboard={keyboardUp} onkeyboard={() => link?.setKeyboard(!keyboardUp)} />

{#if goingTo}
  <GoToSheet
    ongo={(command) => link?.send(command)}
    onclose={() => {
      goingTo = false;
      link?.term.focus();
    }}
  />
{/if}
{#if copyText !== null}
  <CopyView
    text={copyText}
    onclose={() => {
      copyText = null;
      link?.term.focus();
    }}
  />
{/if}

<style>
  .notice {
    margin: 0;
    padding: var(--s-1) var(--s-3);
    font-size: var(--fs-md);
  }
  .frame {
    position: relative;
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  .term {
    flex: 1;
    min-height: 0;
    padding: var(--s-1);
    background: var(--c-terminal);
  }
  .bottom {
    position: absolute;
    right: var(--s-3);
    bottom: var(--s-3);
    z-index: 5;
    display: inline-flex;
    align-items: center;
    gap: var(--s-1);
    min-height: var(--tap);
    padding: 0 var(--s-3);
    border: 0;
    border-radius: var(--r-pill);
    background: var(--c-accent);
    color: var(--c-on-accent);
    font: 600 var(--fs-md) var(--font-ui);
    box-shadow:
      0 0 0 1px var(--c-line),
      0 6px 16px rgb(0 0 0 / 0.35);
    cursor: pointer;
    transition-property: background-color;
    transition-duration: var(--t-hover);
  }
  .bottom:hover,
  .bottom:active {
    background: var(--c-accent-hover);
  }
</style>
