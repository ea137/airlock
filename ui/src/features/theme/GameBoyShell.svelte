<!-- The Game Boy theme's case: the screens sit in its screen, and its
     buttons work. Up and down move through what's on screen, A opens it,
     B goes back; left and right switch sections; Select opens Files and
     Start a new terminal. Tapping the screen works as ever. While the
     secret game is open it plays in the case's screen, and the buttons are
     its buttons, held down as long as they're pressed. -->
<script lang="ts">
  import type { Snippet } from 'svelte';

  import { go, router } from '../../lib/router.svelte';
  import { SECTIONS, sectionOf, sectionRoute } from '../../lib/routes';
  import { caseButtons, gameDoor } from '../game/door.svelte';
  import GameHost from '../game/GameHost.svelte';
  import { newTerminal } from '../terminals/terminals.svelte';

  let { children }: { children: Snippet } = $props();

  /** What the D-pad moves between. */
  const TARGETS = 'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';
  const SELECTED = 'data-selected';

  let screen: HTMLElement | undefined = $state();
  let selected: HTMLElement | null = null;

  // A new screen starts with nothing picked.
  $effect(() => {
    void router.route;
    selected = null;
  });

  /** A sheet or dialog open on screen takes the buttons while it's up. */
  function openModal(): HTMLElement | null {
    return screen?.querySelector<HTMLElement>('dialog[open], [aria-modal="true"]') ?? null;
  }

  function targets(): HTMLElement[] {
    const scope = openModal() ?? screen;
    if (!scope) return [];
    return [...scope.querySelectorAll<HTMLElement>(TARGETS)].filter(
      (target) => target.tabIndex >= 0 && target.getClientRects().length > 0 && !target.closest('[aria-hidden="true"]'),
    );
  }

  function pick(target: HTMLElement | null) {
    selected?.removeAttribute(SELECTED);
    selected = target;
    if (!target) return;
    target.setAttribute(SELECTED, '');
    target.focus({ preventScroll: true });
    target.scrollIntoView({ block: 'nearest' });
  }

  function move(step: 1 | -1) {
    const list = targets();
    if (list.length === 0) return;
    const at = selected ? list.indexOf(selected) : -1;
    const next = at === -1 ? (step === 1 ? 0 : list.length - 1) : Math.min(list.length - 1, Math.max(0, at + step));
    pick(list[next] ?? null);
  }

  function a() {
    if (selected?.isConnected) selected.click();
    else move(1);
  }

  function b() {
    const modal = openModal();
    if (modal instanceof HTMLDialogElement) {
      modal.close();
    } else if (modal) {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    } else {
      const back = screen?.querySelector<HTMLElement>('[data-back]');
      if (back) back.click();
      else if (router.route.name !== 'home') go({ name: 'home' });
    }
  }

  function section(step: 1 | -1) {
    const here = sectionOf(router.route);
    const at = here ? SECTIONS.indexOf(here) : 0;
    const next = SECTIONS[(at + step + SECTIONS.length) % SECTIONS.length];
    if (next) go(sectionRoute(next));
  }

  function start() {
    newTerminal.asked = true;
    go({ name: 'terminals' });
  }

  /** The case's buttons don't take focus from what's picked on screen. */
  function keepFocus(event: PointerEvent) {
    event.preventDefault();
  }

  /** A button's own job, unless the game is open and has it. */
  function unlessPlaying(job: () => void) {
    return () => {
      if (!gameDoor.open) job();
    };
  }
</script>

