<script lang="ts" module>
  const open = $state<{ id: string | null }>({ id: null });
</script>

<script lang="ts">
  let { title, text }: { title: string; text: string } = $props();

  const id = `help-${Math.random().toString(36).slice(2, 10)}`;
  const shown = $derived(open.id === id);

  function toggle(event: MouseEvent) {
    event.stopPropagation();
    open.id = shown ? null : id;
  }

  function onkeydown(event: KeyboardEvent) {
    if (shown && event.key === 'Escape') open.id = null;
  }
</script>

<svelte:window {onkeydown} />

<button
  class="ask"
  type="button"
  aria-label={`What is ${title.toLowerCase()}?`}
  aria-expanded={shown}
  aria-controls={id}
  onclick={toggle}>?</button
>

{#if shown}
  <button class="away" type="button" tabindex="-1" aria-label="Close the explanation" onclick={() => (open.id = null)}
  ></button>
  <div {id} class="card" role="note" aria-label={title}>
    <strong>{title}</strong>
    <p>{text}</p>
  </div>
{/if}

<style>
  .ask {
    position: relative;
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    margin: 0 2px;
    padding: 0;
    border: 0;
    border-radius: var(--r-pill);
    background: var(--c-surface-3);
    color: var(--c-text-soft);
    font: 700 11px / 1 var(--font-ui);
    vertical-align: middle;
    cursor: pointer;
  }
  /* A 24px target around the small mark: any larger, and it covers the
     value it sits next to. */
  .ask::after {
    content: '';
    position: absolute;
    inset: -3px;
  }
  .ask[aria-expanded='true'] {
    background: var(--c-accent);
    color: var(--c-on-accent);
  }
  .away {
    position: fixed;
    inset: 0;
    z-index: 40;
    border: 0;
    background: transparent;
  }
  .card {
    position: fixed;
    left: var(--s-3);
    right: var(--s-3);
    bottom: calc(var(--s-4) + var(--safe-bottom));
    z-index: 41;
    display: flex;
    flex-direction: column;
    gap: var(--s-1);
    padding: var(--s-3) var(--s-4);
    border-radius: var(--r-xl);
    background: var(--c-surface-2);
    box-shadow: var(--shadow-dialog);
    color: var(--c-text);
    font-size: var(--fs-md);
    font-weight: 400;
    line-height: 1.45;
    text-align: left;
    text-transform: none;
    letter-spacing: 0;
    animation: rise var(--t-enter) var(--ease);
  }
  .card strong {
    font-size: var(--fs-lg);
  }
  .card p {
    margin: 0;
    color: var(--c-text-soft);
  }
  @keyframes rise {
    from {
      transform: translateY(12px);
      opacity: 0;
    }
  }
</style>
