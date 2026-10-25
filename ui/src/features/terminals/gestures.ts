// Touch on the terminal: one finger scrolls, two fingers set the font size.

import type { Terminal } from '@xterm/xterm';

/** Finger travel per wheel notch, in pixels. */
const STEP_PX = 18;

export const FONT_MIN = 8;
export const FONT_MAX = 28;

export function clampFont(size: number): number {
  return Math.min(FONT_MAX, Math.max(FONT_MIN, Math.round(size)));
}

/**
 * One wheel notch. When the program on screen takes the mouse (tmux does,
 * for its history), it gets an SGR wheel report; otherwise xterm scrolls.
 */
function wheel(term: Terminal, up: boolean, sendBinary: (data: string) => void): void {
  if (term.modes.mouseTrackingMode === 'none') {
    term.scrollLines(up ? -3 : 3);
    return;
  }
  const col = Math.ceil(term.cols / 2);
  const row = Math.ceil(term.rows / 2);
  sendBinary(`\x1b[<${up ? 64 : 65};${col};${row}M`);
}

type Touching = { kind: 'scroll'; y: number; moved: boolean } | { kind: 'pinch'; distance: number; size: number };

function distance(a: Touch, b: Touch): number {
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
}

/** The phone's font size for the terminal, as the person chose it. */
export type FontSize = { get: () => number; set: (size: number) => void };

/** Wires the gestures onto `element`; call the result to remove them. */
export function attachGestures(
  element: HTMLElement,
  term: Terminal,
  sendBinary: (data: string) => void,
  font: FontSize,
  /** A swipe scrolled, toward older lines (`true`) or newer. */
  onScroll: (older: boolean) => void = () => undefined,
): () => void {
  let touching: Touching | null = null;

  const onStart = (event: TouchEvent) => {
    const [a, b] = [event.touches[0], event.touches[1]];
    if (a && b) {
      touching = { kind: 'pinch', distance: distance(a, b), size: font.get() };
    } else if (a) {
      touching = { kind: 'scroll', y: a.clientY, moved: false };
    }
  };

  const onMove = (event: TouchEvent) => {
    if (!touching) return;
    event.preventDefault();
    event.stopPropagation();
    const [a, b] = [event.touches[0], event.touches[1]];
    if (touching.kind === 'pinch') {
      if (a && b) font.set(clampFont((touching.size * distance(a, b)) / touching.distance));
      return;
    }
    if (!a) return;
    while (Math.abs(a.clientY - touching.y) >= STEP_PX) {
      // A finger moving down shows older lines.
      const down = a.clientY > touching.y;
      wheel(term, down, sendBinary);
      onScroll(down);
      touching.y += down ? STEP_PX : -STEP_PX;
      touching.moved = true;
    }
  };

  const onEnd = (event: TouchEvent) => {
    if (touching?.kind === 'scroll' && touching.moved) {
      // A swipe isn't a tap: don't move the cursor or open the keyboard.
      event.preventDefault();
      event.stopPropagation();
    }
    if (event.touches.length === 0) touching = null;
  };

  const noPageZoom = (event: Event) => event.preventDefault();

  element.addEventListener('touchstart', onStart, { passive: true, capture: true });
  element.addEventListener('touchmove', onMove, { passive: false, capture: true });
  element.addEventListener('touchend', onEnd, { passive: false, capture: true });
  document.addEventListener('gesturestart', noPageZoom);
  return () => {
    element.removeEventListener('touchstart', onStart, { capture: true });
    element.removeEventListener('touchmove', onMove, { capture: true });
    element.removeEventListener('touchend', onEnd, { capture: true });
    document.removeEventListener('gesturestart', noPageZoom);
  };
}
