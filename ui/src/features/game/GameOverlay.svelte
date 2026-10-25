<script lang="ts">
  import { onMount, tick } from 'svelte';

  import { look, motionAllowed } from '../../lib/theme.svelte';
  import Controls from './Controls.svelte';
  import { casePad, releaseCase } from './door.svelte';
  import { Game, TITLE } from './engine';
  import type { Buttons } from './input';
  import type { Screen } from './render';
  import { readSkin } from './skin';

  let { inCase, onclose }: { inCase: boolean; onclose: () => void } = $props();

  let canvas: HTMLCanvasElement | undefined = $state();
  let stage: HTMLElement | undefined = $state();
  let menu: HTMLElement | undefined = $state();
  let game: Game | null = $state(null);
  let screen = $state<Screen>('title');
  let muted = $state(false);
  let wide = $state(false);
  let confirmNew = $state(false);
  let status = $state('');
  let size = $state({ width: 160, height: 144 });

  function describe(g: Game): string {
    const play = g.play;
    if (g.screen === 'title') return `${TITLE}. Press start to play, or B for the world map.`;
    if (g.screen === 'over') return `Game over at hop ${play.hopNumber()}.`;
    if (g.screen === 'map') return g.mapStatus();
    const where = `Zone ${play.zone}, ${play.level.zone.name}, hop ${play.hop}. ${play.lives} lives, score ${play.score}.`;
    return g.screen === 'paused' ? `Paused. ${where}` : where;
  }

  /** Fits the game in whole multiples of its pixels, wider when the screen is. */
  function fit() {
    const g = game;
    if (!g || !stage) return;
    const rect = stage.getBoundingClientRect();
    if (rect.width < 10 || rect.height < 10) return;
    const ratio = window.devicePixelRatio || 1;
    const h = 144;
    const w = inCase ? 160 : Math.max(160, Math.min(256, Math.floor((h * rect.width) / rect.height / 8) * 8));
    const scale = Math.max(1, Math.floor(Math.min((rect.width * ratio) / w, (rect.height * ratio) / h)));
    size = { width: (w * scale) / ratio, height: (h * scale) / ratio };
    wide = !inCase && rect.width > rect.height * 1.25;
    g.resize(w, h);
  }

  async function focusMenu() {
    await tick();
    menu?.querySelector<HTMLElement>('button')?.focus();
  }

  function menuButton(button: keyof Buttons) {
    const items = [...(menu?.querySelectorAll<HTMLElement>('button') ?? [])];
    if (items.length === 0) return;
    const at = items.indexOf(document.activeElement as HTMLElement);
    if (button === 'up' || button === 'down') {
      const next = at < 0 ? 0 : (at + (button === 'down' ? 1 : items.length - 1)) % items.length;
      items[next]?.focus();
    } else if (button === 'a' || button === 'start') {
      (items[at] ?? items[0])?.click();
    } else if (button === 'b') {
      game?.resume();
    }
  }

  function pulse(name: keyof Buttons) {
    const g = game;
    if (!g) return;
    g.unlockSound();
    g.touch[name] = true;
    window.setTimeout(() => {
      if (game) game.touch[name] = false;
    }, 80);
  }

  function newGame() {
    if (!confirmNew) {
      confirmNew = true;
      return;
    }
    confirmNew = false;
    game?.unlockSound();
    game?.newGame();
  }

  function toggleSound() {
    game?.unlockSound();
    game?.toggleMute();
    muted = game?.muted ?? false;
  }

  onMount(() => {
    if (!canvas || !stage) return;
    const g = new Game(canvas, inCase ? casePad : undefined);
    game = g;
    const keys = g.keyboard;
    // The keys and the case's buttons let go of everything when a release
    // could go missing: the page lost focus or was hidden, or the game
    // paused. (The on-screen buttons do the same by themselves.)
    const letGo = () => {
      keys.letGo();
      if (inCase) releaseCase();
    };
    muted = g.muted;
    screen = g.screen;
    status = describe(g);
    g.onScreen = (next) => {
      screen = next;
      confirmNew = false;
      status = describe(g);
      if (next === 'paused') {
        letGo();
        void focusMenu();
      }
    };
    g.onMenu = menuButton;
    g.onClose = onclose;
    g.setSkin(readSkin(), motionAllowed());
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(stage);

    const keydown = (event: KeyboardEvent) => {
      g.unlockSound();
      if (event.key === 'Escape') {
        event.preventDefault();
        onclose();
        return;
      }
      if (event.key === 'm' || event.key === 'M') {
        toggleSound();
        return;
      }
      // The pause menu's buttons take the keys while it's up.
      if (g.screen === 'paused') return;
      if (keys.down(event)) event.preventDefault();
    };
    const keyup = (event: KeyboardEvent) => keys.up(event);
    // The sound may only start from a touch or a key; any one will do.
    const gesture = () => g.unlockSound();
    const visibility = () => {
      if (document.hidden) {
        letGo();
        g.pause();
        g.stop();
      } else {
        g.start();
      }
    };
    const leave = () => g.save();
    const tap = (event: PointerEvent) => {
      if (event.target === canvas) g.tapAt(event.clientX, event.clientY);
    };
    stage.addEventListener('pointerdown', tap);
    window.addEventListener('keydown', keydown);
    window.addEventListener('keyup', keyup);
    window.addEventListener('blur', letGo);
    document.addEventListener('pointerup', gesture, true);
    document.addEventListener('touchend', gesture, true);
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('pagehide', leave);
    g.start();
    void focusMenu();

    const shown = stage;
    return () => {
      observer.disconnect();
      shown.removeEventListener('pointerdown', tap);
      window.removeEventListener('keydown', keydown);
      window.removeEventListener('keyup', keyup);
      window.removeEventListener('blur', letGo);
      document.removeEventListener('pointerup', gesture, true);
      document.removeEventListener('touchend', gesture, true);
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('pagehide', leave);
      // Gone without closing (Face ID locked): the case keeps nothing down for next time.
      letGo();
      g.pause();
      g.close();
      game = null;
    };
  });

  $effect(() => {
    void look.theme;
    void look.motion;
    game?.setSkin(readSkin(), motionAllowed());
  });

  const startLabel = $derived(screen === 'play' || screen === 'card' ? 'Pause' : screen === 'paused' ? 'Continue' : 'Start');
