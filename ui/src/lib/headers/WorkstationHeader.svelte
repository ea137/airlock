<!-- 90s workstation: a window's title bar, its menu box opening the theme
     picker, and the sections as a row of bevelled dock buttons. -->
<script lang="ts">
  import { hrefFor } from '../router.svelte';
  import type { Section } from '../routes';
  import { SECTION_LINKS, sectionLabel } from '../sections';
  import ThemeLink from './ThemeLink.svelte';

  let { current, host }: { current: Section; host: string | null } = $props();

  /** Pixel icons on a 20 by 17 grid, as the dock draws them. */
  const ICON: Record<Section, string> = {
    home: 'M2 8.5l8-7 8 7M4 7v8.5h12V7M8 15.5v-5h4v5',
    terminals: 'M1.5 1.5h17v11h-17zM4 4h5v1H4zM4 6h8v1H4zM6 13h8v3H6z',
    center: 'M1.5 5.5h17v10h-17zM7 5.5v-3h6v3M1.5 10h17',
    system: 'M1 9h4l2-6 3 12 2-6h7',
    files: 'M1.5 3.5h6l1.5 2h9.5v10h-17zM1.5 7.5h17',
  };
</script>

<header class="bar">
  <ThemeLink><span class="box" aria-hidden="true"></span></ThemeLink>
  <div class="title">
    <h1>{sectionLabel(current)}</h1>
    <span class="host">— {(host ?? 'laptop').toLowerCase()}</span>
  </div>
  <span class="box box--end" aria-hidden="true"></span>
</header>

<nav class="dock" aria-label="Sections">
  {#each SECTION_LINKS as section (section.id)}
    <a class="tool" href={hrefFor(section.route)} aria-current={section.id === current ? 'page' : undefined}>
      <svg width="30" height="26" viewBox="0 0 20 17" shape-rendering="crispEdges" aria-hidden="true"
        ><path d={ICON[section.id]}></path></svg
      >
      {section.label}
    </a>
  {/each}
</nav>

<style>
  .bar {
    display: flex;
    align-items: center;
    gap: var(--s-1);
    height: 28px;
    padding: 0 var(--s-1);
    background: var(--c-ws-title);
    color: var(--c-ws-title-text);
  }
  .bar :global(.theme) {
    min-width: 28px;
    height: 28px;
    margin: 0;
    border-radius: 0;
  }
  .box {
    display: block;
    width: 16px;
    height: 16px;
    background: var(--c-ws-face);
    box-shadow:
      inset 1px 1px var(--c-ws-light),
      inset -1px -1px var(--c-ws-shade);
  }
  .box--end {
    margin: 0 6px;
  }
  .title {
    flex: 1;
    min-width: 0;
    display: flex;
    justify-content: center;
    gap: 0.3em;
    overflow: hidden;
    font-size: var(--fs-md);
    font-weight: 600;
    white-space: nowrap;
  }
  h1 {
    margin: 0;
    font-size: inherit;
    font-weight: inherit;
  }
  .host {
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .dock {
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    margin: var(--s-2) var(--s-2) var(--s-3);
  }
  .tool {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 2px;
    height: 60px;
    background: var(--c-ws-face);
    color: var(--c-text);
    font-size: var(--fs-sm);
    text-decoration: none;
    box-shadow:
      inset 1px 1px var(--c-ws-light),
      inset -1px -1px var(--c-ws-dark),
      inset -2px -2px var(--c-ws-shade);
  }
  .tool svg {
    fill: none;
    stroke: var(--c-text);
  }
  .tool[aria-current='page'] {
    background: var(--c-ws-lit);
    box-shadow:
      inset 1px 1px var(--c-ws-dark),
      inset 2px 2px var(--c-ws-shade),
      inset -1px -1px var(--c-ws-light);
  }
</style>
