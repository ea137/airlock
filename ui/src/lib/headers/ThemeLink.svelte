<!-- The way to Settings (the theme, Ask Claude's model, the game's sound): a
     set of sliders, or the theme's own word for it. -->
<script lang="ts">
  import type { Snippet } from 'svelte';

  import { hrefFor } from '../router.svelte';

  let { children }: { children?: Snippet } = $props();
</script>

<a class="theme" class:theme--text={children} href={hrefFor({ name: 'theme' })} aria-label="Settings">
  {#if children}
    {@render children()}
  {:else}
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      ><path d="M4 7h10M18 7h2M4 17h4M12 17h8"></path><circle cx="16" cy="7" r="2"></circle><circle cx="10" cy="17" r="2"
      ></circle></svg
    >
  {/if}
</a>

<style>
  /* A 44px target that doesn't push its row taller. */
  .theme {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    justify-content: center;
    min-width: var(--tap);
    height: var(--tap);
    margin: calc(var(--s-3) * -1) calc(var(--s-2) * -1);
    border-radius: var(--r-md);
    color: var(--c-accent-text);
    text-decoration: none;
    transition-property: background-color;
    transition-duration: var(--t-hover);
  }
  .theme--text {
    padding: 0 var(--s-2);
  }
  .theme:hover,
  .theme:active {
    background: var(--c-surface-2);
  }
</style>
