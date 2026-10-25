<!-- The Claude plan's usage: the 5-hour and weekly limits, how much of each
     is used and when it starts over, as a session's status line last said. -->
<script lang="ts">
  import type { Usage } from '../../lib/api';
  import { ago } from '../../lib/format';
  import Meter from '../../lib/Meter.svelte';

  let { usage, now }: { usage: Usage; now: number } = $props();

  /** "in 2 h 10 min", "in 3 days". */
  function resets(at: number | null): string {
    if (at === null) return '';
    const secs = Math.max(0, at - now);
    if (secs < 3600) return `resets in ${Math.max(1, Math.round(secs / 60))} min`;
    if (secs < 86_400) {
      const hours = Math.floor(secs / 3600);
      const minutes = Math.round((secs % 3600) / 60);
      return `resets in ${hours} h${minutes ? ` ${minutes} min` : ''}`;
    }
    const days = Math.round(secs / 86_400);
    return `resets in ${days} day${days === 1 ? '' : 's'}`;
  }

  const limits = $derived(
    [
      { name: 'Next 5 hours', limit: usage.five_hour },
      { name: 'This week', limit: usage.seven_day },
    ].filter((row) => row.limit !== null),
  );
</script>

{#if limits.length > 0}
  <section class="part" aria-labelledby="usage-title">
    <h2 id="usage-title">Claude usage</h2>
    <div class="card">
      {#each limits as row (row.name)}
        {#if row.limit}
          <div class="limit">
            <span class="top">
              <span class="name">{row.name}</span>
              <span class="numbers">{Math.round(row.limit.used)}% · {resets(row.limit.resets_at)}</span>
            </span>
            <Meter value={row.limit.used} label={`${row.name}, used`} />
          </div>
        {/if}
      {/each}
      <p class="when">Updated {ago(usage.at, now)}, when a session last answered</p>
    </div>
  </section>
{/if}

<style>
  .part {
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
  }
  h2 {
    margin: 0;
    color: var(--c-text-soft);
    font-size: var(--fs-md);
    font-weight: 600;
    letter-spacing: 0.02em;
    text-transform: uppercase;
  }
  .card {
    display: flex;
    flex-direction: column;
    gap: var(--s-3);
    padding: var(--s-3);
    border-radius: var(--r-lg);
    background: var(--c-surface);
    box-shadow: 0 0 0 1px var(--c-line);
  }
  .limit {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .top {
    display: flex;
    justify-content: space-between;
    gap: var(--s-2);
  }
  .name {
    font-weight: 600;
  }
  .numbers {
    color: var(--c-text-muted);
    font-size: var(--fs-sm);
    font-variant-numeric: tabular-nums;
  }
  .when {
    margin: 0;
    color: var(--c-text-faint);
    font-size: var(--fs-sm);
  }
</style>
