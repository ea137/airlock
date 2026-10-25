// What the player is holding, from every source at once: keys, fingers on
// the on-screen buttons, and the Game Boy case's buttons. Each source holds
// one control under its own name (a key's code, a pointer's id), so one
// finger lifting never lets go of what another still holds. The newest
// direction pressed wins while it's held, and falls back to the one before
// when let go. A press is kept until the game has seen it, so a tap that
// starts and ends between two frames still counts. clear() lets go of
// everything at once: for a cancelled touch, a lost window, a pause.

export type Control = 'up' | 'right' | 'down' | 'left' | 'a' | 'b' | 'switch' | 'menu' | 'select';

export const CONTROLS: readonly Control[] = ['up', 'right', 'down', 'left', 'a', 'b', 'switch', 'menu', 'select'];

/** Directions in the world's order (up, right, down, left). */
const DIRECTIONS: readonly Control[] = ['up', 'right', 'down', 'left'];

export function isDirection(control: Control): boolean {
  return DIRECTIONS.includes(control);
}

/** One tick's view of the controls: held now, and pressed since the last tick. */
export type Frame = Record<Control, boolean> & { pressed: Record<Control, boolean>; dir: number };

export function emptyFrame(): Frame {
  const none = (): Record<Control, boolean> => ({ up: false, right: false, down: false, left: false, a: false, b: false, switch: false, menu: false, select: false });
  return { ...none(), pressed: none(), dir: -1 };
}

export class Controls {
  /** Source name to the control it holds. */
  private readonly holders = new Map<string, Control>();
  /** When each control was last pressed, to find the newest direction. */
  private readonly when = new Map<Control, number>();
  private serial = 0;
  /** Pressed since the last read, even if already let go. */
  private readonly fresh = new Set<Control>();

  press(source: string, control: Control): void {
    const before = this.holders.get(source);
    if (before === control) return;
    this.holders.set(source, control);
    // Already held by another source: still a newer press of it.
    this.serial += 1;
    this.when.set(control, this.serial);
    this.fresh.add(control);
  }

  release(source: string): void {
    this.holders.delete(source);
  }

  /** Lets go without it counting as a tap (a touch the system took away, a lost capture). */
  cancel(source: string): void {
    const control = this.holders.get(source);
    this.holders.delete(source);
    if (control && !this.held(control)) this.fresh.delete(control);
  }

  /** Lets go of everything a kind of source holds ('key:', 'ptr:', 'case:'). */
  releaseAll(prefix: string): void {
    for (const source of [...this.holders.keys()]) if (source.startsWith(prefix)) this.holders.delete(source);
  }

  /** Lets go of everything, and forgets presses not yet seen. */
  clear(): void {
    this.holders.clear();
    this.fresh.clear();
  }

  held(control: Control): boolean {
    for (const held of this.holders.values()) if (held === control) return true;
    return false;
  }

  /** The direction to move: the newest one held; with none held, one tapped since the last read; -1 for none. */
  direction(): number {
    const held = this.newest(true);
    return held >= 0 ? held : this.newest(false);
  }

  private newest(held: boolean): number {
    let best = -1;
    let newest = -1;
    for (let dir = 0; dir < DIRECTIONS.length; dir += 1) {
      const control = DIRECTIONS[dir] ?? 'up';
      if (held ? !this.held(control) : !this.fresh.has(control)) continue;
      const at = this.when.get(control) ?? 0;
      if (at > newest) {
        newest = at;
        best = dir;
      }
    }
    return best;
  }

  /** Fills a frame for this tick, and starts collecting presses for the next. */
  read(into: Frame): Frame {
    for (const control of CONTROLS) {
      into[control] = this.held(control);
      into.pressed[control] = this.fresh.has(control);
    }
    into.dir = this.direction();
    this.fresh.clear();
    return into;
  }

  /** Whether anything at all is held, for the tests. */
  get busy(): boolean {
    return this.holders.size > 0;
  }
}

/** The keyboard's controls; a key not here isn't the game's. */
export const KEYS: Record<string, Control> = {
  ArrowUp: 'up',
  ArrowRight: 'right',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  KeyW: 'up',
  KeyD: 'right',
  KeyS: 'down',
  KeyA: 'left',
  KeyZ: 'a',
  KeyK: 'a',
  Space: 'a',
  KeyX: 'b',
  KeyJ: 'b',
  KeyC: 'switch',
  KeyQ: 'switch',
  KeyL: 'switch',
  Enter: 'menu',
  KeyP: 'menu',
  Backspace: 'select',
};
