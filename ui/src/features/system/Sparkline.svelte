<!-- A small line of the last few values, filled underneath. Decoration for
     a number shown next to it, so screen readers skip it. -->
<script lang="ts">
  let {
    values,
    max = null,
    width = 64,
    height = 20,
    tone = 'accent',
  }: { values: number[]; max?: number | null; width?: number; height?: number; tone?: 'accent' | 'ok' | 'warn' } =
    $props();

  const points = $derived.by(() => {
    if (values.length < 2) return null;
    const top = Math.max(max ?? 0, ...values, 1);
    const step = width / (values.length - 1);
    return values.map((value, index) => [index * step, height - (Math.min(value, top) / top) * (height - 2) - 1]);
  });
  const line = $derived(points?.map(([x, y]) => `${x?.toFixed(1)},${y?.toFixed(1)}`).join(' ') ?? '');
  const area = $derived(points ? `0,${height} ${line} ${width},${height}` : '');
</script>

{#if points}
  <svg class={`spark spark--${tone}`} {width} {height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
    <polygon points={area}></polygon>
    <polyline points={line}></polyline>
  </svg>
{:else}
  <span class="spark spark--empty" style:width={`${width}px`} style:height={`${height}px`} aria-hidden="true"></span>
{/if}

<style>
  .spark {
    flex: 0 0 auto;
    display: block;
    overflow: visible;
  }
  polyline {
    fill: none;
    stroke-width: 1.5;
    stroke-linejoin: round;
    stroke-linecap: round;
  }
  polygon {
    stroke: none;
    opacity: 0.18;
  }
  .spark--accent polyline {
    stroke: var(--c-accent-text);
  }
  .spark--accent polygon {
    fill: var(--c-accent-text);
  }
  .spark--ok polyline {
    stroke: var(--c-ok);
  }
  .spark--ok polygon {
    fill: var(--c-ok);
  }
  .spark--warn polyline {
    stroke: var(--c-warn);
  }
  .spark--warn polygon {
    fill: var(--c-warn);
  }
  .spark--empty {
    border-bottom: 1px dashed var(--c-surface-3);
  }
</style>
