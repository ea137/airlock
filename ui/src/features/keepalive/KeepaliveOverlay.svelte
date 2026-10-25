<!-- Keepalive, over whatever screen opened it (or inside the Game Boy
     case's screen). The world is drawn on the canvas; what's said is
     written here, in the page, where it can be read at the phone's own
     size: a typewriter a tap finishes, choices as big buttons, and a log to
     read back. It picks up where it was left, saves when closed or hidden,
     and stops completely: no frames, no sound. -->
<script lang="ts">
  import { onMount, tick } from 'svelte';

  import { look, motionAllowed } from '../../lib/theme.svelte';
  import { casePad, releaseCase } from '../game/door.svelte';
  import { readSkin } from '../game/skin';
  import { personOf } from './cast';
  import { emptyView, Game, TITLE, type Menu } from './engine';
  import { KEYS } from './input';
  import Pad from './Pad.svelte';
  import { questList } from './quests';
  import { TRUSTED } from './story';
  import type { Companion } from './world';

  let { inCase, onclose }: { inCase: boolean; onclose: () => void } = $props();

  const view = $state(emptyView());
  let canvas: HTMLCanvasElement | undefined = $state();
  let stage: HTMLElement | undefined = $state();
  let menuEl: HTMLElement | undefined = $state();
  let choicesEl: HTMLElement | undefined = $state();
  let portrait: HTMLCanvasElement | undefined = $state();
  let game: Game | null = $state(null);
  let muted = $state(false);
  let wide = $state(false);
  let confirmNew = $state(false);
  let reading = $state(false);
  let size = $state({ width: 160, height: 144 });

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

  /** The buttons of whatever is up: a menu, or the choices. */
  function buttons(): HTMLElement[] {
    const scope = view.choices.length > 0 && !reading ? choicesEl : menuEl;
    return [...(scope?.querySelectorAll<HTMLElement>('button:not([disabled])') ?? [])];
  }

  function moveFocus(step: number) {
    const list = buttons();
    if (list.length === 0) return;
    const at = list.indexOf(document.activeElement as HTMLElement);
    const next = at < 0 ? (step > 0 ? 0 : list.length - 1) : (at + step + list.length) % list.length;
    list[next]?.focus();
  }

  async function focusFirst() {
    await tick();
    buttons()[0]?.focus();
  }

  /** The case's buttons (and the game's keys) in a menu: move, pick, back. On the map, they move the pick. */
  function menuControl(control: 'up' | 'down' | 'left' | 'right' | 'a' | 'b') {
    if (view.screen === 'menu' && view.menu === 'map' && !reading) {
      if (control === 'a') travelButton?.click();
      else if (control === 'b') back();
      else game?.mapMove(['up', 'right', 'down', 'left'].indexOf(control));
      return;
    }
    if (control === 'up' || control === 'left') moveFocus(-1);
    else if (control === 'down' || control === 'right') moveFocus(1);
    else if (control === 'a') {
      const list = buttons();
      const at = list.indexOf(document.activeElement as HTMLElement);
      (list[at] ?? list[0])?.click();
    } else back();
  }

  function back() {
    if (reading) {
      reading = false;
      return;
    }
    if (view.screen !== 'menu') return;
    if (view.menu === 'pause' || view.menu === 'rest' || (view.menu === 'map' && game?.mapBack === '')) game?.resume();
    else open('pause');
  }

  function open(menu: Menu) {
    if (menu === 'map') game?.openMap();
    else game?.openMenu(menu);
    void focusFirst();
  }

  let travelButton: HTMLButtonElement | undefined = $state();

  function mapTap(event: PointerEvent) {
    const g = game;
    if (!g || !canvas || view.menu !== 'map') return;
    const rect = canvas.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * canvas.width;
    const y = ((event.clientY - rect.top) / rect.height) * canvas.height;
    const hit = g.renderer.mapHit(g.map, x, y);
    if (hit >= 0) g.mapPick(hit);
  }

  const mapOpen = $derived(view.screen === 'menu' && view.menu === 'map' && !reading);

  /** How far the map's card reaches over the canvas, in its pixels: the map keeps above it. Only grows while the map is up, so the map doesn't jump about. */
  function measureMap() {
    const g = game;
    if (!g || !canvas || !menuEl || !mapOpen) return;
    const c = canvas.getBoundingClientRect();
    const card = menuEl.getBoundingClientRect();
    if (c.height < 1) return;
    const over = Math.ceil((Math.max(0, c.bottom - card.top) * g.renderer.h) / c.height);
    if (over > g.renderer.mapReserve) g.renderer.mapReserve = over;
  }

  $effect(() => {
    void view.mapAt;
    void view.version;
    void size.height;
    if (!mapOpen) {
      if (game) game.renderer.mapReserve = 0;
      return;
    }
    void tick().then(measureMap);
  });

  const picked = $derived.by(() => {
    void view.version;
    return game?.map.nodes[view.mapAt] ?? null;
  });
  const pickedCanTravel = $derived.by(() => {
    void view.version;
    return game ? game.canTravel(view.mapAt) : false;
  });

  function newGame() {
    if (view.hasSave && !confirmNew) {
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

  function talkTap() {
    game?.unlockSound();
    game?.advance();
  }

  const party = $derived.by(() => {
    void view.version;
    return game ? [...game.world.story.party] : [];
  });
  const front = $derived(party[0] ? personOf(party[0]).name : '');
  const quests = $derived.by(() => {
    void view.version;
    return game ? questList(game.world.story) : [];
  });
  const logLines = $derived.by(() => {
    void view.version;
    void view.text;
    return game ? game.log.slice(-60) : [];
  });
  const ending = $derived.by(() => game?.library.endings[view.ending]);

  function trustWord(who: Companion): string {
    const trust = game?.world.story.trust[who] ?? 0;
    if (trust >= 8) return 'Would follow you anywhere';
    if (trust >= TRUSTED) return 'Trusts you';
    if (trust >= 3) return 'Warming to you';
    return 'Wary of you';
  }

  onMount(() => {
    if (!canvas || !stage) return;
    const g = new Game(canvas, view);
    game = g;
    if (inCase) {
      g.pad = casePad;
      g.onLetGo = releaseCase;
    }
    muted = g.muted;
    g.onMenu = menuControl;
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
      // On the map, arrows move the pick; Enter or Space travels, X goes back.
      if (view.screen === 'menu' && view.menu === 'map' && !reading) {
        const dir = ['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft'].indexOf(event.key);
        if (dir >= 0) g.mapMove(dir);
        else if (event.key === 'x' || event.key === 'X' || event.key === 'Backspace') back();
        else return;
        event.preventDefault();
        return;
      }
      // Menus and choices are buttons: arrows move between them, Enter or Space picks.
      const native = view.screen === 'menu' || view.screen === 'title' || view.screen === 'end' || reading || view.choices.length > 0;
      if (native) {
        if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') moveFocus(-1);
        else if (event.key === 'ArrowDown' || event.key === 'ArrowRight') moveFocus(1);
        else if (event.key === 'x' || event.key === 'X' || event.key === 'Backspace') back();
        else return;
        event.preventDefault();
        return;
      }
      const control = KEYS[event.code];
      if (!control) return;
      event.preventDefault();
      if (!event.repeat) g.controls.press(`key:${event.code}`, control);
    };
    const keyup = (event: KeyboardEvent) => g.controls.release(`key:${event.code}`);
    // Anything held lets go when the window does: no stuck directions.
    const blur = () => g.release();
    const visibility = () => {
      if (document.hidden) {
        g.release();
        g.pause();
        g.stop();
      } else {
        g.start();
      }
    };
    const leave = () => g.save();
    const gesture = () => g.unlockSound();
    // A tap on the chapter's card skips it.
    const tap = (event: PointerEvent) => {
      if (event.target !== canvas) return;
      if (view.screen === 'menu' && view.menu === 'map') {
        mapTap(event);
      } else if (view.screen === 'card') {
        g.controls.press('tap', 'a');
        g.controls.release('tap');
      } else if (view.screen === 'talk' && !reading) {
        talkTap();
      }
    };
    stage.addEventListener('pointerdown', tap);
    window.addEventListener('keydown', keydown);
    window.addEventListener('keyup', keyup);
    window.addEventListener('blur', blur);
    document.addEventListener('pointerup', gesture, true);
    document.addEventListener('touchend', gesture, true);
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('pagehide', leave);
    g.start();
    void focusFirst();

    const shown = stage;
    return () => {
      observer.disconnect();
      shown.removeEventListener('pointerdown', tap);
      window.removeEventListener('keydown', keydown);
      window.removeEventListener('keyup', keyup);
      window.removeEventListener('blur', blur);
      document.removeEventListener('pointerup', gesture, true);
      document.removeEventListener('touchend', gesture, true);
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('pagehide', leave);
      g.release();
      g.pause();
      g.close();
      game = null;
    };
  });

  // The theme or its motion switch changed: repaint in the new look.
  $effect(() => {
    void look.theme;
    void look.motion;
    game?.setSkin(readSkin(), motionAllowed());
  });

  // A new menu, or new choices: the first button takes focus, for the keys and the case.
  $effect(() => {
    void view.menu;
    void view.screen;
    void view.choices.length;
    if (view.screen === 'menu' || view.screen === 'title' || view.screen === 'end' || view.choices.length > 0) void focusFirst();
  });

  // The speaker's face beside their words.
  $effect(() => {
    const who = view.who;
    const ctx = portrait?.getContext('2d');
    if (!ctx || !portrait || !game) return;
    ctx.clearRect(0, 0, portrait.width, portrait.height);
    if (who) game.renderer.portrait(ctx, personOf(who).art, portrait.width, portrait.height);
  });

  const menuLabel = $derived(view.screen === 'menu' ? 'Continue' : 'Menu');
  const typed = $derived(view.text.slice(0, view.shown));
  const done = $derived(view.shown >= view.text.length);
</script>

<div class="ka" class:ka--case={inCase} class:ka--wide={wide} class:ka--map={mapOpen} role="dialog" aria-modal="true" aria-label={`${TITLE}, a secret game`}>
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
      class="tool tool--menu"
      type="button"
      disabled={view.screen !== 'play' && view.screen !== 'menu'}
      onclick={() => (view.screen === 'menu' ? game?.resume() : open('pause'))}>{menuLabel}</button
    >
  </div>

  <div class="stage" bind:this={stage}>
    <canvas bind:this={canvas} style:width={`${size.width}px`} style:height={`${size.height}px`} aria-label={`${TITLE} game screen`}></canvas>

    {#if view.toast && view.screen === 'play'}
      {#key view.toastId}
        <p class="toast" aria-live="polite">
          {#if view.toastName}<b style:color={view.toastColour || null}>{view.toastName}</b>{/if}
          {view.toast}
        </p>
      {/key}
    {/if}

    {#if view.screen === 'talk' && !reading}
      <div class="talk" role="group" aria-label="Conversation">
        <button class="talk__box" type="button" onclick={talkTap} aria-label={done ? 'Next' : 'Show all'}>
          {#if view.who}
            <canvas class="talk__face" bind:this={portrait} width="32" height="32" aria-hidden="true"></canvas>
          {/if}
          <span class="talk__words">
            {#if view.name}<span class="talk__name" style:color={view.colour || null}>{view.name}</span>{/if}
            <span class="talk__text" class:talk__text--said={!view.who} aria-hidden="true">{typed}</span>
            {#if done && view.choices.length === 0}<span class="talk__more" aria-hidden="true">▼</span>{/if}
          </span>
        </button>
        {#if view.choices.length > 0 && done}
          <div class="choices" bind:this={choicesEl} role="group" aria-label="Your answer">
            {#each view.choices as choice (choice.index)}
              <button class="btn choice" type="button" onclick={() => game?.choose(choice.index)}>{choice.text}</button>
            {/each}
          </div>
        {/if}
        <button class="talk__log" type="button" onclick={() => (reading = true)}>Log</button>
      </div>
      <p class="visually-hidden" aria-live="polite">{view.name ? `${view.name}: ` : ''}{view.text}</p>
    {/if}

    {#if reading}
      <div class="sheet" bind:this={menuEl} role="group" aria-label="Log">
        <h2 class="sheet__title">Log</h2>
        <ol class="log">
          {#each logLines as [who, text], index (index)}
            <li class:log--you={who === '>'}>
              {#if who === '>'}<span class="log__who">You</span>{:else if who}<span class="log__who">{personOf(who).name}</span>{/if}
              {text}
            </li>
          {/each}
        </ol>
        <button class="btn btn--primary" type="button" onclick={() => (reading = false)}>Back</button>
      </div>
    {/if}

    {#if view.screen === 'title'}
      <div class="menu menu--title" bind:this={menuEl} role="group" aria-label={TITLE}>
        {#if view.hasSave || view.loading}
          <button
            class="btn btn--primary"
            type="button"
            disabled={view.loading}
            onclick={() => {
              game?.unlockSound();
              game?.continueGame();
            }}>{view.loading ? 'Loading…' : 'Continue'}</button
          >
        {/if}
        <button class={view.hasSave ? 'btn' : 'btn btn--primary'} type="button" onclick={newGame}
          >{confirmNew ? 'Start over? Tap again' : 'New game'}</button
        >
        <p class="menu__hint">
          {#if inCase}D-pad moves. A talks and uses, B pings, Select swaps who's in front.{:else}Move, A to talk and use, B to ping, and swap who walks in front.{/if}
        </p>
      </div>
    {/if}

    {#if view.screen === 'menu' && view.menu === 'map' && !reading}
      <div class="atlas" bind:this={menuEl} role="group" aria-label="World map">
        {#if picked}
          <p class="atlas__name">{picked.name}{#if picked.here}<span class="atlas__here">{' · you are here'}</span>{/if}</p>
          <p class="atlas__line">
            {#if !picked.visited}Not been there yet.{:else if picked.secrets > 0}Secrets found: {picked.found} of {picked.secrets}{picked.found === picked.secrets ? '. All of them.' : '.'}{:else}Nothing hidden here.{/if}
          </p>
          {#if picked.main}<p class="atlas__line atlas__main">! The story goes on here.</p>{/if}
          {#each picked.side as title (title)}<p class="atlas__line atlas__side">• {title}</p>{/each}
        {/if}
        <div class="atlas__buttons">
          <button class="btn btn--primary" type="button" bind:this={travelButton} disabled={!pickedCanTravel} onclick={() => game?.travel(view.mapAt)}
            >{picked?.here ? "You're here" : picked && !picked.travel && picked.visited ? 'No way in from here' : game?.fighting ? 'Not mid-fight' : 'Travel here'}</button
          >
          <button class="btn" type="button" onclick={back}>Back</button>
        </div>
        <p class="visually-hidden" aria-live="polite">{picked ? `${picked.name}.` : ''}</p>
      </div>
    {/if}

    {#if view.screen === 'menu' && view.menu !== 'map' && !reading}
      <div class="sheet" bind:this={menuEl} role="group" aria-label={view.menu === 'rest' ? 'Beacon' : 'Paused'}>
        {#if view.menu === 'pause'}
          <h2 class="sheet__title">Paused</h2>
          <button class="btn btn--primary" type="button" onclick={() => game?.resume()}>Continue</button>
          <button class="btn" type="button" onclick={() => open('map')}>Map</button>
          <button class="btn" type="button" onclick={() => open('quests')}>Quests</button>
          <button class="btn" type="button" onclick={() => open('party')}>Companions</button>
          <button class="btn" type="button" onclick={() => (reading = true)}>Log</button>
          <button class="btn" type="button" aria-pressed={!muted} onclick={toggleSound}>Sound {muted ? 'off' : 'on'}</button>
          <button class="btn" type="button" onclick={onclose}>Close game</button>
          <p class="menu__hint">Saved. Closing keeps your place.</p>
        {:else if view.menu === 'rest'}
          <h2 class="sheet__title">Beacon</h2>
          <p class="menu__hint">The beacon hums. Rested, and saved.</p>
          {#each party as who (who)}
            <button class="btn" type="button" onclick={() => game?.restTalk(who)}
              >Talk to {personOf(who).name}{#if game?.hasNews(who)}<span class="news" aria-label="something new to say">•</span>{/if}</button
            >
          {/each}
          <button class="btn btn--primary" type="button" onclick={() => game?.resume()}>Go on</button>
        {:else if view.menu === 'quests'}
          <h2 class="sheet__title">Quests</h2>
          <ul class="quests">
            {#each quests as q (q.quest.id)}
              <li class:quests--done={q.done}>
                <span class="quests__title">{q.quest.title}</span>
                <span class="quests__step">{q.quest.side ? `For ${personOf(q.quest.giver).name}. ` : ''}{q.text}</span>
              </li>
            {/each}
          </ul>
          <button class="btn btn--primary" type="button" onclick={() => open('pause')}>Back</button>
        {:else if view.menu === 'party'}
          <h2 class="sheet__title">Companions</h2>
          <ul class="quests">
            {#each party as who (who)}
              <li><span class="quests__title">{personOf(who).name}</span><span class="quests__step">{trustWord(who)}</span></li>
            {:else}
              <li><span class="quests__step">Nobody yet. Just you.</span></li>
            {/each}
          </ul>
          <button class="btn btn--primary" type="button" onclick={() => open('pause')}>Back</button>
        {/if}
      </div>
    {/if}

    {#if view.screen === 'end'}
      <div class="sheet sheet--end" bind:this={menuEl} role="group" aria-label="The end">
        <h2 class="sheet__title">{ending?.title ?? 'The end'}</h2>
        {#each ending?.lines ?? [] as line, index (index)}<p class="end__line">{line}</p>{/each}
        <button class="btn btn--primary" type="button" onclick={() => game?.keepPlaying()}>Keep playing</button>
        <button class="btn" type="button" onclick={() => game?.toTitle()}>Title</button>
      </div>
    {/if}
  </div>

  {#if !inCase && game}
    <Pad controls={game.controls} {wide} {front} />
  {/if}

  <p class="visually-hidden" aria-live="polite">{view.status}</p>
</div>

<style>
  .ka {
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
  /* In the Game Boy case: inside its screen, driven by its buttons. */
  .ka--case {
    position: absolute;
    padding-top: 0;
  }
  .bar {
    display: flex;
    align-items: center;
    gap: var(--s-1);
    padding: var(--s-1) var(--s-2);
  }
  .ka--case .bar {
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
    position: relative;
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
  .tool:disabled {
    color: var(--c-text-faint);
    cursor: default;
  }
  .ka--case .tool {
    height: 32px;
    min-width: 32px;
  }
  /* A real target under the case's smaller buttons. */
  .ka--case .tool::after {
    content: '';
    position: absolute;
    inset: -6px;
  }
  .tool:hover:not(:disabled),
  .tool:active:not(:disabled) {
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
  /* The map's card goes below it: the map takes the top of the space, leaving the most room under it. */
  .ka--map:not(.ka--case) .stage {
    align-items: flex-start;
  }
  canvas {
    display: block;
    image-rendering: pixelated;
    image-rendering: crisp-edges;
    touch-action: none;
  }

  /* A companion's remark, over the top of the play. */
  .toast {
    position: absolute;
    top: var(--s-2);
    left: 50%;
    width: min(92%, 420px);
    margin: 0;
    padding: var(--s-2) var(--s-3);
    transform: translateX(-50%);
    border-radius: var(--r-lg);
    background: var(--c-surface);
    box-shadow: var(--shadow-dialog);
    font-size: var(--fs-md);
    line-height: 1.35;
    pointer-events: none;
  }
  .toast b {
    margin-right: var(--s-1);
  }
  .ka--case .toast {
    top: 26px;
    padding: var(--s-1) var(--s-2);
    font-size: var(--fs-sm);
  }

  /* The conversation: the words at the bottom, the choices above them. */
  .talk {
    position: absolute;
    left: var(--s-2);
    right: var(--s-2);
    bottom: var(--s-2);
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
    max-width: 560px;
    margin: 0 auto;
  }
  .talk__box {
    display: flex;
    align-items: flex-start;
    gap: var(--s-3);
    min-height: 92px;
    padding: var(--s-3);
    border: 0;
    border-radius: var(--r-xl);
    background: var(--c-surface);
    box-shadow: var(--shadow-dialog);
    color: var(--c-text);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .ka--case .talk__box {
    min-height: 64px;
    padding: var(--s-2);
    gap: var(--s-2);
  }
  .talk__face {
    flex: 0 0 auto;
    width: 48px;
    height: 48px;
    border-radius: var(--r-md);
    background: var(--c-surface-2);
  }
  .ka--case .talk__face {
    width: 32px;
    height: 32px;
  }
  .talk__words {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .talk__name {
    font-size: var(--fs-sm);
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }
  .talk__text {
    font-size: var(--fs-lg);
    line-height: 1.4;
    white-space: pre-wrap;
  }
  .ka--case .talk__text {
    font-size: var(--fs-sm);
  }
  .talk__text--said {
    color: var(--c-text-soft);
    font-style: italic;
  }
  .talk__more {
    align-self: flex-end;
    color: var(--c-text-muted);
    font-size: var(--fs-xs);
  }
  .talk__log {
    position: absolute;
    right: var(--s-2);
    bottom: calc(100% + var(--s-2));
    min-height: 32px;
    padding: 0 var(--s-3);
    border: 0;
    border-radius: var(--r-pill);
    background: var(--c-surface-2);
    color: var(--c-text-muted);
    font: inherit;
    font-size: var(--fs-sm);
    cursor: pointer;
  }
  .choices ~ .talk__log {
    display: none;
  }
  .choices {
    order: -1;
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
  }
  .choice {
    justify-content: flex-start;
    min-height: 48px;
    padding: var(--s-2) var(--s-4);
    box-shadow: var(--shadow-dialog);
    text-align: left;
    white-space: normal;
  }
  .ka--case .choice {
    min-height: 34px;
    padding: var(--s-1) var(--s-3);
    font-size: var(--fs-sm);
  }
  .choice:focus-visible,
  .ka--case .btn:focus {
    outline: 2px solid var(--c-accent-text);
    outline-offset: 2px;
  }

  .menu {
    position: absolute;
    inset: auto 0 var(--s-4) 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--s-2);
    padding: var(--s-4);
  }
  .menu .btn,
  .sheet .btn {
    min-width: 220px;
  }
  .menu__hint {
    max-width: 300px;
    margin: var(--s-1) 0 0;
    color: var(--c-text-muted);
    font-size: var(--fs-sm);
    text-align: center;
  }
  /* In the case the hint sits over the picture: on its own backing, so it reads. */
  .ka--case .menu--title .menu__hint {
    margin: 0;
    padding: 2px var(--s-2);
    border-radius: var(--r-md);
    background: var(--c-surface);
    color: var(--c-text);
    font-size: var(--fs-xs);
  }
  .ka--case .menu--title {
    bottom: var(--s-1);
    padding: var(--s-2);
  }
  .sheet {
    position: absolute;
    inset: var(--s-2);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--s-2);
    padding: var(--s-4);
    overflow-y: auto;
    border-radius: var(--r-xl);
    background: var(--c-surface);
    box-shadow: var(--shadow-dialog);
  }
  .ka--case .sheet {
    inset: 0;
    gap: var(--s-1);
    padding: var(--s-2);
  }
  .ka--case .sheet .btn,
  .ka--case .menu .btn {
    min-height: 32px;
    min-width: 170px;
    font-size: var(--fs-sm);
  }
  .sheet__title {
    margin: 0 0 var(--s-1);
    font-size: var(--fs-2xl);
    letter-spacing: 0.08em;
  }
  .news {
    margin-left: var(--s-2);
    color: var(--c-accent-text);
  }
  .log,
  .quests {
    align-self: stretch;
    flex: 1;
    margin: 0;
    padding: 0;
    overflow-y: auto;
    list-style: none;
    font-size: var(--fs-md);
    line-height: 1.4;
  }
  .log li,
  .quests li {
    padding: var(--s-1) 0;
    border-bottom: 1px solid var(--c-line);
  }
  .log__who,
  .quests__title {
    display: block;
    color: var(--c-text-muted);
    font-size: var(--fs-xs);
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }
  .log--you {
    color: var(--c-accent-text);
  }
  .quests__step {
    display: block;
  }
  .quests--done {
    color: var(--c-text-muted);
  }
  /* The world map's card: the place picked, and the way there. */
  .atlas {
    position: absolute;
    left: var(--s-2);
    right: var(--s-2);
    bottom: var(--s-2);
    display: flex;
    flex-direction: column;
    gap: 2px;
    max-width: 560px;
    margin: 0 auto;
    padding: var(--s-3);
    border-radius: var(--r-xl);
    background: var(--c-surface);
    box-shadow: var(--shadow-dialog);
  }
  .ka--case .atlas {
    left: 0;
    right: 0;
    bottom: 0;
    padding: var(--s-1) var(--s-2);
  }
  .atlas__name {
    margin: 0;
    font-size: var(--fs-lg);
    font-weight: 700;
  }
  .atlas__here {
    color: var(--c-text-muted);
    font-weight: 400;
  }
  .atlas__line {
    margin: 0;
    color: var(--c-text-soft);
    font-size: var(--fs-md);
  }
  .ka--case .atlas__name,
  .ka--case .atlas__line {
    font-size: var(--fs-xs);
  }
  .atlas__main {
    color: var(--c-warn);
  }
  .atlas__side {
    color: var(--c-accent-text);
  }
  .atlas__buttons {
    display: flex;
    gap: var(--s-2);
    margin-top: var(--s-2);
  }
  .atlas__buttons .btn {
    flex: 1;
  }
  .ka--case .atlas__buttons .btn {
    min-height: 30px;
    font-size: var(--fs-xs);
  }
  .end__line {
    max-width: 420px;
    margin: 0;
    font-size: var(--fs-md);
    line-height: 1.5;
    text-align: center;
  }

  /* Each theme's frame round the game. */
  :global([data-theme='workstation']) .ka:not(.ka--case) .stage {
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
  :global([data-theme='boot']) .ka .stage {
    background: var(--c-boot-border);
  }
</style>
