<!-- The on-screen buttons, for every theme but the Game Boy (whose case has
     real ones). -->
<script lang="ts">
  import { type Button, type Buttons, Fingers } from './input';

  let { buttons, wide, paused }: { buttons: Buttons; wide: boolean; paused: boolean } = $props();

  const CLICK = -1;

  function controls(node: HTMLElement, paused: boolean) {
    const keys = [...node.querySelectorAll<HTMLElement>('[data-button]')].map((el) => ({
      name: el.dataset.button as Button,
      group: el.dataset.group ?? '',
      el,
    }));
    const fingers = new Fingers(buttons, keys.map((key) => key.name));
    let rects: { name: Button; group: string; rect: DOMRect }[] = [];
    let timer = 0;

    const measure = () => {
      rects = keys.map(({ name, group, el }) => ({ name, group, rect: el.getBoundingClientRect() }));
    };

    /** Shows what's pressed, and comes back when a short press is due to let go. */
    const show = (wait: number) => {
      for (const { name, el } of keys) el.toggleAttribute('data-pressed', buttons[name]);
      window.clearTimeout(timer);
      timer = wait > 0 ? window.setTimeout(() => show(fingers.sync(performance.now())), wait) : 0;
    };

    const letGo = () => {
      fingers.letGo();
      show(0);
    };

    const under = (x: number, y: number): Set<Button> => {
      const found = new Set<Button>();
      let arrow: Button | null = null;
      let arrowDistance = Infinity;
      for (const { name, group, rect } of rects) {
        const slack = group === 'pad' ? 18 : 10;
        const inside = x >= rect.left - slack && x <= rect.right + slack && y >= rect.top - slack && y <= rect.bottom + slack;
        if (!inside) continue;
        if (group === 'pad') {
          const distance = Math.hypot(x - (rect.left + rect.width / 2), y - (rect.top + rect.height / 2));
          if (distance < arrowDistance) {
            arrowDistance = distance;
            arrow = name;
          }
        } else {
          found.add(name);
        }
      }
      if (arrow) found.add(arrow);
      return found;
    };

    const down = (event: PointerEvent) => {
      event.preventDefault();
      // Measured at every press: the layout may have changed under a finger held all along.
      measure();
      node.setPointerCapture?.(event.pointerId);
      show(fingers.down(event.pointerId, under(event.clientX, event.clientY), performance.now()));
    };
    const move = (event: PointerEvent) => {
      show(fingers.move(event.pointerId, under(event.clientX, event.clientY), performance.now()));
    };
    const up = (event: PointerEvent) => {
      show(fingers.up(event.pointerId, performance.now()));
    };
    // The capture this took ended without a lift reaching here: the finger is gone all the same.
    const lost = (event: PointerEvent) => {
      if (event.target === node) up(event);
    };
    // A click without a finger (a keyboard, VoiceOver): a short press.
    const click = (event: MouseEvent) => {
      if (event.detail !== 0 || !(event.target instanceof Element)) return;
      const name = event.target.closest<HTMLElement>('[data-button]')?.dataset.button as Button | undefined;
      if (!name) return;
      const now = performance.now();
      fingers.down(CLICK, new Set([name]), now);
      show(fingers.up(CLICK, now));
    };
    // A lift while the page is away never arrives here.
    const visibility = () => {
      if (document.hidden) letGo();
    };

    node.addEventListener('pointerdown', down);
    node.addEventListener('pointermove', move);
    node.addEventListener('pointerup', up);
    node.addEventListener('pointercancel', up);
    node.addEventListener('lostpointercapture', lost);
    node.addEventListener('click', click);
    window.addEventListener('resize', measure);
    window.addEventListener('blur', letGo);
    document.addEventListener('visibilitychange', visibility);
    if (paused) letGo();
    return {
      update(paused: boolean) {
        if (paused) letGo();
      },
      destroy() {
        node.removeEventListener('pointerdown', down);
        node.removeEventListener('pointermove', move);
        node.removeEventListener('pointerup', up);
        node.removeEventListener('pointercancel', up);
        node.removeEventListener('lostpointercapture', lost);
        node.removeEventListener('click', click);
        window.removeEventListener('resize', measure);
        window.removeEventListener('blur', letGo);
        document.removeEventListener('visibilitychange', visibility);
        fingers.letGo();
        window.clearTimeout(timer);
      },
    };
  }
