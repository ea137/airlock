<script lang="ts">
  let {
    label,
    help,
    checked,
    busy = false,
    onchange,
  }: { label: string; help: string; checked: boolean; busy?: boolean; onchange: (on: boolean) => void } = $props();

  const id = `switch-${Math.random().toString(36).slice(2, 10)}`;
</script>

<div class="setting">
  <div class="text">
    <span id={`${id}-label`} class="name">{label}</span>
    <span id={`${id}-help`} class="help">{help}</span>
  </div>
  <button
    class="switch"
    type="button"
    role="switch"
    aria-checked={checked}
    aria-labelledby={`${id}-label`}
    aria-describedby={`${id}-help`}
    aria-disabled={busy}
    onclick={() => {
      if (!busy) onchange(!checked);
    }}
  >
    <span class="knob" aria-hidden="true"></span>
  </button>
</div>

<style>
  .setting {
    display: flex;
    align-items: center;
    gap: var(--s-4);
    min-height: 56px;
    padding: var(--s-2) var(--s-3);
  }
  .text {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .name {
    font-size: var(--fs-lg);
  }
  .help {
    color: var(--c-text-muted);
    font-size: var(--fs-sm);
    line-height: 1.45;
  }
  .switch {
    position: relative;
    flex: 0 0 auto;
    width: 50px;
    height: 30px;
    padding: 0;
    border: 0;
    border-radius: var(--r-pill);
    background: var(--c-surface-3);
    cursor: pointer;
    transition-property: background-color;
    transition-duration: var(--t-hover);
  }
  .switch[aria-checked='true'] {
    background: var(--c-accent);
  }
  .switch[aria-disabled='true'] {
    background: var(--c-disabled-bg);
    cursor: default;
  }
  .knob {
    position: absolute;
    top: 3px;
    left: 3px;
    width: 24px;
    height: 24px;
    border-radius: var(--r-pill);
    background: var(--c-text);
    transition-property: transform, background-color;
    transition-duration: var(--t-enter);
    transition-timing-function: var(--ease);
  }
  .switch[aria-checked='true'] .knob {
    background: var(--c-on-accent);
    transform: translateX(20px);
  }
</style>