<div class="shell">
  <div class="power" aria-hidden="true">
    <span class="groove"></span>
    <span>◀ OFF · ON ▶</span>
    <span class="groove"></span>
  </div>

  <div class="bezel">
    <div class="bezel__head" aria-hidden="true">
      <span class="led"></span>
      <span class="stripes"></span>
      <span class="label">DOT MATRIX TERMINAL</span>
      <span class="stripes stripes--short"></span>
    </div>
    <div class="lcd" bind:this={screen}>
      {@render children()}
      <GameHost inCase />
    </div>
  </div>

  <p class="brand" aria-hidden="true">POCKET <span class="brand__big">TERMINAL</span></p>

  <div class="controls" role="group" aria-label="Game Boy buttons" use:caseButtons>
    <div class="pad">
      <span class="pad__bar pad__bar--v" aria-hidden="true"></span>
      <span class="pad__bar pad__bar--h" aria-hidden="true"></span>
      <button
        class="pad__key pad__key--up"
        type="button"
        aria-label="Up"
        data-pad="up"
        onpointerdown={keepFocus}
        onclick={unlessPlaying(() => move(-1))}>▲</button
      >
      <button
        class="pad__key pad__key--down"
        type="button"
        aria-label="Down"
        data-pad="down"
        onpointerdown={keepFocus}
        onclick={unlessPlaying(() => move(1))}>▼</button
      >
      <button
        class="pad__key pad__key--left"
        type="button"
        aria-label="Left, previous section"
        data-pad="left"
        onpointerdown={keepFocus}
        onclick={unlessPlaying(() => section(-1))}>◀</button
      >
      <button
        class="pad__key pad__key--right"
        type="button"
        aria-label="Right, next section"
        data-pad="right"
        onpointerdown={keepFocus}
        onclick={unlessPlaying(() => section(1))}>▶</button
      >
    </div>

    <div class="ab">
      <span class="round round--b">
        <button type="button" aria-label="B, back" data-pad="b" onpointerdown={keepFocus} onclick={unlessPlaying(b)}></button>
        <span aria-hidden="true">B</span>
      </span>
      <span class="round round--a">
        <button type="button" aria-label="A, open" data-pad="a" onpointerdown={keepFocus} onclick={unlessPlaying(a)}></button>
        <span aria-hidden="true">A</span>
      </span>
    </div>
  </div>

  <div class="pills" use:caseButtons>
    <span class="pill">
      <button
        type="button"
        aria-label="Select, files"
        data-pad="select"
        onpointerdown={keepFocus}
        onclick={unlessPlaying(() => go({ name: 'files', path: '~' }))}
      ></button>
      <span aria-hidden="true">SELECT</span>
    </span>
    <span class="pill">
      <button type="button" aria-label="Start, new terminal" data-pad="start" onpointerdown={keepFocus} onclick={unlessPlaying(start)}
      ></button>
      <span aria-hidden="true">START</span>
    </span>
  </div>

  <div class="grille" aria-hidden="true">
    {#each [0, 1, 2, 3, 4] as slot (slot)}<span></span>{/each}
  </div>
</div>

<style>
  .shell {
    position: relative;
    height: 100%;
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
    padding: calc(var(--s-2) + var(--safe-top)) var(--s-3) calc(var(--s-3) + var(--safe-bottom));
    overflow: hidden;
    background: var(--c-shell);
    color: var(--c-shell-print);
  }
  .power {
    display: flex;
    align-items: center;
    padding: 0 var(--s-1);
    color: var(--c-shell-label);
    font-size: 7px;
  }
  .power > span:nth-child(2) {
    padding: 0 var(--s-2);
  }
  .groove {
    flex: 1;
    height: 2px;
    background: var(--c-shell-groove);
  }
  .bezel {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
    padding: var(--s-2) 10px var(--s-4);
    border-radius: 10px 10px 36px 10px;
    background: var(--c-shell-bezel);
  }
  .bezel__head {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--c-shell-bezel-print);
    font-size: 6px;
  }
  .led {
    flex: 0 0 auto;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--c-shell-led);
    box-shadow: 0 0 6px var(--c-shell-led);
  }
  .stripes {
    flex: 1;
    height: 6px;
    background: linear-gradient(
      var(--c-shell-berry) 0 2px,
      transparent 2px 4px,
      var(--c-shell-print) 4px 6px
    );
  }
  .stripes--short {
    flex: 0 0 26px;
  }
  .label {
    white-space: nowrap;
  }
  /* The screen: the screens inside keep clear of nothing, the case does
     that; sheets open inside it. */
  .lcd {
    --safe-top: 0px;
    --safe-bottom: 0px;
    flex: 1;
    min-height: 0;
    overflow: hidden;
    contain: layout paint;
    background: var(--c-bg);
    color: var(--c-text);
    box-shadow: inset 0 0 0 2px rgb(15 56 15 / 0.35);
  }
  .lcd :global([data-selected]) {
    outline: 3px solid var(--c-text);
    outline-offset: 2px;
  }
  .brand {
    margin: 0 0 0 var(--s-1);
    font: italic 700 var(--fs-xl) / 1 var(--font-shell);
    letter-spacing: -0.5px;
  }
  .brand__big {
    font-size: var(--fs-3xl);
  }
  .controls {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0 var(--s-1);
  }
  .pad {
    position: relative;
    width: 104px;
    height: 104px;
  }
  .pad__bar {
    position: absolute;
    border-radius: 4px;
    background: var(--c-shell-pad);
    box-shadow: 0 3px 0 var(--c-shell-pad-shade);
  }
  .pad__bar--v {
    left: 35px;
    top: 0;
    width: 34px;
    height: 104px;
  }
  .pad__bar--h {
    left: 0;
    top: 35px;
    width: 104px;
    height: 34px;
  }
  .pad__key {
    position: absolute;
    width: 36px;
    height: 36px;
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--c-shell-pad-print);
    font-size: var(--fs-sm);
    cursor: pointer;
  }
  .pad__key:active {
    color: var(--c-shell);
  }
  .pad__key--up {
    left: 34px;
    top: 0;
  }
  .pad__key--down {
    left: 34px;
    bottom: 0;
  }
  .pad__key--left {
    left: 0;
    top: 34px;
  }
  .pad__key--right {
    right: 0;
    top: 34px;
  }
  .ab {
    position: relative;
    width: 136px;
    height: 104px;
    transform: rotate(-25deg);
  }
  .round {
    position: absolute;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    font-size: var(--fs-sm);
  }
  .round--b {
    left: 0;
    top: 36px;
  }
  .round--a {
    right: 0;
    top: 6px;
  }
  .round button {
    width: 52px;
    height: 52px;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: var(--c-shell-berry);
    box-shadow: 0 4px 0 var(--c-shell-berry-shade);
    cursor: pointer;
    transition-property: transform, box-shadow;
    transition-duration: var(--t-hover);
  }
  .round button:active,
  .pill button:active {
    transform: translateY(3px);
    box-shadow: 0 1px 0 var(--c-shell-berry-shade);
  }
  .pills {
    display: flex;
    justify-content: center;
    gap: var(--s-6);
    padding-bottom: var(--s-2);
  }
  .pill {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    font-size: 7px;
    transform: rotate(-25deg);
  }
  .pill button {
    width: 52px;
    height: 16px;
    padding: 0;
    border: 0;
    border-radius: 8px;
    background: var(--c-shell-pill);
    box-shadow: 0 2px 0 var(--c-shell-pill-shade);
    cursor: pointer;
  }
  /* A real target under the small pills. */
  .pill button,
  .round button {
    position: relative;
  }
  .pill button::after {
    content: '';
    position: absolute;
    inset: -14px -4px;
  }
  .round button:focus-visible,
  .pill button:focus-visible,
  .pad__key:focus-visible {
    outline: 2px solid var(--c-shell-print);
    outline-offset: 3px;
  }
  .grille {
    position: absolute;
    right: 18px;
    bottom: calc(var(--s-4) + var(--safe-bottom));
    display: flex;
    gap: 7px;
    transform: rotate(-25deg);
  }
  .grille span {
    width: 5px;
    height: 44px;
    border-radius: 3px;
    background: var(--c-shell-grille);
    box-shadow: inset 1px 1px 2px rgb(0 0 0 / 0.35);
  }
</style>
