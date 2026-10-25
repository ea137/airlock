<!-- A sheet that slides up over the screen: new terminal, tab options,
     confirmations. Tapping outside or Escape closes it. It sits in the app's
     box, which ends where the iPhone's keyboard begins, so the keyboard
     never covers it; and it opens with focus on itself, so the keyboard
     only comes up when you tap a field. -->
<script lang="ts">
  import type { Snippet } from 'svelte';

  let { title, onclose, children }: { title: string; onclose: () => void; children: Snippet } = $props();

  const titleId = `sheet-${Math.random().toString(36).slice(2, 10)}`;
  let panel: HTMLElement | undefined = $state();

  $effect(() => {
    panel?.focus();
  });

  function onkeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') onclose();
  }
</script>

<svelte:window {onkeydown} />

<button class="scrim" type="button" tabindex="-1" aria-label="Close" onclick={onclose}></button>
<div bind:this={panel} class="sheet" role="dialog" aria-modal="true" aria-labelledby={titleId} tabindex="-1">
  <div class="grabber" aria-hidden="true"></div>
  <header class="sheet__head">
    <h2 id={titleId}>{title}</h2>
    <button class="btn btn--quiet sheet__close" type="button" onclick={onclose}>Cancel</button>
  </header>
  {@render children()}
</div>

<style>
  .scrim {
    position: absolute;
    inset: 0;
    z-index: 20;
    border: 0;
    padding: 0;
    background: var(--c-scrim);
  }
  .sheet {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 21;
    display: flex;
    flex-direction: column;
    gap: var(--s-4);
    max-height: 90%;
    overflow-y: auto;
    padding: var(--s-2) var(--s-4) calc(var(--s-6) + var(--safe-bottom));
    border-radius: var(--r-2xl) var(--r-2xl) 0 0;
    background: var(--c-surface);
    box-shadow: var(--shadow-sheet);
    animation: rise var(--t-enter) var(--ease);
  }
  .sheet:focus {
    outline: none;
  }
  /* Its parts keep their height; the sheet scrolls instead. */
  .sheet > :global(*) {
    flex-shrink: 0;
  }
  @keyframes rise {
    from {
      transform: translateY(24px);
      opacity: 0;
    }
  }
  .grabber {
    align-self: center;
    width: 36px;
    height: 5px;
    border-radius: var(--r-pill);
    background: var(--c-surface-hover);
  }
  .sheet__head {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  h2 {
    margin: 0;
    font-size: var(--fs-2xl);
    font-weight: 600;
  }
</style>
