<!-- The top of the main screens: the sections, the way to the theme
     picker, and the laptop's name, drawn the way the theme draws them.
     Holding a finger on it (not on a link) opens the secret game. -->
<script lang="ts">
  import { secretDoor } from '../features/game/door.svelte';
  import BootHeader from './headers/BootHeader.svelte';
  import HackerHeader from './headers/HackerHeader.svelte';
  import HandheldHeader from './headers/HandheldHeader.svelte';
  import MatrixHeader from './headers/MatrixHeader.svelte';
  import PlainHeader from './headers/PlainHeader.svelte';
  import TeletextHeader from './headers/TeletextHeader.svelte';
  import VectorHeader from './headers/VectorHeader.svelte';
  import WorkstationHeader from './headers/WorkstationHeader.svelte';
  import type { Section } from './routes';
  import { session } from './session.svelte';
  import { look } from './theme.svelte';

  let { current }: { current: Section } = $props();

  const host = $derived(session.state.status === 'paired' ? session.state.session.host : null);
</script>

<div class="door" use:secretDoor>
  {#if look.theme === 'matrix'}
    <MatrixHeader {current} {host} />
  {:else if look.theme === 'boot'}
    <BootHeader {current} {host} />
  {:else if look.theme === 'teletext'}
    <TeletextHeader {current} {host} />
  {:else if look.theme === 'handheld' || look.theme === 'gameboy'}
    <HandheldHeader {current} {host} />
  {:else if look.theme === 'workstation'}
    <WorkstationHeader {current} {host} />
  {:else if look.theme === 'vector'}
    <VectorHeader {current} {host} />
  {:else if look.theme === 'hacker'}
    <HackerHeader {current} {host} />
  {:else}
    <PlainHeader {current} {host} />
  {/if}
</div>

<style>
  /* Not a box of its own: the header lays out as before. */
  .door {
    display: contents;
  }
</style>