</script>

<div class="controls" class:controls--wide={wide} use:controls={paused}>
  <div class="pad" role="group" aria-label="Move">
    <button class="key key--left" type="button" data-button="left" data-group="pad" aria-label="Left">
      <svg width="18" height="18" viewBox="0 0 10 10" aria-hidden="true"><path d="M7 1L2 5l5 4z"></path></svg>
    </button>
    <button class="key key--down" type="button" data-button="down" data-group="pad" aria-label="Down, into pipes">
      <svg width="18" height="18" viewBox="0 0 10 10" aria-hidden="true"><path d="M1 3l4 5 4-5z"></path></svg>
    </button>
    <button class="key key--right" type="button" data-button="right" data-group="pad" aria-label="Right">
      <svg width="18" height="18" viewBox="0 0 10 10" aria-hidden="true"><path d="M3 1l5 4-5 4z"></path></svg>
    </button>
  </div>
  <div class="actions" role="group" aria-label="Actions">
    <button class="key key--round key--b" type="button" data-button="b" aria-label="B, run and fire">B</button>
    <button class="key key--round key--a" type="button" data-button="a" aria-label="A, jump">A</button>
  </div>
</div>

<style>
  .controls {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: var(--s-3) var(--s-4) calc(var(--s-4) + var(--safe-bottom));
    touch-action: none;
    -webkit-touch-callout: none;
    user-select: none;
  }
  .controls--wide {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    pointer-events: none;
  }
  .controls--wide .pad,
  .controls--wide .actions {
    pointer-events: auto;
    opacity: 0.85;
  }
  .pad {
    position: relative;
    display: grid;
    grid-template-columns: repeat(3, 56px);
    grid-template-rows: 30px 56px;
    gap: 2px;
  }
  .actions {
    display: flex;
    align-items: flex-end;
    gap: var(--s-4);
    padding-bottom: var(--s-2);
  }
  .key {
    display: flex;
    align-items: center;
    justify-content: center;
    min-width: var(--tap);
    min-height: var(--tap);
    padding: 0;
    border: 0;
    border-radius: var(--r-lg);
    background: var(--c-surface-2);
    box-shadow: inset 0 0 0 1px var(--c-line);
    color: var(--c-text);
    font: inherit;
    font-weight: 700;
    cursor: pointer;
    touch-action: none;
    transition-property: background-color, transform;
    transition-duration: var(--t-hover);
  }
  :global([data-theme='workstation']) .key {
    background: var(--c-ws-face);
    box-shadow:
      inset 1px 1px var(--c-ws-light),
      inset -1px -1px var(--c-ws-dark),
      inset -2px -2px var(--c-ws-shade);
  }
  .key svg {
    fill: currentColor;
  }
  .key--left {
    grid-column: 1;
    grid-row: 2;
  }
  .key--down {
    grid-column: 2;
    grid-row: 2;
  }
  .key--right {
    grid-column: 3;
    grid-row: 2;
  }
  .key--round {
    width: 64px;
    height: 64px;
    border-radius: var(--r-pill);
    font-size: var(--fs-xl);
  }
  .key--a {
    margin-bottom: var(--s-6);
    background: var(--c-accent);
    color: var(--c-on-accent);
  }
  .key:global([data-pressed]) {
    background: var(--c-surface-hover);
    transform: scale(0.94);
  }
  .key--a:global([data-pressed]) {
    background: var(--c-accent-hover);
  }
  .key:focus-visible {
    outline: 2px solid var(--c-accent-text);
    outline-offset: 2px;
  }
</style>
