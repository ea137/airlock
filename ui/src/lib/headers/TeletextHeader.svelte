<!-- Teletext: a page header with its number and the time, the screen's
     name in double height on a blue band, and the sections as pages: Home
     is the index, page 100, then the four coloured keys. -->
<script lang="ts">
  import { hrefFor } from '../router.svelte';
  import type { Section } from '../routes';
  import { SECTION_LINKS, sectionLabel } from '../sections';
  import ThemeLink from './ThemeLink.svelte';

  let { current, host }: { current: Section; host: string | null } = $props();

  /** Each section is a page, in the hundreds. */
  const PAGE: Record<Section, number> = { home: 100, terminals: 101, center: 201, system: 301, files: 401 };
  /** The index in white, then the four coloured keys of a teletext remote. */
  const KEY: Record<Section, string> = {
    home: 'white',
    terminals: 'red',
    center: 'green',
    system: 'yellow',
    files: 'cyan',
  };
  const MOSAIC_TOP = '▄▀▄█▀▄▄█▀▀▄█▄▀▄▄█▀▄▀█▄▄▀▀▄█▀▄▄▀█▄▀▄▄█▀▀▄█';
  const MOSAIC_BOTTOM = '▀▄▀█▄▀▀█▄▄▀█▀▄▀▀█▄▀▄█▀▀▄▄█▀▄▀█▄▀▀▄█▄▀▀█▄▀';

  let now = $state(new Date());
  $effect(() => {
    const timer = setInterval(() => (now = new Date()), 15_000);
    return () => clearInterval(timer);
  });

  const clock = $derived(
    `${now.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })} ${now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`,
  );
</script>

<header class="head">
  <div class="line">
    <span>P{PAGE[current]}</span>
    <span class="host">{(host ?? 'laptop').toUpperCase()}</span>
    <span class="clock">{clock}</span>
    <ThemeLink />
  </div>
  <div class="mosaic mosaic--top" aria-hidden="true">{MOSAIC_TOP}</div>
  <h1><span>{sectionLabel(current)}</span></h1>
  <div class="mosaic mosaic--bottom" aria-hidden="true">{MOSAIC_BOTTOM}</div>
</header>

<nav class="sections" aria-label="Sections">
  {#each SECTION_LINKS as section (section.id)}
    <a
      class={`section section--${KEY[section.id]}`}
      href={hrefFor(section.route)}
      aria-current={section.id === current ? 'page' : undefined}
      ><span class="page" aria-hidden="true">{PAGE[section.id]}</span>{section.label}</a
    >
  {/each}
</nav>

<style>
  /* Room above for the theme button's tap area, which reaches 12px out. */
  .head {
    padding: var(--s-3) var(--s-2) 0;
  }
  .line {
    display: flex;
    align-items: center;
    gap: var(--s-3);
    line-height: 1.15;
  }
  .host {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .clock {
    color: var(--c-tt-yellow);
    white-space: nowrap;
  }
  .mosaic {
    overflow: hidden;
    letter-spacing: -1px;
    line-height: 1.15;
    white-space: nowrap;
  }
  .mosaic--top {
    margin-top: var(--s-2);
    color: var(--c-tt-cyan);
  }
  .mosaic--bottom {
    color: var(--c-tt-magenta);
  }
  /* Double height, as teletext draws a title. */
  h1 {
    margin: 0;
    padding: var(--s-2) var(--s-2) 22px;
    background: var(--c-tt-blue);
    color: var(--c-tt-yellow);
    font-size: var(--fs-xl);
    font-weight: 400;
    line-height: 1;
    text-transform: uppercase;
  }
  h1 span {
    display: inline-block;
    letter-spacing: 2px;
    transform: scaleY(2);
    transform-origin: top left;
  }
  .sections {
    display: grid;
    grid-template-columns: auto repeat(4, minmax(0, 1fr));
    margin: var(--s-2) var(--s-2) var(--s-3);
  }
  .section {
    display: flex;
    flex-direction: column;
    justify-content: center;
    min-height: var(--tap);
    padding: 0 var(--s-1);
    line-height: 1;
    text-decoration: none;
  }
  .page {
    color: var(--c-tt-white);
    font-size: var(--fs-sm);
  }
  .section--white {
    --key: var(--c-tt-white);
  }
  .section--red {
    --key: var(--c-tt-red);
  }
  .section--green {
    --key: var(--c-tt-green);
  }
  .section--yellow {
    --key: var(--c-tt-yellow);
  }
  .section--cyan {
    --key: var(--c-tt-cyan);
  }
  .section {
    color: var(--key);
  }
  .section[aria-current='page'] {
    background: var(--key);
  }
  .section[aria-current='page'],
  .section[aria-current='page'] .page {
    color: var(--c-tt-black);
  }
</style>
