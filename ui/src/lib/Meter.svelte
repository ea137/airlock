<!-- A thin bar for how full something is (a context window, a usage limit),
     warning past 80% and alarming past 95%. -->
<script lang="ts">
  let { value, label }: { value: number; label: string } = $props();

  const shown = $derived(Math.max(0, Math.min(100, value)));
  const tone = $derived(shown >= 95 ? 'danger' : shown >= 80 ? 'warn' : 'ok');
</script>

<span
  class="meter"
  role="meter"
  aria-label={label}
  aria-valuemin={0}
  aria-valuemax={100}
  aria-valuenow={Math.round(shown)}
  aria-valuetext={`${Math.round(shown)}%`}
>
  <span class={`fill fill--${tone}`} style:width={`${shown}%`}></span>
</span>

<style>
  .meter {
    display: block;
    height: 4px;
    overflow: hidden;
    border-radius: var(--r-pill);
    background: var(--c-surface-2);
  }
  .fill {
    display: block;
    height: 100%;
    border-radius: inherit;
    background: var(--c-accent);
  }
  .fill--warn {
    background: var(--c-warn);
  }
  .fill--danger {
    background: var(--c-danger);
  }
</style>
