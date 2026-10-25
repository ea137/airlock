<!-- Vector display: the phone and the laptop drawn in glowing lines with
     the link running between them, the screen's name, and the sections as
     outlined boxes. -->
<script lang="ts">
  import { hrefFor } from '../router.svelte';
  import type { Section } from '../routes';
  import { SECTION_LINKS, sectionLabel } from '../sections';
  import ThemeLink from './ThemeLink.svelte';

  let { current, host }: { current: Section; host: string | null } = $props();
</script>

<header class="head">
  <div class="art">
    <svg width="100%" height="92" viewBox="0 0 350 104" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      <rect x="18" y="6" width="50" height="90" rx="8"></rect>
      <path d="M36 12h14"></path>
      <rect x="24" y="20" width="38" height="64"></rect>
      <path d="M29 28l6 4-6 4M39 38h14"></path>
      <path d="M214 14h104v62H214z"></path>
      <path d="M196 86h140l-10 12H206z"></path>
      <path d="M222 24l8 6-8 6M234 40h30M222 50h56"></path>
      <path class="link" d="M74 54C116 22 160 82 208 48"></path>
      <path d="M204 42l6 6-8 3"></path>
    </svg>
    <ThemeLink />
  </div>
  <h1>{sectionLabel(current)}</h1>
  <p>{(host ?? 'laptop').toLowerCase()} · tailnet</p>
</header>

<nav class="sections" aria-label="Sections">
  {#each SECTION_LINKS as section (section.id)}
    <a class="section" href={hrefFor(section.route)} aria-current={section.id === current ? 'page' : undefined}>{section.label}</a>
  {/each}
</nav>

<style>
  .head {
    padding: var(--s-4) var(--s-5) var(--s-3);
  }
  .art {
    display: flex;
    align-items: flex-start;
  }
  svg {
    flex: 1;
    fill: none;
    stroke: var(--c-accent);
    stroke-width: 1.5;
    stroke-linejoin: round;
    filter: drop-shadow(0 0 3px var(--c-accent));
  }
  .link {
    stroke-dasharray: 6 6;
  }
  :global(:root[data-motion='on']) .link {
    animation: flow 1.2s linear infinite;
  }
  @keyframes flow {
    to {
      stroke-dashoffset: -24;
    }
  }
  h1 {
    margin: var(--s-2) 0 0;
    font-size: 34px;
    letter-spacing: 2px;
    text-shadow: 0 0 6px var(--c-accent);
  }
  p {
    margin: var(--s-1) 0 0;
    font-size: var(--fs-sm);
  }
  .sections {
    display: grid;
    grid-auto-columns: minmax(min-content, 1fr);
    grid-auto-flow: column;
    gap: var(--s-2);
    margin: 0 var(--s-5) var(--s-4);
  }
  .section {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 38px;
    padding: 0 var(--s-1);
    border: 1px solid var(--c-line);
    color: var(--c-text);
    font-size: var(--fs-md);
    text-decoration: none;
  }
  .section[aria-current='page'] {
    border-color: var(--c-accent);
    box-shadow:
      0 0 8px rgb(159 252 255 / 0.7),
      inset 0 0 8px rgb(159 252 255 / 0.25);
  }
</style>
