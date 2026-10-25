<!-- A terminal's tabs: tap to switch, hold for name and close, + for a new
     tab, and a reconnect button that shows the link's state. -->
<script lang="ts">
  import type { Tab } from '../../lib/api';
  import { tabLabel } from './labels';
  import type { LinkStatus } from './link';

  let {
    tabs,
    status,
    onselect,
    onnew,
    onhold,
    onreconnect,
  }: {
    tabs: Tab[];
    status: LinkStatus;
    onselect: (tab: Tab) => void;
    onnew: () => void;
    onhold: (tab: Tab) => void;
    onreconnect: () => void;
  } = $props();

  /** Holding a tab this long opens its options. */
  const HOLD_MS = 500;
  let holdTimer: ReturnType<typeof setTimeout> | undefined;
  let held = false;

  // pointerdown's preventDefault keeps the terminal focused, so the iOS
  // keyboard stays up while you switch tabs.
  function down(tab: Tab, event: PointerEvent) {
    event.preventDefault();
    held = false;
    holdTimer = setTimeout(() => {
      held = true;
      onhold(tab);
    }, HOLD_MS);
  }

  function up(tab: Tab) {
    clearTimeout(holdTimer);
    if (!held && !tab.active) onselect(tab);
  }

  function cancel() {
    clearTimeout(holdTimer);
  }

  // Keyboard activation (Enter, Space) arrives as a click with no pointer.
  function keyboardClick(tab: Tab, event: MouseEvent) {
    if (event.detail === 0 && !tab.active) onselect(tab);
  }

  const statusLabel = $derived(
    status === 'live' ? 'Reconnect' : status === 'connecting' ? 'Connecting' : 'Link lost, reconnect',
  );
</script>

<nav class="tabs" aria-label="Tabs">
  {#each tabs as tab (tab.id)}
    <button
      class="tab"
      class:tab--active={tab.active}
      type="button"
      aria-current={tab.active ? 'page' : undefined}
      onpointerdown={(event) => down(tab, event)}
      onpointerup={() => up(tab)}
      onpointercancel={cancel}
      onpointerleave={cancel}
      onclick={(event) => keyboardClick(tab, event)}
      oncontextmenu={(event) => {
        event.preventDefault();
        onhold(tab);
      }}
    >
      {tabLabel(tab)}
    </button>
  {/each}
  <button
    class="tab tab--icon"
    type="button"
    aria-label="New tab"
    onpointerdown={(event) => event.preventDefault()}
    onclick={onnew}>+</button
  >
  <button
    class="tab tab--icon"
    class:tab--lost={status === 'lost'}
    type="button"
    aria-label={statusLabel}
    onpointerdown={(event) => event.preventDefault()}
    onclick={onreconnect}>⟳</button
  >
</nav>

<style>
  .tabs {
    display: flex;
    align-items: center;
    gap: var(--s-1);
    padding: var(--s-1);
    overflow-x: auto;
    scrollbar-width: none;
  }
  .tabs::-webkit-scrollbar {
    display: none;
  }
  .tab {
    flex: 0 0 auto;
    max-width: 46vw;
    min-height: 36px;
    padding: 0 var(--s-3);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    border: 0;
    border-radius: var(--r-md);
    background: var(--c-surface-2);
    color: var(--c-text-muted);
    font-size: var(--fs-md);
    font-weight: 500;
    -webkit-touch-callout: none;
    transition-property: background-color, color;
    transition-duration: var(--t-hover);
  }
  .tab:hover {
    background: var(--c-surface-3);
  }
  .tab--active {
    background: var(--c-surface-3);
    color: var(--c-text);
  }
  .tab--icon {
    min-width: 40px;
    color: var(--c-text);
    font-size: var(--fs-xl);
  }
  .tab--lost {
    background: var(--c-warn-soft);
    color: var(--c-warn);
  }
</style>
