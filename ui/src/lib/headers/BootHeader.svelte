<!-- 8-bit: a home computer's start-up banner, the sections as menu words,
     the chosen one in reverse. -->
<script lang="ts">
  import { hrefFor } from '../router.svelte';
  import type { Section } from '../routes';
  import { SECTION_LINKS, sectionLabel } from '../sections';
  import ThemeLink from './ThemeLink.svelte';

  let { current, host }: { current: Section; host: string | null } = $props();
</script>

<header class="head">
  <p class="banner">**** {(host ?? 'laptop').toUpperCase()} REMOTE ****</p>
  <h1>{sectionLabel(current)}</h1>
</header>

<nav class="sections" aria-label="Sections">
  {#each SECTION_LINKS as section (section.id)}
    <a class="section" href={hrefFor(section.route)} aria-current={section.id === current ? 'page' : undefined}>{section.label}</a>
  {/each}
  <ThemeLink>SETUP</ThemeLink>
</nav>

<style>
  .head {
    padding: var(--s-4) var(--s-3) 0;
    text-align: center;
    line-height: 1.9;
  }
  .banner {
    margin: 0;
    overflow: hidden;
    font-size: var(--fs-base);
    white-space: nowrap;
  }
  h1 {
    margin: 0;
    font-size: var(--fs-base);
    font-weight: 400;
    text-transform: uppercase;
  }
  .sections {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: var(--s-1) var(--s-2);
    margin: var(--s-3) var(--s-3) var(--s-3);
    font-size: var(--fs-md);
  }
  .section {
    display: flex;
    align-items: center;
    min-height: 32px;
    padding: 0 var(--s-1);
    color: var(--c-text);
    text-decoration: none;
    text-transform: uppercase;
  }
  .section:hover {
    background: var(--c-surface-2);
  }
  .section[aria-current='page'] {
    background: var(--c-text);
    color: var(--c-bg);
  }
  .sections :global(.theme) {
    margin: 0;
    min-width: 0;
    height: 32px;
    color: var(--c-accent-text);
    font-size: var(--fs-md);
  }
</style>
