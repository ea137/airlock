import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Polled } from './polled.svelte';

const EVERY_MS = 1000;

/** The page, as far as Polled sees it: whether it's hidden, and when that changes. */
class Page extends EventTarget {
  hidden = false;
  show(shown: boolean) {
    this.hidden = !shown;
    this.dispatchEvent(new Event('visibilitychange'));
  }
}

/** A load whose answers come when the test says. */
function loads() {
  const waiting: Array<(answer: string) => void> = [];
  const load = vi.fn(() => new Promise<string>((answer) => waiting.push(answer)));
  const answer = async (index: number, value: string) => {
    waiting[index]?.(value);
    await vi.advanceTimersByTimeAsync(0);
  };
  return { load, answer };
}

let page: Page;

beforeEach(() => {
  vi.useFakeTimers();
  page = new Page();
  vi.stubGlobal('document', page);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('Polled', () => {
  it('waits for a slow answer before asking again, then asks a while after it', async () => {
    const { load, answer } = loads();
    const polled = new Polled(load, EVERY_MS);
    const stop = polled.watch();
    await vi.advanceTimersByTimeAsync(EVERY_MS * 5);
    expect(load).toHaveBeenCalledTimes(1);

    await answer(0, 'first');
    expect(polled.data).toBe('first');
    await vi.advanceTimersByTimeAsync(EVERY_MS - 1);
    expect(load).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(load).toHaveBeenCalledTimes(2);
    stop();
  });

  it('shows the answer to the latest ask, not an older one that comes later', async () => {
    const { load, answer } = loads();
    const polled = new Polled(load, EVERY_MS);
    const stop = polled.watch();
    // Something changed (a process stopped): ask again while the first is on its way.
    void polled.refresh();
    await answer(1, 'after the change');
    await answer(0, 'before the change');
    expect(polled.data).toBe('after the change');
    stop();
  });

  it('asks nothing while the page is hidden, and at once when it comes back late', async () => {
    const { load, answer } = loads();
    const polled = new Polled(load, EVERY_MS);
    const stop = polled.watch();
    await answer(0, 'first');
    page.show(false);
    await vi.advanceTimersByTimeAsync(EVERY_MS * 10);
    expect(load).toHaveBeenCalledTimes(1);

    page.show(true);
    expect(load).toHaveBeenCalledTimes(2);
    stop();
  });

  it('waits out the rest of the while when the page comes back early', async () => {
    const { load, answer } = loads();
    const polled = new Polled(load, EVERY_MS);
    const stop = polled.watch();
    await answer(0, 'first');
    page.show(false);
    await vi.advanceTimersByTimeAsync(EVERY_MS / 4);
    page.show(true);
    expect(load).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync((EVERY_MS * 3) / 4);
    expect(load).toHaveBeenCalledTimes(2);
    stop();
  });

  it('keeps one timer for every screen watching, and stops when the last one leaves', async () => {
    const { load, answer } = loads();
    const polled = new Polled(load, EVERY_MS);
    const stopOne = polled.watch();
    const stopOther = polled.watch();
    expect(load).toHaveBeenCalledTimes(1);
    await answer(0, 'first');
    await vi.advanceTimersByTimeAsync(EVERY_MS);
    expect(load).toHaveBeenCalledTimes(2);

    stopOne();
    stopOne();
    await answer(1, 'second');
    await vi.advanceTimersByTimeAsync(EVERY_MS);
    expect(load).toHaveBeenCalledTimes(3);

    stopOther();
    await answer(2, 'third');
    await vi.advanceTimersByTimeAsync(EVERY_MS * 5);
    expect(load).toHaveBeenCalledTimes(3);
  });

  it('loads once for a burst of news, over a load that left before it, then waits a while', async () => {
    const { load, answer } = loads();
    const polled = new Polled(load, EVERY_MS);
    polled.nudge();
    await vi.advanceTimersByTimeAsync(EVERY_MS);
    expect(load).not.toHaveBeenCalled();

    const stop = polled.watch();
    polled.nudge();
    polled.nudge();
    polled.nudge();
    await vi.advanceTimersByTimeAsync(300);
    expect(load).toHaveBeenCalledTimes(2);
    await answer(1, 'after the news');
    await answer(0, 'before the news');
    expect(polled.data).toBe('after the news');

    await vi.advanceTimersByTimeAsync(EVERY_MS - 1);
    expect(load).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(load).toHaveBeenCalledTimes(3);
    stop();
  });

  it('keeps the last data on screen when a refresh fails', async () => {
    let fail = false;
    const polled = new Polled(async () => {
      if (fail) throw new Error('The laptop is asleep');
      return 'fine';
    }, EVERY_MS);
    await polled.refresh();
    fail = true;
    await polled.refresh();
    expect(polled.state.status).toBe('error');
    expect(polled.data).toBe('fine');
    expect(polled.error?.message).toContain('asleep');
  });
});
