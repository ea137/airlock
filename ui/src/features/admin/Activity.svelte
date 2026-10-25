<script lang="ts">
  import { ago } from '../../lib/format';
  import type { AuditEntry } from './hub';

  let { entries, now }: { entries: AuditEntry[]; now: number } = $props();
</script>

<section aria-labelledby="activity-title">
  <h2 id="activity-title">Activity</h2>
  {#if entries.length === 0}
    <p class="empty">Nothing has happened yet.</p>
  {:else}
    <ol class="log">
      {#each entries as entry, index (index)}
        <li>
          <span class="when">{ago(entry.at, now)}</span>
          <span class="what"><strong>{entry.action}</strong> {entry.detail}</span>
          <span class="actor">{entry.actor}</span>
        </li>
      {/each}
    </ol>
  {/if}
</section>

<style>
  h2 {
    margin: 0 0 var(--s-3);
    font-size: var(--fs-xl);
    font-weight: 600;
  }
  .empty {
    margin: 0;
    color: var(--c-text-muted);
  }
  .log {
    margin: 0;
    padding: 0;
    list-style: none;
    font-size: var(--fs-md);
  }
  li {
    display: grid;
    grid-template-columns: 72px 1fr auto;
    gap: var(--s-3);
    padding: var(--s-2) 0;
    border-bottom: 1px solid var(--c-line);
  }
  .when,
  .actor {
    color: var(--c-text-faint);
  }
  .what {
    color: var(--c-text-muted);
    overflow-wrap: anywhere;
    -webkit-user-select: text;
    user-select: text;
  }
  .what strong {
    color: var(--c-text);
    font-weight: 600;
  }
</style>
