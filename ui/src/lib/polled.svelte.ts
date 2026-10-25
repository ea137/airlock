// Data kept fresh while something shows it: loaded at once, then again every
// so often while the page is visible, and at once when it comes back. A
// failed refresh keeps the last data on screen next to the error.

import type { ApiError } from './api';
import { handleError } from './session.svelte';

/** News comes in bursts (a tool, then a prompt): one load for all of it. */
const NUDGE_MS = 250;

export type PolledState<T> =
  | { status: 'loading' }
  | { status: 'ready'; data: T }
  | { status: 'error'; error: ApiError; data: T | null };

export class Polled<T> {
  // Each answer replaces the last one whole and is never changed in place,
  // so Svelte doesn't watch inside it.
  state = $state.raw<PolledState<T>>({ status: 'loading' });
  readonly #load: () => Promise<T>;
  readonly #everyMs: number;
  /** Loads asked for so far; only the latest one's answer is shown. */
  #asked = 0;
  #watchers = 0;
  #timer: ReturnType<typeof setTimeout> | undefined;
  /** Whether the timer's own load is on its way. */
  #ticking = false;
  #loadedAt = 0;
  #nudge: ReturnType<typeof setTimeout> | undefined;

  constructor(load: () => Promise<T>, everyMs: number) {
    this.#load = load;
    this.#everyMs = everyMs;
  }

  /** The last data that loaded, even while a refresh is failing. */
  get data(): T | null {
    return this.state.status === 'loading' ? null : this.state.data;
  }

  get error(): ApiError | null {
    return this.state.status === 'error' ? this.state.error : null;
  }

  /** Loads it now. A load still on its way is overtaken: its answer, from
   * before whatever asked for this one, is dropped. */
  async refresh(): Promise<void> {
    const asked = ++this.#asked;
    try {
      const data = await this.#load();
      if (asked === this.#asked) this.state = { status: 'ready', data };
    } catch (error) {
      const problem = handleError(error);
      if (asked === this.#asked) this.state = { status: 'error', error: problem, data: this.data };
    }
  }

  /** Keeps the data fresh while anything watches it; call the result to stop
   * watching. The next load is due a while after the last one ended, so a
   * slow answer never piles up requests. */
  watch(): () => void {
    this.#watchers += 1;
    if (this.#watchers === 1) {
      document.addEventListener('visibilitychange', this.#onVisibility);
      this.#tick();
    }
    let watching = true;
    return () => {
      if (!watching) return;
      watching = false;
      this.#watchers -= 1;
      if (this.#watchers === 0) {
        clearTimeout(this.#timer);
        clearTimeout(this.#nudge);
        this.#nudge = undefined;
        document.removeEventListener('visibilitychange', this.#onVisibility);
      }
    };
  }

  /** Something it shows changed (the hub said so): loads it again shortly,
   * once for a burst of news, overtaking a load already on its way, which
   * may have left before the change. */
  nudge(): void {
    if (this.#watchers === 0 || this.#nudge !== undefined) return;
    this.#nudge = setTimeout(() => {
      this.#nudge = undefined;
      clearTimeout(this.#timer);
      void this.refresh().finally(() => {
        this.#loadedAt = Date.now();
        this.#plan(this.#everyMs);
      });
    }, NUDGE_MS);
  }

  #tick = () => {
    clearTimeout(this.#timer);
    // One on its way plans the next itself.
    if (this.#ticking) return;
    this.#ticking = true;
    void this.refresh().finally(() => {
      this.#ticking = false;
      this.#loadedAt = Date.now();
      this.#plan(this.#everyMs);
    });
  };

  #plan(inMs: number) {
    clearTimeout(this.#timer);
    if (this.#watchers > 0 && !document.hidden) this.#timer = setTimeout(this.#tick, inMs);
  }

  #onVisibility = () => {
    if (document.hidden) {
      clearTimeout(this.#timer);
      return;
    }
    const due = this.#loadedAt + this.#everyMs - Date.now();
    if (due <= 0) this.#tick();
    else this.#plan(due);
  };
}
