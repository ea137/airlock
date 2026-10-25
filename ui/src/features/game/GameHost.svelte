<script lang="ts">
  import type { Component } from 'svelte';

  import { CODE_LENGTH, closeGame, codeStep, gameDoor, openGame, typing } from './door.svelte';

  let { inCase = false }: { inCase?: boolean } = $props();

  type Overlay = Component<{ inCase: boolean; onclose: () => void }>;
  type Picker = Component<{ inCase: boolean; onpick: (id: string) => void; onclose: () => void }>;
  const GAMES: Record<string, () => Promise<{ default: Overlay }>> = {
    hop: () => import('./GameOverlay.svelte'),
    keepalive: () => import('../keepalive/KeepaliveOverlay.svelte'),
  };
  let Pick: Picker | null = $state(null);
  let Game: Overlay | null = $state(null);
  let picked = $state('');
  let progress = 0;

  $effect(() => {
    if (!gameDoor.open) {
      picked = '';
      Game = null;
      return;
    }
    const load = picked ? GAMES[picked] : undefined;
    if (load) {
      load().then(
        (module) => {
          if (gameDoor.open) Game = module.default;
        },
        () => closeGame(),
      );
    } else if (!Pick) {
      import('./GamePicker.svelte').then(
        (module) => {
          Pick = module.default;
        },
        () => closeGame(),
      );
    }
  });

  function onkeydown(event: KeyboardEvent) {
    if (gameDoor.open || typing(event.target)) {
      progress = 0;
      return;
    }
    progress = codeStep(progress, event.key);
    if (progress === CODE_LENGTH) {
      progress = 0;
      openGame();
    }
  }
</script>

<svelte:window {onkeydown} />

{#if gameDoor.open}
  {#if Game}
    <Game {inCase} onclose={closeGame} />
  {:else if !picked && Pick}
    <Pick {inCase} onpick={(id) => (picked = id)} onclose={closeGame} />
  {/if}
{/if}
