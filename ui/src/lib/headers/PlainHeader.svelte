<!-- The current look: the laptop's name and the theme button on one row,
     then the sections. The screen's name is for screen readers; the
     sections already show it. -->
<script lang="ts">
  import { hrefFor } from '../router.svelte';
  import type { Section } from '../routes';
  import { SECTION_LINKS, sectionLabel } from '../sections';
  import ThemeLink from './ThemeLink.svelte';

  let { current, host }: { current: Section; host: string | null } = $props();
</script>

<header class="head">
  <h1 class="visually-hidden">{sectionLabel(current)}</h1>
  <span class="host">
    {#if host}<span class="host__dot" aria-hidden="true"></span>{host}{/if}
  </span>
  <ThemeLink />
</header>

<nav class="sections" aria-label="Sections">
  {#each SECTION_LINKS as section (section.id)}
    <a class="section" href={hrefFor(section.route)} aria-current={section.id === current ? 'page' : undefined}>
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"><path d={section.icon}></path></svg
      >
      <!-- Home is the house alone, so the four named sections keep their room. -->
      <span class:visually-hidden={section.id === 'home'}>{section.label}</span>
    </a>
  {/each}
</nav>

<style>
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--s-3) var(--s-4) var(--s-2);
  }
  .host {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    color: var(--c-text-muted);
    font-size: var(--fs-md);
    font-weight: 600;
  }
  .host__dot {
    width: 8px;
    height: 8px;
    border-radius: var(--r-pill);
    background: var(--c-ok);
  }
  .sections {
    display: grid;
    grid-template-columns: auto;
    grid-auto-columns: minmax(min-content, 1fr);
    grid-auto-flow: column;
    gap: 2px;
    margin: 0 var(--s-4) var(--s-3);
    padding: 3px;
    border-radius: var(--r-lg);
    background: var(--c-surface-2);
    font-size: var(--fs-md);
  }
  .section {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--s-2);
    min-width: 38px;
    height: 38px;
    padding: 0 var(--s-1);
    border-radius: var(--r-md);
    color: var(--c-text-muted);
    font-weight: 600;
    text-decoration: none;
    white-space: nowrap;
    transition-property: background-color, color;
    transition-duration: var(--t-hover);
  }
  .section:hover {
    color: var(--c-text);
  }
  .section[aria-current='page'] {
    background: var(--c-surface-hover);
    color: var(--c-text);
  }
  /* Wide pixel faces need the room the icons take. */
  .section svg {
    display: var(--section-icons);
  }
</style>
