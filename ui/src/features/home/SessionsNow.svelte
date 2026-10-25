<!-- Every Claude session going on, and those closed lately: waiting on you,
     working, done but still running something (and what), done. Each says
     the name of the terminal it's in, and opens its session. Sessions can be
     hidden from here on this phone; a prompt from one still waits on top. -->
<script lang="ts">
  import type { ClaudeSession } from '../../lib/api';
  import Meter from '../../lib/Meter.svelte';
  import { hrefFor } from '../../lib/router.svelte';
  import { contextLine, sessionName } from '../center/labels';
  import { hiddenSessions, setHiddenSessions } from './hidden.svelte';
  import { sessionStatus, sessionWhere } from './home';

  let { sessions, now }: { sessions: ClaudeSession[]; now: number } = $props();

  let showHidden = $state(false);
  const hiddenHere = $derived(sessions.filter((session) => hiddenSessions.ids.includes(session.id)));
  const shown = $derived(showHidden ? sessions : sessions.filter((session) => !hiddenSessions.ids.includes(session.id)));

  function hide(id: string) {
    // Only sessions still listed stay remembered.
    const known = new Set(sessions.map((session) => session.id));
    setHiddenSessions([...hiddenSessions.ids.filter((kept) => known.has(kept)), id]);
  }

  function unhide(id: string) {
    setHiddenSessions(hiddenSessions.ids.filter((kept) => kept !== id));
    if (hiddenHere.length === 0) showHidden = false;
  }
</script>

{#if sessions.length > 0}
  <section class="part" aria-labelledby="sessions-title">
    <h2 id="sessions-title">Claude sessions <span class="count">{sessions.length - hiddenHere.length}</span></h2>
    <ul class="list">
      {#each shown as session (session.id)}
        {@const status = sessionStatus(session, now)}
        {@const isHidden = hiddenSessions.ids.includes(session.id)}
        <li class="item" class:item--hidden={isHidden}>
          <a class="row" href={hrefFor({ name: 'session', id: session.id })}>
            <span class={`dot dot--${status.tone}`} aria-hidden="true"></span>
            <span class="text">
              {#if session.terminal_name}<span class="terminal">{session.terminal_name}</span>{/if}
              <span class="name">{sessionName(session)} <span class="where">· {sessionWhere(session)}</span></span>
              <span class={`status status--${status.tone}`}>{status.text}</span>
              {#if session.context && session.state !== 'ended'}
                <span class="context">
                  <Meter value={session.context.used} label="Context used" />
                  <span class="context__text">{contextLine(session.context)}</span>
                </span>
              {/if}
            </span>
          </a>
          {#if isHidden}
            <button class="hide" type="button" onclick={() => unhide(session.id)}>Unhide</button>
          {:else}
            <button
              class="hide hide--icon"
              type="button"
              aria-label={`Hide: ${session.terminal_name ?? sessionName(session)}`}
              onclick={() => hide(session.id)}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
                ><path d="M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.9 5.1A9.9 9.9 0 0 1 12 5c5 0 9 4.5 10 7a13 13 0 0 1-3.2 4.2M6.6 6.6C4.3 8 2.7 10.2 2 12c1 2.5 5 7 10 7a9.6 9.6 0 0 0 5.4-1.6" /></svg
              >
            </button>
          {/if}
        </li>
      {/each}
    </ul>
    {#if hiddenHere.length > 0}
      <button class="btn btn--quiet more" type="button" aria-expanded={showHidden} onclick={() => (showHidden = !showHidden)}>
        {showHidden ? 'Leave the hidden out' : `Show ${hiddenHere.length} hidden`}
      </button>
    {/if}
  </section>
{/if}

<style>
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
    background: var(--c-surface-2);
    color: var(--c-text-muted);
    font-size: var(--fs-sm);
    text-align: center;
  }
  .list {
    margin: 0;
    padding: 0;
    overflow: hidden;
    border-radius: var(--r-lg);
    background: var(--c-surface);
    box-shadow: 0 0 0 1px var(--c-line);
    list-style: none;
  }
  .list > li + li {
    border-top: 1px solid var(--c-surface-2);
  }
  .row {
    display: flex;
    align-items: center;
    gap: var(--s-3);
    min-height: 52px;
    padding: var(--s-2) var(--s-3);
    color: var(--c-text);
    text-decoration: none;
    transition-property: background-color;
    transition-duration: var(--t-hover);
  }
  .row:hover,
  .row:active {
    background: var(--c-surface-2);
  }
  .dot {
    flex: 0 0 auto;
    width: 10px;
    height: 10px;
    border-radius: var(--r-pill);
    background: var(--c-text-faint);
  }
  .dot--asks {
    background: var(--c-warn);
    box-shadow: 0 0 0 3px var(--c-warn-soft);
  }
  .dot--works {
    background: var(--c-ok);
    box-shadow: 0 0 0 3px var(--c-ok-soft);
  }
  .dot--runs {
    background: var(--c-accent-text);
  }
  .dot--closed {
    background: none;
    box-shadow: inset 0 0 0 1.5px var(--c-text-faint);
  }
  .text {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .name {
    overflow: hidden;
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .where {
    color: var(--c-text-muted);
    font-weight: 400;
  }
  .status {
    display: -webkit-box;
    overflow: hidden;
    color: var(--c-text-muted);
    font-size: var(--fs-sm);
    line-height: 1.4;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    overflow-wrap: anywhere;
  }
  .status--asks {
    color: var(--c-warn);
  }
  .status--works {
    color: var(--c-ok-text);
  }
  .context {
    display: grid;
    grid-template-columns: 1fr auto;
    align-items: center;
    gap: var(--s-2);
    margin-top: 2px;
  }
  .context__text {
    color: var(--c-text-faint);
    font-size: var(--fs-sm);
    font-variant-numeric: tabular-nums;
  }
  .item {
    display: flex;
    align-items: stretch;
  }
  .item .row {
    flex: 1;
    min-width: 0;
  }
  .item--hidden .name,
  .item--hidden .terminal {
    color: var(--c-text-faint);
  }
  .terminal {
    overflow: hidden;
    color: var(--c-accent-text);
    font-size: var(--fs-sm);
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .hide {
    flex: 0 0 auto;
    min-width: var(--tap);
    padding: 0 var(--s-2);
    border: 0;
    background: none;
    color: var(--c-text-muted);
    font-size: var(--fs-sm);
    cursor: pointer;
    transition-property: color;
    transition-duration: var(--t-hover);
  }
  .hide:hover {
    color: var(--c-text);
  }
  .hide--icon {
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .more {
    align-self: flex-start;
  }
  .chev {
    color: var(--c-text-faint);
  }
</style>
