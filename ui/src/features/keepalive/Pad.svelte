<!-- Keepalive's on-screen buttons, for every theme but the Game Boy (whose
     case has real ones): a D-pad on one side; A (talk, use, a companion's
     move), B (ping) and the companion switch on the other. Each finger is
     tracked by its own pointer id and holds one button; a thumb can slide
     round the D-pad, and the newest direction wins. A finger that lifts,
     is cancelled or loses its capture lets go of its button, and nothing
     else's. -->
<script lang="ts">
  import { type Control, type Controls, isDirection } from './input';

  let { controls, wide, front }: { controls: Controls; wide: boolean; front: string } = $props();

  function pad(node: HTMLElement) {
    /** Which button each finger holds. */
    const fingers = new Map<number, Control>();
    let rects: { control: Control; rect: DOMRect; el: HTMLElement }[] = [];

    const measure = () => {
      rects = [...node.querySelectorAll<HTMLElement>('[data-control]')].map((el) => ({
        control: el.dataset.control as Control,
        rect: el.getBoundingClientRect(),
        el,
      }));
    };

    /** The button under a finger: the nearest arrow on the D-pad, or the button it's on. */
    const under = (x: number, y: number, from: Control | undefined): Control | null => {
      let best: Control | null = null;
      let bestDistance = Infinity;
      for (const { control, rect } of rects) {
        const arrow = isDirection(control);
        // A thumb on the D-pad may slide between arrows, not off onto A or B.
        if (from && isDirection(from) !== arrow) continue;
        const slack = arrow ? 20 : 8;
        if (x < rect.left - slack || x > rect.right + slack || y < rect.top - slack || y > rect.bottom + slack) continue;
        const distance = Math.hypot(x - (rect.left + rect.width / 2), y - (rect.top + rect.height / 2));
        if (distance < bestDistance) {
          bestDistance = distance;
          best = control;
        }
      }
      return best;
    };

    const show = () => {
      const held = new Set(fingers.values());
      for (const { control, el } of rects) el.toggleAttribute('data-pressed', held.has(control));
    };

    const press = (id: number, control: Control | null) => {
      if (control) {
        fingers.set(id, control);
        controls.press(`ptr:${id}`, control);
      } else {
        fingers.delete(id);
        controls.release(`ptr:${id}`);
      }
      show();
    };

    const down = (event: PointerEvent) => {
      event.preventDefault();
      if (fingers.size === 0) measure();
      const control = under(event.clientX, event.clientY, undefined);
      if (!control) return;
      node.setPointerCapture?.(event.pointerId);
      press(event.pointerId, control);
    };
    const move = (event: PointerEvent) => {
      const from = fingers.get(event.pointerId);
      if (!from) return;
      const control = under(event.clientX, event.clientY, from);
      // Slid off the pad altogether: keep the last arrow until the finger lifts.
      if (control && control !== from) press(event.pointerId, control);
    };
    const up = (event: PointerEvent) => {
      if (fingers.has(event.pointerId)) press(event.pointerId, null);
    };
    // Taken away (by the system, or the capture lost): let go, and it was no tap.
    const cancel = (event: PointerEvent) => {
      if (!fingers.has(event.pointerId)) return;
      fingers.delete(event.pointerId);
      controls.cancel(`ptr:${event.pointerId}`);
      show();
    };
    // Every finger at once: the page lost focus, or the pad went away.
    const all = () => {
      for (const id of [...fingers.keys()]) controls.release(`ptr:${id}`);
      fingers.clear();
      show();
    };
    // A click without a finger (a keyboard, VoiceOver): a tap.
    const click = (event: MouseEvent) => {
      if (event.detail !== 0 || !(event.target instanceof Element)) return;
      const control = event.target.closest<HTMLElement>('[data-control]')?.dataset.control as Control | undefined;
      if (!control) return;
      controls.press('ptr:click', control);
      controls.release('ptr:click');
    };

    node.addEventListener('pointerdown', down);
    node.addEventListener('pointermove', move);
    node.addEventListener('pointerup', up);
    node.addEventListener('pointercancel', cancel);
    node.addEventListener('lostpointercapture', cancel);
    node.addEventListener('click', click);
    window.addEventListener('resize', measure);
    window.addEventListener('blur', all);
    return {
      destroy() {
        all();
        node.removeEventListener('pointerdown', down);
        node.removeEventListener('pointermove', move);
        node.removeEventListener('pointerup', up);
        node.removeEventListener('pointercancel', cancel);
        node.removeEventListener('lostpointercapture', cancel);
        node.removeEventListener('click', click);
        window.removeEventListener('resize', measure);
        window.removeEventListener('blur', all);
      },
    };
  }
