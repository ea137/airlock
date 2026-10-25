// The way into the secret game, the only part of it in Airlock's main
// bundle: holding a finger on any screen's header for a moment opens it (a
// press that starts on a link or a button is left alone), and so does the
// old cheat code on a keyboard. The game itself loads on first open.

export const gameDoor = $state({ open: false });

/** The Game Boy case's buttons while the game is open; the case writes, the game reads. */
export const casePad = { left: false, right: false, up: false, down: false, a: false, b: false, start: false, select: false };

type PadButton = keyof typeof casePad;

/** Which case button each finger is on, by pointer id, across all the case's buttons. */
const caseFingers = new Map<number, PadButton>();

function syncCase(): void {
  for (const key of Object.keys(casePad) as PadButton[]) casePad[key] = false;
  for (const button of caseFingers.values()) casePad[button] = true;
}

/** A finger on one of the case's buttons, or slid onto another. */
export function pressCase(pointer: number, button: PadButton): void {
  caseFingers.set(pointer, button);
  syncCase();
}

/** A finger off the case's buttons: lifted, or given up on by the browser. */
export function liftCase(pointer: number): void {
  if (caseFingers.delete(pointer)) syncCase();
}

/**
 * Every finger lets go of the case's buttons (the game closed or paused, or
 * the page lost focus), so none whose release went missing stays down; one
 * still down has to press again.
 */
export function releaseCase(): void {
  caseFingers.clear();
  syncCase();
}

export function openGame(): void {
  gameDoor.open = true;
}

export function closeGame(): void {
  gameDoor.open = false;
  releaseCase();
}

/** How long a press has to last. */
export const HOLD_MS = 700;
const DRIFT_PX = 12;
const CONTROLS = 'a, button, input, select, textarea, label, [role="button"], [role="link"], [role="switch"], [role="tab"], [contenteditable]';

/** Holding on this element (not on a control inside it) opens the game. */
export function secretDoor(node: HTMLElement) {
  node.dataset.door = '';
  let timer = 0;
  let pointer = -1;
  let fromX = 0;
  let fromY = 0;
  const cancel = () => {
    if (timer) window.clearTimeout(timer);
    timer = 0;
    pointer = -1;
  };
  const down = (event: PointerEvent) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if (event.target instanceof Element && event.target.closest(CONTROLS)) return;
    cancel();
    pointer = event.pointerId;
    fromX = event.clientX;
    fromY = event.clientY;
    timer = window.setTimeout(() => {
      timer = 0;
      pointer = -1;
      openGame();
    }, HOLD_MS);
  };
  const move = (event: PointerEvent) => {
    if (event.pointerId === pointer && Math.hypot(event.clientX - fromX, event.clientY - fromY) > DRIFT_PX) cancel();
  };
  const up = (event: PointerEvent) => {
    if (event.pointerId === pointer) cancel();
  };
  // A long press on plain text shouldn't bring up the phone's own menu.
  const menu = (event: Event) => {
    if (!(event.target instanceof Element && event.target.closest(CONTROLS))) event.preventDefault();
  };
  node.addEventListener('pointerdown', down);
  node.addEventListener('pointermove', move);
  node.addEventListener('pointerup', up);
  node.addEventListener('pointercancel', up);
  node.addEventListener('contextmenu', menu);
  return {
    destroy() {
      cancel();
      delete node.dataset.door;
      node.removeEventListener('pointerdown', down);
      node.removeEventListener('pointermove', move);
      node.removeEventListener('pointerup', up);
      node.removeEventListener('pointercancel', up);
      node.removeEventListener('contextmenu', menu);
    },
  };
}

/**
 * The case's buttons, held down, while the game is open: each finger
 * presses the button under it (marked `data-pad`), and can slide across the
 * D-pad. With the game closed this does nothing and the buttons click as ever.
 */
export function caseButtons(node: HTMLElement) {
  // A press made for the game never clicks the button under it as well,
  // even if the game closed in between.
  let swallow = false;
  const click = (event: MouseEvent) => {
    if (!swallow && !gameDoor.open) return;
    swallow = false;
    event.stopPropagation();
    event.preventDefault();
  };
  const under = (x: number, y: number): PadButton | null => {
    let best: PadButton | null = null;
    let bestDistance = Infinity;
    for (const el of node.querySelectorAll<HTMLElement>('[data-pad]')) {
      const rect = el.getBoundingClientRect();
      const slack = 14;
      if (x < rect.left - slack || x > rect.right + slack || y < rect.top - slack || y > rect.bottom + slack) continue;
      const distance = Math.hypot(x - (rect.left + rect.width / 2), y - (rect.top + rect.height / 2));
      if (distance < bestDistance) {
        bestDistance = distance;
        best = el.dataset.pad as PadButton;
      }
    }
    return best;
  };
  const down = (event: PointerEvent) => {
    if (!gameDoor.open) return;
    const button = under(event.clientX, event.clientY);
    if (!button) return;
    event.preventDefault();
    swallow = true;
    node.setPointerCapture?.(event.pointerId);
    pressCase(event.pointerId, button);
  };
  const move = (event: PointerEvent) => {
    const from = caseFingers.get(event.pointerId);
    if (!from) return;
    const button = under(event.clientX, event.clientY);
    // Slide between the arrows, but not off an arrow onto A or B.
    const arrows = ['up', 'down', 'left', 'right'];
    if (button && button !== from && arrows.includes(button) === arrows.includes(from)) pressCase(event.pointerId, button);
  };
  const up = (event: PointerEvent) => liftCase(event.pointerId);
  // The capture this took ended without a lift reaching here: the finger is gone all the same.
  const lost = (event: PointerEvent) => {
    if (event.target === node) liftCase(event.pointerId);
  };
  node.addEventListener('pointerdown', down);
  node.addEventListener('pointermove', move);
  node.addEventListener('pointerup', up);
  node.addEventListener('pointercancel', up);
  node.addEventListener('lostpointercapture', lost);
  node.addEventListener('click', click, true);
  return {
    destroy() {
      node.removeEventListener('pointerdown', down);
      node.removeEventListener('pointermove', move);
      node.removeEventListener('pointerup', up);
      node.removeEventListener('pointercancel', up);
      node.removeEventListener('lostpointercapture', lost);
      node.removeEventListener('click', click, true);
    },
  };
}

const CODE = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a'];

/** How far into the code a key takes you; the full length means open. */
export function codeStep(progress: number, key: string): number {
  const want = CODE[progress];
  const typed = key.length === 1 ? key.toLowerCase() : key;
  if (typed === want) return progress + 1;
  // A third up still leaves two ups typed.
  if (typed === CODE[0]) return progress === 2 ? 2 : 1;
  return 0;
}

export const CODE_LENGTH = CODE.length;

/** Whether a key went to something being typed in (a field, a terminal). */
export function typing(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
}
