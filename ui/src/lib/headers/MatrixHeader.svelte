<!-- Matrix: the link's status as a prompt, the screen's name glowing, and
     the sections in a bordered bar. -->
<script lang="ts">
  import { hrefFor } from '../router.svelte';
  import type { Section } from '../routes';
  import { SECTION_LINKS, sectionLabel } from '../sections';
  import ThemeLink from './ThemeLink.svelte';

  let { current, host }: { current: Section; host: string | null } = $props();
</script>

<header class="head">
  <p class="status">&gt; link: {(host ?? 'laptop').toLowerCase()} · tailnet · secure<span class="cursor" aria-hidden="true">_</span></p>
  <div class="title">
    <h1>{sectionLabel(current)}</h1>
    <ThemeLink />
  </div>
</header>

<nav class="sections" aria-label="Sections">
  {#each SECTION_LINKS as section (section.id)}
    <a class="section" href={hrefFor(section.route)} aria-current={section.id === current ? 'page' : undefined}>{section.label}</a>
  {/each}
</nav>

<style>
  .head {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: var(--s-4) var(--s-4) var(--s-3);
  }
  .status {
    margin: 0;
    color: var(--c-text-muted);
    font-size: var(--fs-sm);
  }
  :global(:root[data-motion='on']) .cursor {
    animation: blink 1s steps(1) infinite;
  }
  @keyframes blink {
    50% {
      opacity: 0;
    }
  }
  .title {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  h1 {
    margin: 0;
    font-size: 34px;
    font-weight: 400;
    letter-spacing: 6px;
    text-transform: uppercase;
    text-shadow: 0 0 10px rgb(0 255 65 / 0.7);
  }
  .sections {
    display: grid;
    grid-auto-columns: minmax(min-content, 1fr);
    grid-auto-flow: column;
    margin: 0 var(--s-4) var(--s-3);
    border: 1px solid var(--c-accent);
    background: rgb(0 0 0 / 0.85);
  }
  .section {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 42px;
    padding: 0 var(--s-1);
    color: var(--c-accent);
    font-size: var(--fs-md);
    letter-spacing: 2px;
    text-decoration: none;
    text-transform: uppercase;
    transition-property: background-color, color;
    transition-duration: var(--t-hover);
  }
  .section:hover {
    background: var(--c-surface-2);
  }
  .section[aria-current='page'] {
    background: var(--c-accent);
    color: var(--c-on-accent);
  }
</style>
