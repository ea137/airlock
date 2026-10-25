// The buttons, held. The keys (`Keys`) and the fingers on the on-screen
// buttons (`Fingers`) each hold some, and every tick the game merges its
// sources, those two and the Game Boy case's, into one set (`Merge`): a
// button is down while anything holds it, and of left and right held at
// once the one pressed last counts, so a new direction takes over from an
// old one and letting go of it hands back to the other. Whatever can lose
// track of a key or a finger (the page losing focus, the game pausing)
// lets go of everything rather than leave a button down. No DOM in here.

export type Buttons = { left: boolean; right: boolean; up: boolean; down: boolean; a: boolean; b: boolean; start: boolean; select: boolean };
export type Button = keyof Buttons;

export function noButtons(): Buttons {
  return { left: false, right: false, up: false, down: false, a: false, b: false, start: false, select: false };
}

const ALL: readonly Button[] = ['left', 'right', 'up', 'down', 'a', 'b', 'start', 'select'];

/**
 * Every source's buttons as one, each tick. Up and down aren't paired the
 * way left and right are: up does nothing in play, and the pause menu wants
 * each press of either.
 */
export class Merge {
  private tick = 0;
  /** Each source, and what it held last tick, to see what it has just pressed. */
  private readonly sources: { now: Buttons; was: Buttons }[];
  /** The tick left and right were last pressed on, by any source; 0 while up. */
  private readonly since = { left: 0, right: 0 };

  constructor(sources: readonly Buttons[]) {
    this.sources = sources.map((now) => ({ now, was: noButtons() }));
  }

  into(out: Buttons): void {
    this.tick += 1;
    for (const name of ALL) {
      let down = false;
      let pressed = false;
      for (const source of this.sources) {
        const held = source.now[name];
        if (held && !source.was[name]) pressed = true;
        source.was[name] = held;
        if (held) down = true;
      }
      out[name] = down;
      if (name === 'left' || name === 'right') {
        if (!down) this.since[name] = 0;
        else if (pressed) this.since[name] = this.tick;
      }
    }
    // Both held: the later press counts (pressed together, neither does).
    if (out.left && out.right) {
      if (this.since.left > this.since.right) out.right = false;
      else if (this.since.right > this.since.left) out.left = false;
    }
  }
}

/** What each key does, by what it types (letters in lower case). */
export const KEYS: Readonly<Record<string, Button>> = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowUp: 'up',
  ArrowDown: 'down',
  a: 'left',
  d: 'right',
  w: 'up',
  s: 'down',
  z: 'a',
  k: 'a',
  ' ': 'a',
  x: 'b',
  j: 'b',
  Shift: 'b',
  Enter: 'start',
  p: 'start',
  Backspace: 'select',
};

export type Key = Pick<KeyboardEvent, 'key' | 'code' | 'metaKey' | 'ctrlKey' | 'altKey'>;

/**
 * The keys held down, written into `buttons`. Each is known by where it is
 * on the keyboard (`code`), so it lets go of what it pressed even if what
 * it types changed in between (Option held, say), and of two keys on one
 * button, letting go of one leaves it down. A key pressed with ⌘, Ctrl or
 * Option is a shortcut, not the game's; and macOS sends no release for a
 * key let go while ⌘ is down, so letting go of ⌘ lets go of every key.
 * A key tapped and let go before the game looked (a quick tap, a slow
 * frame) stays down until it has: the game calls seen() once a tick, so
 * every press is seen, once.
 */
export class Keys {
  private readonly held = new Map<string, Button>();
  /** Buttons pressed since the game last looked. */
  private readonly unseen = new Set<Button>();

  constructor(private readonly buttons: Buttons) {}

  /** A key went down (or repeated); true if it's one of the game's. */
  down(event: Key): boolean {
    if (event.metaKey || event.ctrlKey || event.altKey) return false;
    const name = KEYS[event.key.length === 1 ? event.key.toLowerCase() : event.key];
    if (!name) return false;
    const code = event.code || event.key;
    // A repeat of a key already down is no new press.
    if (!this.held.has(code)) this.unseen.add(name);
    this.held.set(code, name);
    this.sync();
    return true;
  }

  up(event: Key): void {
    if (event.key === 'Meta') this.held.clear();
    else this.held.delete(event.code || event.key);
    this.sync();
  }

  /** The game has looked at the buttons: the presses it saw may go up now. */
  seen(): void {
    if (this.unseen.size === 0) return;
    this.unseen.clear();
    this.sync();
  }

  letGo(): void {
    this.held.clear();
    this.unseen.clear();
    this.sync();
  }

  private sync(): void {
    for (const name of ALL) this.buttons[name] = false;
    for (const name of this.held.values()) this.buttons[name] = true;
    for (const name of this.unseen) this.buttons[name] = true;
  }
}

/** A press is held at least this long, so a quick tap is never missed. */
export const MIN_PRESS_MS = 60;

/**
 * The fingers on the on-screen buttons, by pointer id, each holding the
 * buttons under it, written into `buttons` (only `names`, the screen's
 * own). A button stays down at least MIN_PRESS_MS: each call returns how
 * long until one held only for that is due to go up (call `sync` then), or 0.
 */
export class Fingers {
  private readonly held = new Map<number, ReadonlySet<Button>>();
  private readonly since = new Map<Button, number>();

  constructor(
    private readonly buttons: Buttons,
    private readonly names: readonly Button[],
  ) {}

  down(id: number, names: ReadonlySet<Button>, now: number): number {
    this.held.set(id, names);
    return this.sync(now);
  }

  /** A finger slid onto other buttons; one that isn't down is ignored. */
  move(id: number, names: ReadonlySet<Button>, now: number): number {
    if (this.held.has(id)) this.held.set(id, names);
    return this.sync(now);
  }

  /** A finger lifted, or the browser gave up on it. */
  up(id: number, now: number): number {
    this.held.delete(id);
    return this.sync(now);
  }

  /** Every finger lets go, at once however short its press; one still down has to press again. */
  letGo(): void {
    this.held.clear();
    this.since.clear();
    for (const name of this.names) this.buttons[name] = false;
  }

  sync(now: number): number {
    let wait = 0;
    for (const name of this.names) {
      let down = false;
      for (const names of this.held.values()) if (names.has(name)) down = true;
      if (down) {
        if (!this.buttons[name]) this.since.set(name, now);
        this.buttons[name] = true;
      } else if (this.buttons[name]) {
        // Let go, but not before the game has seen it.
        const left = MIN_PRESS_MS - (now - (this.since.get(name) ?? 0));
        if (left <= 0) this.buttons[name] = false;
        else if (wait === 0 || left < wait) wait = left;
      }
    }
    return wait;
  }
}
