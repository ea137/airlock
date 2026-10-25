<!-- Whether something should worry you, in a coloured banner: safe, worth a
     look, or worth fixing, and why. -->
<script lang="ts">
  let { level, headline, why }: { level: 'safe' | 'look' | 'worry'; headline: string; why: string } = $props();
</script>

<div class={`verdict verdict--${level}`} role="status">
  <span class="verdict__head">{headline}</span>
  <span>{why}</span>
</div>

<style>
  .verdict {
    display: flex;
    flex-direction: column;
    gap: var(--s-1);
    padding: var(--s-3);
    border-radius: var(--r-lg);
    line-height: 1.4;
  }
  .verdict__head {
    font-size: var(--fs-lg);
    font-weight: 700;
  }
  .verdict--safe {
    background: var(--c-ok-soft);
    color: var(--c-ok-text);
  }
  .verdict--look {
    background: var(--c-warn-soft);
    color: var(--c-warn);
  }
  .verdict--worry {
    background: var(--c-danger-soft);
    color: var(--c-danger-text);
  }
</style>
