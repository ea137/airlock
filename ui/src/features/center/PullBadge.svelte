<script lang="ts">
  import { pullBadge } from './labels';

  let { state, draft }: { state: string; draft: boolean } = $props();

  const badge = $derived(pullBadge({ state, draft }));
</script>

<span class={`badge badge--${badge.tone}`}>{badge.label}</span>

<style>
  .badge {
    padding: 2px var(--s-2);
    border-radius: var(--r-pill);
    font-size: var(--fs-xs);
    font-weight: 600;
    white-space: nowrap;
  }
  .badge--merged {
    background: var(--c-merged-soft);
    color: var(--c-merged);
  }
  .badge--open {
    background: var(--c-ok-soft);
    color: var(--c-ok-text);
  }
  .badge--closed {
    background: var(--c-danger-soft);
    color: var(--c-danger-text);
  }
  .badge--draft {
    background: var(--c-surface-2);
    color: var(--c-text-muted);
  }
</style>
