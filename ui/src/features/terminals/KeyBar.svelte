<!-- The keys a phone keyboard lacks: Esc, Tab, Ctrl, Alt, arrows, and a row
     of commands, after the button that brings the phone's keyboard up or
     puts it away; nothing else brings it up. Arrows repeat while held. -->
<script lang="ts">
  import { COMMANDS, KEYS, type Key, type ModState, type Mods } from './keys';

  let {
    mods,
    onkey,
    keyboard,
    onkeyboard,
  }: { mods: Mods; onkey: (key: Key) => void; keyboard: boolean; onkeyboard: () => void } = $props();

  const REPEAT_DELAY_MS = 400;
  const REPEAT_EVERY_MS = 70;
  let repeatTimer: ReturnType<typeof setTimeout> | undefined;
  let repeatInterval: ReturnType<typeof setInterval> | undefined;

  function stop() {
    clearTimeout(repeatTimer);
    clearInterval(repeatInterval);
  }

  const isPaste = (key: Key) => 'action' in key && key.action === 'paste';

  // pointerdown + preventDefault keeps the terminal focused, so the iOS
  // keyboard stays up.
  function press(key: Key, event: PointerEvent) {
    event.preventDefault();
    // Reading the clipboard needs a real click, so paste waits for it.
    if (isPaste(key)) return;
    onkey(key);
    if ('arrow' in key) {
      repeatTimer = setTimeout(() => {
        repeatInterval = setInterval(() => onkey(key), REPEAT_EVERY_MS);
      }, REPEAT_DELAY_MS);
    }
  }

  // Paste on its click; and keyboard activation, which has no pointer.
  function click(key: Key, event: MouseEvent) {
    if (isPaste(key) || event.detail === 0) onkey(key);
  }

  const stateOf = (key: Key): ModState => ('modifier' in key ? mods[key.modifier] : 'off');
</script>

<div class="bar">
  {#each [KEYS, COMMANDS] as row, index (index)}
    <div class="row">
      {#if index === 0}
        <!-- On its click: iOS shows the keyboard only for focus a tap asked for. -->
        <button
          type="button"
          class="key key--keyboard"
          class:key--up={keyboard}
          aria-label="Keyboard"
          aria-pressed={keyboard}
          onpointerdown={(event) => event.preventDefault()}
          onmousedown={(event) => event.preventDefault()}
          onclick={onkeyboard}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
            ><rect x="2" y="5" width="20" height="14" rx="2" /><path d="M6 9h.01M10 9h.01M14 9h.01M18 9h.01M6 13h.01M18 13h.01M9 15h6" /></svg
          >
        </button>
      {/if}
      {#each row as key (key.label)}
        {@const state = stateOf(key)}
        <button
          type="button"
          class="key"
          class:key--command={index === 1}
          class:key--once={state === 'once'}
          class:key--locked={state === 'locked'}
          aria-pressed={'modifier' in key ? state !== 'off' : undefined}
          onpointerdown={(event) => press(key, event)}
          onpointerup={stop}
          onpointercancel={stop}
          onpointerleave={stop}
          onmousedown={(event) => event.preventDefault()}
          onclick={(event) => click(key, event)}
        >
          {key.label}
        </button>
      {/each}
    </div>
  {/each}
</div>

<style>
  .bar {
    display: flex;
    flex-direction: column;
    gap: var(--s-1);
    padding: 2px 0 calc(var(--s-1) + var(--safe-bottom));
  }
  .row {
    display: flex;
    gap: var(--s-1);
    padding: 2px var(--s-1);
    overflow-x: auto;
    scrollbar-width: none;
  }
  .row::-webkit-scrollbar {
    display: none;
  }
  .key {
    flex: 0 0 auto;
    min-width: var(--key);
    height: var(--key);
    padding: 0 var(--s-3);
    border: 0;
    border-radius: var(--r-md);
    background: var(--c-surface-2);
    color: var(--c-text);
    font: 600 var(--fs-base) var(--font-mono);
    -webkit-touch-callout: none;
    transition-property: background-color, color;
    transition-duration: var(--t-hover);
  }
  .key:active {
    background: var(--c-surface-hover);
  }
  .key--keyboard {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0 var(--s-2);
  }
  .key--up {
    background: var(--c-accent);
    color: var(--c-on-accent);
  }
  .key--command {
    color: var(--c-text-muted);
    font: 500 var(--fs-md) var(--font-ui);
  }
  .key--once {
    background: var(--c-accent);
    color: var(--c-on-accent);
  }
  .key--locked {
    background: var(--c-lock);
    color: var(--c-on-accent);
  }
</style>
