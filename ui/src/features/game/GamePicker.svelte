<script lang="ts">
  import { onMount, tick } from 'svelte';

  import { casePad, releaseCase } from './door.svelte';

  let { inCase, onpick, onclose }: { inCase: boolean; onpick: (id: string) => void; onclose: () => void } = $props();

  const LAST = 'airlock.games.last';
  const GAMES = [
    { id: 'hop', name: 'Hop Count', line: "A packet's long way home: jump, run, never the same zone twice." },
    { id: 'keepalive', name: 'Keepalive', line: 'A ping, four companions and one question, across a network gone quiet.' },
  ];

  function lastPlayed(): string {
    try {
      return localStorage.getItem(LAST) ?? 'hop';
    } catch {
      return 'hop';
    }
  }

  let list: HTMLElement | undefined = $state();
  const first = lastPlayed();
  const games = [...GAMES].sort((a, b) => Number(b.id === first) - Number(a.id === first));

  function pick(id: string) {
    try {
      localStorage.setItem(LAST, id);
    } catch {
      // Not remembered; it still opens.
    }
    // The A that picked doesn't carry on into the game as a press.
    if (inCase) releaseCase();
    onpick(id);
  }

  function move(step: number) {
    const buttons = [...(list?.querySelectorAll<HTMLElement>('button') ?? [])];
    const at = buttons.indexOf(document.activeElement as HTMLElement);
    buttons[at < 0 ? 0 : (at + step + buttons.length) % buttons.length]?.focus();
  }

  onMount(() => {
    void tick().then(() => list?.querySelector<HTMLElement>('button')?.focus());
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onclose();
      } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        move(event.key === 'ArrowDown' ? 1 : -1);
      }
    };
    window.addEventListener('keydown', keydown);
    let frame = 0;
    const before = { up: false, down: false, a: false, b: false, start: false };
    const poll = () => {
      frame = requestAnimationFrame(poll);
      for (const key of ['up', 'down', 'a', 'b', 'start'] as const) {
        const now = casePad[key];
        if (now && !before[key]) {
          const focused = document.activeElement;
          if (key === 'up' || key === 'down') move(key === 'down' ? 1 : -1);
          else if (key === 'b') onclose();
          else if (focused instanceof HTMLElement && list?.contains(focused)) focused.click();
          else list?.querySelector<HTMLElement>('button')?.click();
        }
        before[key] = now;
      }
    };
    if (inCase) frame = requestAnimationFrame(poll);
    return () => {
      window.removeEventListener('keydown', keydown);
      cancelAnimationFrame(frame);
    };
  });
</script>

<div class="picker" class:picker--case={inCase} role="dialog" aria-modal="true" aria-label="Secret games">
  <button class="close" type="button" aria-label="Close" onclick={onclose}>
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 3l10 10M13 3L3 13"></path></svg>
  </button>
  <p class="title">PICK A GAME</p>
  <div class="list" bind:this={list}>
    {#each games as game (game.id)}
      <button class="game" type="button" onclick={() => pick(game.id)}>
        <span class="game__name">{game.name}</span>
        <span class="game__line">{game.line}</span>
      </button>
    {/each}
  </div>
</div>

<style>
  .picker {
    position: fixed;
    inset: 0;
    z-index: 40;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--s-4);
    padding: calc(var(--safe-top) + var(--s-4)) var(--s-4) calc(var(--safe-bottom) + var(--s-4));
    background: var(--c-bg);
    color: var(--c-text);
  }
  .picker--case {
    position: absolute;
    gap: var(--s-2);
    padding: var(--s-2);
  }
  .close {
    position: absolute;
    top: calc(var(--safe-top) + var(--s-1));
    left: var(--s-2);
    display: flex;
    align-items: center;
    justify-content: center;
    width: var(--tap);
    height: var(--tap);
    border: 0;
    border-radius: var(--r-md);
    background: transparent;
    color: var(--c-text);
    cursor: pointer;
  }
  .close svg {
    stroke: currentColor;
    stroke-width: 1.8;
    stroke-linecap: round;
  }
  .title {
    margin: 0;
    color: var(--c-text-muted);
    font-size: var(--fs-sm);
    letter-spacing: 0.2em;
  }
  .list {
    display: flex;
    flex-direction: column;
    gap: var(--s-3);
    width: min(100%, 360px);
  }
  .game {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--s-1);
    padding: var(--s-4);
    border: 0;
    border-radius: var(--r-xl);
    background: var(--c-surface);
    box-shadow: var(--shadow-dialog);
    color: var(--c-text);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .picker--case .game {
    padding: var(--s-2) var(--s-3);
  }
  .game:focus-visible,
  .picker--case .game:focus {
    outline: 2px solid var(--c-accent-text);
    outline-offset: 2px;
  }
  .game__name {
    font-size: var(--fs-2xl);
    font-weight: 700;
    letter-spacing: 0.06em;
  }
  .game__line {
    color: var(--c-text-muted);
    font-size: var(--fs-md);
    line-height: 1.4;
  }
  .picker--case .game__line {
    font-size: var(--fs-xs);
  }
</style>
