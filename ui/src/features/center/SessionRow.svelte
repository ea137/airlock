<!-- One Claude session in a list: tapping it goes to its terminal (or its
     details when it has none in Airlock); ⓘ always opens its details. -->
<script lang="ts">
  import type { ClaudeSession } from '../../lib/api';
  import Meter from '../../lib/Meter.svelte';
  import { hrefFor } from '../../lib/router.svelte';
  import { contextLine, sessionLine, sessionName } from './labels';
  import { openTerminal } from './open';

  let { session, where = null }: { session: ClaudeSession; where?: string | null } = $props();

  const details = $derived(hrefFor({ name: 'session', id: session.id }));
</script>

{#snippet body()}
  <span class={`dot dot--${session.state}`} aria-hidden="true"></span>
  <span class="text">
    <span class="name">{sessionName(session)}{#if where}<span class="where"> · {where}</span>{/if}</span>
    <span class={`line line--${session.state}`}>{sessionLine(session)}</span>
    {#if session.context && session.state !== 'ended'}
      <span class="context">
        <Meter value={session.context.used} label="Context used" />
        <span class="context__text">{contextLine(session.context)}</span>
      </span>
    {/if}
  </span>
{/snippet}

<div class="row">
  {#if session.terminal}
    {@const link = session.terminal}
    <button class="main" type="button" onclick={() => openTerminal(link)}>{@render body()}</button>
  {:else}
    <a class="main" href={details}>{@render body()}</a>
  {/if}
  <a class="info" href={details} aria-label="Session details">
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"
      ><circle cx="12" cy="12" r="9"></circle><path d="M12 11v6M12 7.5v.5"></path></svg
    >
  </a>
</div>

<style>
  .row {
    display: flex;
    align-items: center;
    border-bottom: 1px solid var(--c-surface-2);
  }
  .main {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: var(--s-3);
    min-height: 48px;
    padding: 0;
    border: 0;
    background: none;
    color: var(--c-text);
    text-align: left;
    text-decoration: none;
    cursor: pointer;
  }
  .dot {
    flex: 0 0 auto;
    width: 8px;
    height: 8px;
    border-radius: var(--r-pill);
  }
  .dot--needs_you {
    background: var(--c-warn);
  }
  .dot--working {
    background: var(--c-ok);
  }
  .dot--idle {
    box-shadow: inset 0 0 0 1.5px var(--c-text-faint);
  }
  .dot--ended {
    background: var(--c-surface-3);
  }
  .text {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
  .name {
    font-size: var(--fs-base);
    font-weight: 600;
  }
  .where {
    color: var(--c-text-muted);
    font-weight: 500;
  }
  .line {
    overflow: hidden;
    color: var(--c-text-muted);
    font-size: var(--fs-sm);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .line--needs_you {
    color: var(--c-warn);
  }
  .line--ended {
    color: var(--c-text-faint);
  }
  .context {
    display: grid;
    grid-template-columns: 1fr auto;
    align-items: center;
    gap: var(--s-2);
    margin: 2px 0 var(--s-1);
  }
  .context__text {
    color: var(--c-text-faint);
    font-size: var(--fs-sm);
    font-variant-numeric: tabular-nums;
  }
  .info {
    display: flex;
    align-items: center;
    justify-content: center;
    width: var(--tap);
    height: var(--tap);
    color: var(--c-accent-text);
  }
</style>
