<!-- Handheld console (and the Game Boy's screen): a framed title with a
     pixel console, then the sections as thick-bordered buttons. -->
<script lang="ts">
  import { hrefFor } from '../router.svelte';
  import type { Section } from '../routes';
  import { SECTION_LINKS, sectionLabel } from '../sections';
  import ThemeLink from './ThemeLink.svelte';

  let { current, host }: { current: Section; host: string | null } = $props();
</script>

<header class="head">
  <svg class="console" width="40" height="32" viewBox="0 0 20 16" shape-rendering="crispEdges" aria-hidden="true"
    ><rect x="3" y="1" width="14" height="10" class="ink"></rect><rect x="4" y="2" width="12" height="8" class="paper"
    ></rect><rect x="5" y="4" width="3" height="1" class="ink"></rect><rect x="5" y="6" width="5" height="1" class="mid"
    ></rect><rect x="1" y="12" width="18" height="2" class="ink"></rect><rect x="2" y="11" width="16" height="1" class="mid"
    ></rect></svg
  >
  <div class="title">
    <h1>{sectionLabel(current)}</h1>
    <p>{(host ?? 'laptop').toUpperCase()} · LINKED</p>
  </div>
  <ThemeLink />
</header>

<nav class="sections" aria-label="Sections">
  {#each SECTION_LINKS as section (section.id)}
    <a class="section" href={hrefFor(section.route)} aria-current={section.id === current ? 'page' : undefined}>
      {#if section.id === 'home'}
        <!-- A pixel house, so the four named sections fit the console's screen. -->
        <svg class="house" width="16" height="16" viewBox="0 0 8 8" shape-rendering="crispEdges" aria-hidden="true"
          ><path d="M3 0h2v1h1v1h1v1h1v1H7v4H5V5H3v3H1V4H0V3h1V2h1V1h1z"></path></svg
        >
        <span class="visually-hidden">{section.label}</span>
      {:else}
        {section.label}
      {/if}
    </a>
  {/each}
</nav>

<style>
  .head {
    display: flex;
    align-items: center;
    gap: var(--s-3);
    margin: var(--s-3) var(--s-3) var(--s-2);
    padding: 10px var(--s-3);
    border: 4px solid var(--c-text);
    border-radius: var(--r-lg);
    background: var(--c-surface);
  }
  .console {
    flex: 0 0 auto;
  }
  .ink {
    fill: var(--c-text);
  }
  .paper {
    fill: var(--c-bg);
  }
  .mid {
    fill: var(--c-text-muted);
  }
  .title {
    flex: 1;
    min-width: 0;
  }
  h1 {
    margin: 0;
    font-size: 14px;
    font-weight: 400;
    line-height: 1.7;
  }
  p {
    margin: 0;
    overflow: hidden;
    font-size: var(--fs-sm);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .sections {
    display: grid;
    grid-template-columns: auto;
    grid-auto-columns: minmax(min-content, 1fr);
    grid-auto-flow: column;
    gap: var(--s-1);
    margin: 0 var(--s-3) var(--s-3);
  }
  .section {
    display: flex;
    align-items: center;
    justify-content: center;
    min-width: 36px;
    height: 36px;
    padding: 0 3px;
    border: 3px solid var(--c-line);
    border-radius: var(--r-lg);
    color: var(--c-text);
    font-size: var(--fs-sm);
    text-decoration: none;
    text-transform: uppercase;
  }
  .section[aria-current='page'] {
    border-color: var(--c-text);
    background: var(--c-text);
    color: var(--c-bg);
  }
  .house {
    fill: currentColor;
  }
</style>