</script>

<div class="pad" class:pad--wide={wide} use:pad>
  <div class="dpad" role="group" aria-label="Move">
    <button class="key key--up" type="button" data-control="up" aria-label="Up">
      <svg width="16" height="16" viewBox="0 0 10 10" aria-hidden="true"><path d="M1 7l4-5 4 5z"></path></svg>
    </button>
    <button class="key key--left" type="button" data-control="left" aria-label="Left">
      <svg width="16" height="16" viewBox="0 0 10 10" aria-hidden="true"><path d="M7 1L2 5l5 4z"></path></svg>
    </button>
    <button class="key key--right" type="button" data-control="right" aria-label="Right">
      <svg width="16" height="16" viewBox="0 0 10 10" aria-hidden="true"><path d="M3 1l5 4-5 4z"></path></svg>
    </button>
    <button class="key key--down" type="button" data-control="down" aria-label="Down">
      <svg width="16" height="16" viewBox="0 0 10 10" aria-hidden="true"><path d="M1 3l4 5 4-5z"></path></svg>
    </button>
  </div>
  <div class="actions" role="group" aria-label="Actions">
    <button class="key key--switch" type="button" data-control="switch" aria-label={front ? `Switch companion, ${front} in front` : 'Switch companion'}>
      <span class="switch__name">{front || '—'}</span>
      <svg width="14" height="10" viewBox="0 0 14 10" aria-hidden="true"><path d="M1 3h10l-3-2M13 7H3l3 2"></path></svg>
    </button>
    <button class="key key--round key--b" type="button" data-control="b" aria-label="B, ping">B</button>
    <button class="key key--round key--a" type="button" data-control="a" aria-label="A, talk and use">A</button>
  </div>
</div>

<style>
  .pad {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: var(--s-2) var(--s-4) calc(var(--s-3) + var(--safe-bottom));
    touch-action: none;
    -webkit-touch-callout: none;
    user-select: none;
  }
  /* On a wide screen the buttons sit over the corners of the game. */
  .pad--wide {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    pointer-events: none;
  }
  .pad--wide .dpad,
  .pad--wide .actions {
    pointer-events: auto;
    opacity: 0.85;
  }
  .dpad {
    display: grid;
    grid-template-columns: repeat(3, 48px);
    grid-template-rows: repeat(3, 44px);
    gap: 2px;
  }
  .actions {
    display: grid;
    grid-template-columns: 64px 64px;
    grid-template-rows: auto 64px 30px;
    column-gap: var(--s-3);
    align-items: end;
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
  .key--up {
    grid-column: 2;
    grid-row: 1;
  }
  .key--left {
    grid-column: 1;
    grid-row: 2;
  }
  .key--right {
    grid-column: 3;
    grid-row: 2;
  }
  .key--down {
    grid-column: 2;
    grid-row: 3;
  }
  .key--switch {
    grid-column: 1 / 3;
    grid-row: 1;
    gap: var(--s-2);
    min-height: 36px;
    margin-bottom: var(--s-2);
    padding: 0 var(--s-3);
    font-size: var(--fs-sm);
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }
  .key--switch svg {
    fill: none;
    stroke: currentColor;
    stroke-width: 1.6;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .key--round {
    width: 64px;
    height: 64px;
    border-radius: var(--r-pill);
    font-size: var(--fs-xl);
  }
  .key--b {
    grid-column: 1;
    grid-row: 2 / 4;
    align-self: end;
  }
  .key--a {
    grid-column: 2;
    grid-row: 2;
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
