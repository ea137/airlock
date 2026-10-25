<!-- Settings, on this phone: how it looks (the theme, and whether the
     terminal and the decorations follow it), the model Ask Claude answers
     with, and the secret game's sound. -->
<script lang="ts">
  import { api, type AskModels } from '../../lib/api';
  import { hrefFor } from '../../lib/router.svelte';
  import SubHeader from '../../lib/SubHeader.svelte';
  import Switch from '../../lib/Switch.svelte';
  import { look, setLook } from '../../lib/theme.svelte';
  import { THEMES } from '../../lib/themes';
  import { asking } from '../ask/ask.svelte';
  import { readSettings, writeSettings } from '../game/settings';
  import NotificationSettings from '../notifications/NotificationSettings.svelte';

  const lessMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let models = $state<AskModels['models'] | null>(null);
  let modelsProblem = $state<string | null>(null);
  let gameSound = $state(!readSettings().muted);

  $effect(() => {
    api.askModels().then(
      (found) => (models = found.models),
      (error: unknown) => (modelsProblem = (error as Error).message),
    );
  });

  /** The model asked with: this phone's choice, else the laptop's default. */
  const chosenModel = $derived(asking.model ?? models?.[0]?.id ?? null);
</script>

<main class="screen">
  <SubHeader back={hrefFor({ name: 'home' })} backLabel="Home" title="Settings" />

  <div class="scroll">
    <h2>Look</h2>
    <ul class="themes" aria-label="Themes">
      {#each THEMES as theme (theme.id)}
        {@const chosen = look.theme === theme.id}
        <li>
          <button class="theme" type="button" aria-pressed={chosen} onclick={() => setLook({ theme: theme.id })}>
            <span class="swatch" class:swatch--chosen={chosen} style:background={theme.swatch.bg} aria-hidden="true">
              <span class="swatch__bar" style:background={theme.swatch.accent}></span>
              <span
                class="swatch__sample"
                style:color={theme.swatch.fg}
                style:font-family={theme.swatch.font}
                style:font-size={theme.swatch.size}>{theme.swatch.sample}</span
              >
              <span class="swatch__line" style:background={theme.swatch.fg}></span>
              {#if chosen}<span class="tick" aria-hidden="true">✓</span>{/if}
            </span>
            <span class="name">{theme.name}</span>
          </button>
        </li>
      {/each}
    </ul>

    <div class="settings">
      <Switch
        label="Terminal colours follow the theme"
        help="Text and prompt colours inside the terminal"
        checked={look.terminalColours}
        onchange={(on) => setLook({ terminalColours: on })}
      />
      <Switch
        label="Motion"
        help={lessMotion
          ? 'Code rain, blinking. Off for now: the phone asks for less motion'
          : 'Code rain, blinking. Off when the phone asks for less motion'}
        checked={look.motion}
        onchange={(on) => setLook({ motion: on })}
      />
    </div>

    <h2 id="ask-model">Ask Claude</h2>
    <div class="settings" role="radiogroup" aria-labelledby="ask-model">
      {#if models}
        {#each models as model, index (model.id)}
          <label class="choice">
            <input
              type="radio"
              name="ask-model"
              value={model.id}
              checked={chosenModel === model.id}
              onchange={() => asking.setModel(model.id)}
            />
            <span class="choice__text">
              <span>{model.name}</span>
              <span class="choice__help"
                >{index === 0 ? 'The default: quick and good at this' : model.id.includes('opus') ? 'Most thorough, slower' : 'Fastest, lightest'}</span
              >
            </span>
          </label>
        {/each}
      {:else if modelsProblem}
        <p class="error-text note" role="alert">{modelsProblem}</p>
      {:else}
        <p class="note" role="status">Reading the models…</p>
      {/if}
    </div>
    <p class="hint">Answers come from Claude Code on the laptop, with your login. It looks around with read-only tools and can't change anything.</p>

    <h2>Notifications</h2>
    <NotificationSettings />

    <h2>Game</h2>
    <div class="settings">
      <Switch
        label="Sound"
        help="The secret games' music and sounds"
        checked={gameSound}
        onchange={(on) => {
          gameSound = on;
          writeSettings({ muted: !on });
        }}
      />
    </div>
  </div>
</main>

<style>
  .screen {
    height: 100%;
    display: flex;
    flex-direction: column;
    padding-top: var(--safe-top);
  }
  .scroll {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: var(--s-4);
    padding: var(--s-2) var(--s-4) calc(var(--s-6) + var(--safe-bottom));
  }
  .themes {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .theme {
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 0;
    border: 0;
    background: transparent;
    text-align: left;
    cursor: pointer;
  }
  /* The swatch shows the theme as it is, so its colours aren't tokens:
     they're the theme's. */
  .swatch {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 6px;
    height: 74px;
    padding: var(--s-2) 10px;
    overflow: hidden;
    border-radius: var(--r-lg);
    outline: 1px solid var(--c-line);
    outline-offset: 2px;
    transition-property: outline-color;
    transition-duration: var(--t-hover);
  }
  .theme:hover .swatch {
    outline-color: var(--c-surface-hover);
  }
  .swatch--chosen,
  .theme:hover .swatch--chosen {
    outline: 2px solid var(--c-accent);
  }
  .theme:focus-visible {
    outline: none;
  }
  .theme:focus-visible .swatch {
    outline: 2px solid var(--c-accent-text);
  }
  .swatch__bar {
    width: 46%;
    height: 6px;
    border-radius: 2px;
  }
  .swatch__sample {
    overflow: hidden;
    line-height: 1.3;
    text-shadow: none;
    text-transform: none;
    white-space: nowrap;
  }
  .swatch__line {
    width: 70%;
    height: 4px;
    border-radius: 2px;
    opacity: 0.45;
  }
  .tick {
    position: absolute;
    top: 6px;
    right: 6px;
    width: 20px;
    height: 20px;
    border-radius: 10px;
    background: var(--c-accent);
    color: var(--c-on-accent);
    font: 600 13px / 20px system-ui, sans-serif;
    text-align: center;
  }
  .name {
    padding-left: 2px;
    font-size: var(--fs-md);
    font-weight: 600;
  }
  .settings {
    overflow: hidden;
    border-radius: var(--r-lg);
    background: var(--c-surface);
    box-shadow: 0 0 0 1px var(--c-line);
  }
  .settings > :global(* + *) {
    border-top: 1px solid var(--c-surface-2);
  }
  h2 {
    margin: var(--s-2) 0 0;
    color: var(--c-text-muted);
    font-size: var(--fs-md);
    font-weight: 700;
    letter-spacing: 0.5px;
    text-transform: uppercase;
  }
  h2:first-child {
    margin-top: 0;
  }
  .choice {
    display: flex;
    align-items: center;
    gap: var(--s-3);
    min-height: 52px;
    padding: var(--s-2) var(--s-3);
    cursor: pointer;
  }
  .choice input {
    width: 20px;
    height: 20px;
    margin: 0;
    accent-color: var(--c-accent);
  }
  .choice__text {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .choice__help {
    color: var(--c-text-muted);
    font-size: var(--fs-sm);
  }
  .note {
    margin: 0;
    padding: var(--s-3);
    color: var(--c-text-muted);
  }
  .hint {
    margin: calc(var(--s-2) * -1) 0 0;
    color: var(--c-text-faint);
    font-size: var(--fs-sm);
    line-height: 1.4;
  }
</style>