</script>

<div class="game" class:game--case={inCase} class:game--wide={wide} role="dialog" aria-modal="true" aria-label={`${TITLE}, a secret game`}>
  <div class="bar">
    <button class="tool" type="button" aria-label="Close game" onclick={onclose}>
      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 3l10 10M13 3L3 13"></path></svg>
    </button>
    <span class="name" aria-hidden="true">{TITLE}</span>
    <button class="tool" type="button" aria-label="Sound" aria-pressed={!muted} onclick={toggleSound}>
      <svg width="18" height="16" viewBox="0 0 18 16" aria-hidden="true"
        ><path d="M2 6h3l4-3v10l-4-3H2z"></path>{#if muted}<path d="M12 5l5 6M17 5l-5 6"></path>{:else}<path d="M12 5q2 3 0 6M14 3q4 5 0 10"></path>{/if}</svg
      >
    </button>
    <button
      class="tool tool--start"
      type="button"
      aria-label={startLabel}
      onclick={() => (screen === 'paused' ? game?.resume() : pulse('start'))}>{startLabel}</button
    >
  </div>

  <div class="stage" bind:this={stage}>
    <canvas bind:this={canvas} style:width={`${size.width}px`} style:height={`${size.height}px`} aria-label={`${TITLE} game screen`}></canvas>

    {#if screen === 'paused'}
      <div class="menu" bind:this={menu} role="group" aria-label="Paused">
        <p class="menu__title" aria-hidden="true">PAUSED</p>
        <button class="btn btn--primary" type="button" onclick={() => game?.resume()}>Continue</button>
        <button class="btn" type="button" onclick={() => game?.openMap()}>World map</button>
        <button class="btn" type="button" onclick={newGame}>{confirmNew ? 'Start over? Tap again' : 'New game'}</button>
        <button class="btn" type="button" aria-pressed={!muted} onclick={toggleSound}>Sound {muted ? 'off' : 'on'}</button>
        <button class="btn" type="button" onclick={onclose}>Close game</button>
        <p class="menu__hint">Saved. Closing keeps your place.</p>
      </div>
    {/if}
  </div>

  {#if !inCase && game}
    <Controls buttons={game.touch} {wide} paused={screen === 'paused'} />
  {/if}

  <p class="visually-hidden" aria-live="polite">{status}</p>
</div>

<style>
  .game {
    position: fixed;
    inset: 0;
    z-index: 40;
    display: flex;
    flex-direction: column;
    padding-top: var(--safe-top);
    background: var(--c-bg);
    color: var(--c-text);
    -webkit-touch-callout: none;
    user-select: none;
  }
  .game--case {
    position: absolute;
    padding-top: 0;
  }
  .bar {
    display: flex;
    align-items: center;
    gap: var(--s-1);
    padding: var(--s-1) var(--s-2);
  }
  .game--case .bar {
    padding: 0 2px;
  }
  .name {
    flex: 1;
    overflow: hidden;
    color: var(--c-text-muted);
    font-size: var(--fs-sm);
    letter-spacing: 0.1em;
    text-align: center;
    white-space: nowrap;
  }
  .tool {
    display: flex;
    align-items: center;
    justify-content: center;
    min-width: var(--tap);
    height: var(--tap);
    padding: 0 var(--s-2);
    border: 0;
    border-radius: var(--r-md);
    background: transparent;
    color: var(--c-text);
    font: inherit;
    font-size: var(--fs-sm);
    font-weight: 600;
    cursor: pointer;
    transition-property: background-color;
    transition-duration: var(--t-hover);
  }
  .game--case .tool {
    height: 32px;
    min-width: 32px;
  }
  /* A real target under the case's smaller buttons. */
  .game--case .tool {
    position: relative;
  }
  .game--case .tool::after {
    content: '';
    position: absolute;
    inset: -6px;
  }
  .tool:hover,
  .tool:active {
    background: var(--c-surface-2);
  }
  .tool svg {
    fill: none;
    stroke: currentColor;
    stroke-width: 1.8;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .tool svg path:first-child {
    fill: currentColor;
  }
  .tool:focus-visible {
    outline: 2px solid var(--c-accent-text);
    outline-offset: -2px;
  }
  .stage {
    position: relative;
    flex: 1;
    min-height: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
  }
  canvas {
    display: block;
    image-rendering: pixelated;
    image-rendering: crisp-edges;
    touch-action: none;
  }
  .menu {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--s-2);
    padding: var(--s-4);
  }
  .menu .btn {
    min-width: 200px;
  }
  .menu__title {
    margin: 0 0 var(--s-2);
    font-size: var(--fs-2xl);
    font-weight: 700;
    letter-spacing: 0.2em;
  }
  .menu__hint {
    margin: var(--s-1) 0 0;
    color: var(--c-text-muted);
    font-size: var(--fs-sm);
  }
  .game--case .menu {
    gap: var(--s-1);
  }
  .game--case .menu .btn {
    min-height: 32px;
    min-width: 160px;
  }

  :global([data-theme='workstation']) .game:not(.game--case) .stage {
    margin: var(--s-2);
    border: 1px solid var(--c-ws-dark);
    background: var(--c-ws-desk);
    box-shadow:
      inset 1px 1px var(--c-ws-light),
      inset -1px -1px var(--c-ws-shade);
  }
  :global([data-theme='workstation']) .bar {
    background: var(--c-ws-title);
    color: var(--c-ws-title-text);
  }
  :global([data-theme='workstation']) .name,
  :global([data-theme='workstation']) .tool {
    color: var(--c-ws-title-text);
  }
  :global([data-theme='boot']) .game .stage {
    background: var(--c-boot-border);
  }
</style>
