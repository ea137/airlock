<!-- Home: what needs you now, from every part of Airlock, and every Claude
     session going on. Prompts are answered right here; everything else is a
     tap away, and what's only worth a look can be hidden until it changes. -->
<script lang="ts" module>
  import { api, type Attention } from '../../lib/api';
  import { Polled } from '../../lib/polled.svelte';

  /** A session changing how it stands refreshes Home at once (the hub's
   * news); this catches the rest: the disk, services, pull requests. */
  const REFRESH_MS = 10_000;

  // Kept between visits: coming back shows the last of it at once while it
  // refreshes.
  const attention = new Polled<Attention>(() => api.attention(), REFRESH_MS);
</script>

<script lang="ts">
  import { nowSecs } from '../../lib/format';
  import MainHeader from '../../lib/MainHeader.svelte';
  import { onSessionsChanged } from '../../lib/news';
  import Problem from '../../lib/Problem.svelte';
  import { askAbout } from '../ask/ask.svelte';
  import NeedsYou from '../center/NeedsYou.svelte';
  import FaceIdOffer from '../faceid/FaceIdOffer.svelte';
  import AttentionRow from './AttentionRow.svelte';
  import { hidden, setHidden } from './hidden.svelte';
  import { goingOn, stillHidden, unhidden } from './home';
  import ClaudeUsage from './ClaudeUsage.svelte';
  import SessionsNow from './SessionsNow.svelte';

  $effect(() => attention.watch());
  $effect(() => onSessionsChanged(() => attention.nudge()));

  const data = $derived(attention.data);
  const now = $derived(data ? nowSecs() : 0);
  const shown = $derived(data ? unhidden(data.items, hidden.ids) : []);
  const waiting = $derived(shown.filter((item) => item.level === 'act'));
  const glance = $derived(shown.filter((item) => item.level !== 'act'));
  const hiddenHere = $derived(data ? stillHidden(data.items, hidden.ids).length : 0);
  const going = $derived(data ? goingOn(data.now) : []);
  const quiet = $derived(data !== null && data.needs_you.length === 0 && shown.length === 0);

  // Ids whose thing has left Home are forgotten.
  $effect(() => {
    if (!data) return;
    const kept = stillHidden(data.items, hidden.ids);
    if (kept.length !== hidden.ids.length) setHidden(kept);
  });
</script>

<main class="home">
  <MainHeader current="home" />

  <div class="scroll">
    <FaceIdOffer />
    {#if data === null && attention.error === null}
      {#each [0, 1] as placeholder (placeholder)}
        <div class="skeleton" aria-hidden="true"></div>
      {/each}
      <span class="visually-hidden" role="status">Loading what needs you</span>
    {/if}

    {#if attention.error}
      <Problem message={attention.error.message} onretry={() => attention.refresh()} />
    {/if}

    {#if data}
      {#if going.length > 0}
        <p class="going">
          <span class="pulse" aria-hidden="true"></span>
          {going.join(' · ')}
        </p>
      {/if}

      <button class="ask" type="button" onclick={() => askAbout()}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
          ><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z"></path></svg
        >
        Ask Claude about the laptop
      </button>

      {#if quiet}
        <section class="quiet" aria-labelledby="quiet-title">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
            ><path d="M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18M8 12.5l2.5 2.5L16 9.5"></path></svg
          >
          <h2 id="quiet-title">Nothing needs you</h2>
          <p>Prompts, finished sessions, failing checks and anything running low show up here.</p>
        </section>
      {/if}

      {#if data.needs_you.length > 0 || waiting.length > 0}
        <section class="part" aria-labelledby="waiting-title">
          <h2 id="waiting-title">Waiting on you <span class="count">{data.needs_you.length + waiting.length}</span></h2>
          {#each data.needs_you as session (session.id)}
            <NeedsYou {session} onanswered={() => attention.refresh()} />
          {/each}
          {#if waiting.length > 0}
            <ul class="list">
              {#each waiting as item (item.id)}
                <AttentionRow {item} {now} />
              {/each}
            </ul>
          {/if}
        </section>
      {/if}

      <SessionsNow sessions={data.sessions} {now} />
      {#if data.usage}<ClaudeUsage usage={data.usage} {now} />{/if}

      {#if glance.length > 0}
        <section class="part" aria-labelledby="glance-title">
          <h2 id="glance-title">Worth a look</h2>
          <ul class="list">
            {#each glance as item (item.id)}
              <AttentionRow {item} {now} onhide={() => setHidden([...hidden.ids, item.id])} />
            {/each}
          </ul>
        </section>
      {/if}

      {#if hiddenHere > 0}
        <button class="unhide" type="button" onclick={() => setHidden([])}>
          Show {hiddenHere} hidden {hiddenHere === 1 ? 'item' : 'items'}
        </button>
      {/if}
    {/if}
  </div>
</main>

<style>
  .home {
    height: 100%;
    display: flex;
    flex-direction: column;
    padding-top: var(--safe-top);
  }
  .scroll {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: var(--s-4);
    padding: var(--s-1) var(--s-4) calc(var(--s-5) + var(--safe-bottom));
  }
  .skeleton {
    height: 96px;
    border-radius: var(--r-xl);
    background: var(--c-surface);
  }
  .going {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    margin: 0;
    color: var(--c-text-muted);
    font-size: var(--fs-md);
  }
  .ask {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    min-height: var(--tap);
    padding: 0 var(--s-3);
    border: 1px solid var(--c-line);
    border-radius: var(--r-lg);
    background: var(--c-surface);
    color: var(--c-accent-text);
    font: inherit;
    font-weight: 600;
    text-align: left;
    cursor: pointer;
    transition-property: background-color;
    transition-duration: var(--t-hover);
  }
  .ask:hover,
  .ask:active {
    background: var(--c-surface-2);
  }
  .pulse {
    flex: 0 0 auto;
    width: 8px;
    height: 8px;
    border-radius: var(--r-pill);
    background: var(--c-ok);
  }
  @media (prefers-reduced-motion: no-preference) {
    :global([data-motion='on']) .pulse {
      animation: pulse 2s ease-in-out infinite;
    }
  }
  @keyframes pulse {
    50% {
      opacity: 0.35;
    }
  }
  .part {
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
  }
  h2 {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    margin: 0;
    color: var(--c-text-soft);
    font-size: var(--fs-md);
    font-weight: 600;
    letter-spacing: 0.02em;
    text-transform: uppercase;
  }
  .count {
    min-width: 20px;
    padding: 0 6px;
    border-radius: var(--r-pill);
    background: var(--c-warn-soft);
    color: var(--c-warn);
    font-size: var(--fs-sm);
    text-align: center;
  }
  .list {
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
    margin: 0;
    padding: 0;
  }
  .quiet {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--s-2);
    padding: var(--s-6) var(--s-4);
    border-radius: var(--r-xl);
    background: var(--c-surface);
    color: var(--c-ok-text);
    text-align: center;
  }
  .quiet h2 {
    color: var(--c-text);
    font-size: var(--fs-2xl);
    letter-spacing: 0;
    text-transform: none;
  }
  .quiet p {
    max-width: 30ch;
    margin: 0;
    color: var(--c-text-muted);
    line-height: 1.45;
  }
  .unhide {
    align-self: center;
    min-height: var(--tap);
    padding: 0 var(--s-3);
    border: 0;
    background: transparent;
    color: var(--c-text-muted);
    font-size: var(--fs-md);
    cursor: pointer;
  }
</style>
