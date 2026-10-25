<!-- One thing on Home: what it is, where and when, a tap to go to it, and
     (unless it waits on you) a way to hide it until it changes. -->
<script lang="ts">
  import type { AttentionItem } from '../../lib/api';
  import { ago } from '../../lib/format';
  import { hrefFor } from '../../lib/router.svelte';
  import { canHide, routeFor } from './home';

  let { item, now, onhide }: { item: AttentionItem; now: number; onhide?: () => void } = $props();

  /** Stroke paths on a 24px grid, by kind. */
  const ICONS: Record<string, string> = {
    finished: 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18M8 12.5l2.5 2.5L16 9.5',
    stopped: 'M12 4l9 16H3zM12 10v4M12 17.5v.01',
    pull: 'M6 4a2 2 0 1 0 0 4a2 2 0 1 0 0-4M6 8v12M18 16a2 2 0 1 0 0 4a2 2 0 1 0 0-4M18 16V9a3 3 0 0 0-3-3h-4M13 4l-2 2 2 2',
    job: 'M6 6h12v12H6zM9 9h6v6H9zM9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3',
    port: 'M12 3l8 3v6c0 4.5-3.4 8-8 9c-4.6-1-8-4.5-8-9V6zM12 8v5M12 16v.01',
    service: 'M12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1',
    disk: 'M4 6h16v12H4zM4 13h16M8 16h.01',
    memory: 'M5 7h14v10H5zM8 7V4M12 7V4M16 7V4M8 20v-3M12 20v-3M16 20v-3',
    battery: 'M4 8h14v8H4zM20 11v2M7 11v2',
    edit: 'M4 20h4L19 9l-4-4L4 16zM13 7l4 4',
    edits: 'M4 20h4L19 9l-4-4L4 16zM13 7l4 4',
  };

  const meta = $derived([item.detail, item.since === null ? null : ago(item.since, now)].filter(Boolean).join(' · '));
</script>

<li class="row row--{item.level}">
  <a class="go" href={hrefFor(routeFor(item.link))}>
    <span class="badge" aria-hidden="true">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
        ><path d={ICONS[item.kind] ?? ICONS.finished}></path></svg
      >
    </span>
    <span class="text">
      <span class="title">{item.title}</span>
      {#if meta}<span class="meta">{meta}</span>{/if}
    </span>
  </a>
  {#if onhide && canHide(item)}
    <button class="hide" type="button" aria-label={`Hide: ${item.title}`} onclick={onhide}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"
        ><path d="M6 6l12 12M18 6L6 18"></path></svg
      >
    </button>
  {/if}
</li>

<style>
  .row {
    display: flex;
    align-items: stretch;
    border-radius: var(--r-lg);
    background: var(--c-surface);
    box-shadow: 0 0 0 1px var(--c-line);
    list-style: none;
  }
  .row--act {
    box-shadow: 0 0 0 1px var(--c-warn-soft);
  }
  .go {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: var(--s-3);
    min-height: 60px;
    padding: var(--s-2) var(--s-3);
    border-radius: var(--r-lg);
    color: var(--c-text);
    text-decoration: none;
    transition-property: background-color;
    transition-duration: var(--t-hover);
  }
  .go:hover {
    background: var(--c-surface-2);
  }
  .go:focus-visible,
  .hide:focus-visible {
    outline: 2px solid var(--c-accent-text);
    outline-offset: -2px;
  }
  .badge {
    flex: 0 0 auto;
    display: grid;
    place-items: center;
    width: 34px;
    height: 34px;
    border-radius: var(--r-pill);
    background: var(--c-surface-2);
    color: var(--c-text-muted);
  }
  .row--act .badge {
    background: var(--c-warn-soft);
    color: var(--c-warn);
  }
  .row--look .badge {
    background: var(--c-accent-soft);
    color: var(--c-accent-text);
  }
  .text {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .title {
    font-size: var(--fs-lg);
    line-height: 1.3;
    overflow-wrap: anywhere;
  }
  .meta {
    overflow: hidden;
    color: var(--c-text-muted);
    font-size: var(--fs-sm);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .hide {
    flex: 0 0 auto;
    display: grid;
    place-items: center;
    width: var(--tap);
    border: 0;
    border-radius: var(--r-lg);
    background: transparent;
    color: var(--c-text-faint);
    cursor: pointer;
    transition-property: color;
    transition-duration: var(--t-hover);
  }
  .hide:hover {
    color: var(--c-text);
  }
</style>
