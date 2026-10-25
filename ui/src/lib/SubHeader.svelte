<!-- The top of a screen one level down: Back, its title, and an optional
     badge on the right. Holding a finger on it (not on Back) opens the
     secret game. -->
<script lang="ts">
  import type { Snippet } from 'svelte';

  import { secretDoor } from '../features/game/door.svelte';

  let {
    back,
    backLabel,
    title,
    badge,
  }: { back: string; backLabel: string; title: string; badge?: Snippet } = $props();
</script>

<header class="head" use:secretDoor>
  <a class="back" href={back} data-back>
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
      ><path d="M15 18l-6-6 6-6"></path></svg
    >
    <span class="back__label">{backLabel}</span>
  </a>
  <h1>{title}</h1>
  <span class="badge">{#if badge}{@render badge()}{/if}</span>
</header>

<style>
  /* The title takes the room it needs between two sides, so it stays
     centred; Back keeps enough for a short label and the badge all of its
     own. Long labels and titles end in an ellipsis instead of running into
     each other. */
  .head {
    display: grid;
    grid-template-columns: minmax(5.5rem, 1fr) minmax(0, max-content) minmax(max-content, 1fr);
    align-items: center;
    gap: var(--s-2);
    padding: var(--s-5) var(--s-2) 0;
  }
  .back {
    justify-self: start;
    display: flex;
    align-items: center;
    gap: 2px;
    min-width: 0;
    max-width: 100%;
    height: var(--tap);
    padding: 0 var(--s-2);
    overflow: hidden;
    border-radius: var(--r-md);
    color: var(--c-accent-text);
    font-size: var(--fs-lg);
    font-weight: 500;
    text-decoration: none;
    white-space: nowrap;
  }
  .back:hover {
    background: var(--c-surface-2);
  }
  .back svg {
    flex: 0 0 auto;
  }
  .back__label {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  h1 {
    min-width: 0;
    margin: 0;
    overflow: hidden;
    font-size: var(--fs-2xl);
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  /* As wide as Back's side at least, so the title stays centred. */
  .badge {
    display: flex;
    justify-content: flex-end;
    min-width: 5.5rem;
    padding-right: var(--s-2);
  }
</style>
