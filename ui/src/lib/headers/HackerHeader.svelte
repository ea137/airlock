<!-- Hacker: a tmux status line whose windows are the sections, the screen's
     name in block letters with a glitch, and the link from this phone to
     the laptop. -->
<script lang="ts">
  import { hrefFor } from '../router.svelte';
  import type { Section } from '../routes';
  import { SECTION_LINKS, sectionLabel } from '../sections';
  import { banner } from './banner';
  import ThemeLink from './ThemeLink.svelte';

  let { current, host }: { current: Section; host: string | null } = $props();

  const name = $derived(host ?? 'laptop');
  const rows = $derived(banner(sectionLabel(current)).join('\n'));

  let now = $state(new Date());
  $effect(() => {
    const timer = setInterval(() => (now = new Date()), 15_000);
    return () => clearInterval(timer);
  });
  const clock = $derived(now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }));
</script>

<header class="head">
  <nav class="tmux" aria-label="Sections">
    <span class="session" aria-hidden="true">[0]</span>
    {#each SECTION_LINKS as section, index (section.id)}
      <a class="window" href={hrefFor(section.route)} aria-current={section.id === current ? 'page' : undefined}
        ><span aria-hidden="true">{index}:</span>{section.label}<span aria-hidden="true"
          >{section.id === current ? '*' : ''}</span
        ></a
      >
    {/each}
    <span class="clock" aria-hidden="true">{clock}</span>
  </nav>

  <div class="title">
    <h1 class="visually-hidden">{sectionLabel(current)}</h1>
    <div class="banner" aria-hidden="true">
      <pre>{rows}</pre>
      <pre class="glitch">{rows}</pre>
    </div>
    <ThemeLink>[t]</ThemeLink>
  </div>

  <div class="link">
    <span>PHONE ◉</span>
    <span class="wire"><span class="packet" aria-hidden="true">▸</span></span>
    <span class="hop">TAILNET</span>
    <span class="wire"></span>
    <span>◉ {name.toUpperCase()}</span>
  </div>
</header>

<style>
  .head {
    display: flex;
    flex-direction: column;
    gap: var(--s-3);
    padding-bottom: var(--s-3);
  }
  .tmux {
    display: flex;
    align-items: stretch;
    min-height: 32px;
    overflow-x: auto;
    background: var(--c-surface-2);
    font-size: var(--fs-xs);
    white-space: nowrap;
  }
  .session {
    display: flex;
    align-items: center;
    padding: 0 6px;
    background: var(--c-accent);
    color: var(--c-on-accent);
    font-weight: 700;
  }
  .window {
    display: flex;
    align-items: center;
    padding: 0 3px;
    color: var(--c-text-muted);
    text-decoration: none;
    text-transform: lowercase;
  }
  .window[aria-current='page'] {
    color: var(--c-accent-text);
  }
  .clock {
    display: flex;
    align-items: center;
    margin-left: auto;
    padding: 0 6px;
    background: var(--c-surface-hover);
    color: var(--c-text);
  }
  .title {
    display: flex;
    align-items: flex-start;
    gap: var(--s-2);
    padding: 0 var(--s-3);
  }
  .banner {
    position: relative;
    flex: 1;
    min-width: 0;
    overflow: hidden;
  }
  pre {
    margin: 0;
    color: var(--c-accent);
    font: 9px / 1.05 var(--font-mono);
    text-shadow: -2px 0 rgb(45 226 230 / 0.75);
  }
  .glitch {
    position: absolute;
    top: 0;
    left: 0;
    color: var(--c-accent-text);
    clip-path: inset(0 0 100% 0);
  }
  :global(:root[data-motion='on']) .glitch {
    animation: slice 3.5s steps(1) infinite;
  }
  @keyframes slice {
    0%,
    86%,
    100% {
      clip-path: inset(0 0 100% 0);
      transform: none;
    }
    87% {
      clip-path: inset(20% 0 55% 0);
      transform: translateX(-6px);
    }
    90% {
      clip-path: inset(62% 0 18% 0);
      transform: translateX(5px);
    }
    93% {
      clip-path: inset(40% 0 42% 0);
      transform: translateX(-3px);
    }
    96% {
      clip-path: inset(0 0 100% 0);
    }
  }
  .title :global(.theme) {
    color: var(--c-accent-text);
    font-size: var(--fs-sm);
  }
  .link {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 var(--s-3);
    font-size: var(--fs-xs);
    white-space: nowrap;
  }
  .wire {
    position: relative;
    flex: 1;
    height: 1px;
    background: var(--c-accent);
  }
  .packet {
    position: absolute;
    top: -8px;
    left: 0;
    color: var(--c-accent-text);
  }
  :global(:root[data-motion='on']) .packet {
    animation: travel 1.6s linear infinite;
  }
  @keyframes travel {
    to {
      left: 100%;
    }
  }
  .hop {
    padding: 0 var(--s-1);
    border: 1px solid var(--c-accent-text);
    color: var(--c-accent-text);
  }
</style>
