<!-- The terminal's text, its history included, selectable: wrapped to the
     phone's width so a selection doesn't run off the side, and opened at
     the newest lines. A button copies all of it. -->
<script lang="ts">
  let { text, onclose }: { text: string; onclose: () => void } = $props();

  let notice = $state<string | null>(null);
  let box: HTMLElement | undefined = $state();

  $effect(() => {
    if (box) box.scrollTop = box.scrollHeight;
  });

  async function copyAll() {
    try {
      await navigator.clipboard.writeText(text);
      onclose();
    } catch (error) {
      notice = `Couldn't copy: ${(error as Error).message}. Select the text instead.`;
    }
  }
</script>

<section class="copy" aria-label="Copy text">
  <pre bind:this={box}>{text}</pre>
  {#if notice}<p class="error-text" role="alert">{notice}</p>{/if}
  <div class="actions">
    <button class="btn" type="button" onclick={onclose}>Close</button>
    <button class="btn btn--primary" type="button" onclick={copyAll}>Copy all</button>
  </div>
</section>

<style>
  .copy {
    position: fixed;
    inset: 0;
    z-index: 30;
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
    padding: calc(var(--s-2) + var(--safe-top)) var(--s-2) calc(var(--s-2) + var(--safe-bottom));
    background: var(--c-bg);
  }
  pre {
    flex: 1;
    margin: 0;
    padding: var(--s-2);
    overflow: auto;
    border-radius: var(--r-md);
    background: var(--c-terminal);
    color: var(--c-terminal-text);
    font: var(--fs-sm) var(--font-terminal);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    -webkit-user-select: text;
    user-select: text;
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--s-2);
  }
</style>
