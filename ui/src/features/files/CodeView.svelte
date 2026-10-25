<!-- Source code with line numbers and syntax colours. Long lines scroll
     sideways; the numbers stay put. -->
<script lang="ts">
  import type { highlight as Highlight } from './highlight';

  let { text, language }: { text: string; language: string | null | undefined } = $props();

  // highlight.js loads the first time code in a known language is shown,
  // rather than with the app; until then the code shows plain.
  let highlight = $state.raw<typeof Highlight | null>(null);
  $effect(() => {
    if (!language || highlight) return;
    import('./highlight').then(
      (module) => (highlight = module.highlight),
      () => {
        // Plain, then: the colours are a nicety.
      },
    );
  });

  const lineCount = $derived(Math.max(1, text.split('\n').length - (text.endsWith('\n') ? 1 : 0)));
  const numbers = $derived(Array.from({ length: lineCount }, (_, i) => i + 1).join('\n'));
  const coloured = $derived(highlight ? highlight(text, language) : null);
</script>

<div class="code" role="region" aria-label="Source">
  <pre class="gutter" aria-hidden="true">{numbers}</pre>
  {#if coloured !== null}
    <!-- highlight.js escapes the code; only its own spans are markup. -->
    <pre class="lines"><code>{@html coloured}</code></pre>
  {:else}
    <pre class="lines"><code>{text}</code></pre>
  {/if}
</div>

<style>
  .code {
    display: grid;
    grid-template-columns: auto 1fr;
    overflow: auto;
    padding: var(--s-3) 0;
    border-radius: var(--r-lg);
    background: var(--c-code-bg);
    color: var(--c-code);
    font: var(--fs-sm) / 1.55 var(--font-mono);
    -webkit-user-select: text;
    user-select: text;
  }
  pre {
    margin: 0;
    font: inherit;
    white-space: pre;
  }
  .gutter {
    position: sticky;
    left: 0;
    padding: 0 var(--s-3) 0 var(--s-2);
    background: var(--c-code-bg);
    color: var(--c-text-faint);
    text-align: right;
    -webkit-user-select: none;
    user-select: none;
  }
  .lines {
    padding-right: var(--s-3);
  }
  .lines :global(.hljs-keyword),
  .lines :global(.hljs-built_in),
  .lines :global(.hljs-selector-tag),
  .lines :global(.hljs-type) {
    color: var(--c-syn-keyword);
  }
  .lines :global(.hljs-string),
  .lines :global(.hljs-regexp),
  .lines :global(.hljs-subst) {
    color: var(--c-syn-string);
  }
  .lines :global(.hljs-comment),
  .lines :global(.hljs-quote) {
    color: var(--c-syn-comment);
    font-style: italic;
  }
  .lines :global(.hljs-number),
  .lines :global(.hljs-literal),
  .lines :global(.hljs-variable),
  .lines :global(.hljs-template-variable) {
    color: var(--c-syn-number);
  }
  .lines :global(.hljs-title),
  .lines :global(.hljs-section) {
    color: var(--c-syn-title);
  }
  .lines :global(.hljs-attr),
  .lines :global(.hljs-attribute),
  .lines :global(.hljs-name),
  .lines :global(.hljs-addition) {
    color: var(--c-syn-attr);
  }
  .lines :global(.hljs-meta),
  .lines :global(.hljs-symbol),
  .lines :global(.hljs-bullet) {
    color: var(--c-syn-meta);
  }
  .lines :global(.hljs-deletion) {
    color: var(--c-del);
  }
</style>
