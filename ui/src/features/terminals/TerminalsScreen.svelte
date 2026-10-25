<!-- The terminals on the laptop: its own terminal app's tabs, then
     Airlock's terminals, each with a preview of its screen, laid out the way
     the theme lays out its terminal list. -->
<script lang="ts">
  import MainHeader from '../../lib/MainHeader.svelte';
  import { session } from '../../lib/session.svelte';
  import { look } from '../../lib/theme.svelte';
  import BootList from './home/BootList.svelte';
  import Cards from './home/Cards.svelte';
  import HackerTable from './home/HackerTable.svelte';
  import HandheldList from './home/HandheldList.svelte';
  import LaptopTabsSection from './LaptopTabsSection.svelte';
  import PocketList from './home/PocketList.svelte';
  import TeletextList from './home/TeletextList.svelte';
  import VectorList from './home/VectorList.svelte';
  import WorkstationList from './home/WorkstationList.svelte';
  import NewTerminalSheet from './NewTerminalSheet.svelte';
  import { newTerminal, terminalList } from './terminals.svelte';

  let creating = $state(false);

  $effect(() => terminalList.watch());

  $effect(() => {
    if (!newTerminal.asked) return;
    newTerminal.asked = false;
    creating = true;
  });

  const paired = $derived(session.state.status === 'paired' ? session.state.session : null);
  const terminals = $derived(terminalList.data);
  const failure = $derived(terminalList.state.status === 'error' ? terminalList.state.error : null);
  const home = $derived(paired?.home ?? '');
  const host = $derived(paired?.host ?? 'laptop');
  const onnew = () => (creating = true);
</script>

{#snippet top()}
  <LaptopTabsSection {home} />

  {#if terminals === null && failure === null}
    {#each [0, 1] as placeholder (placeholder)}
      <div class="skeleton" aria-hidden="true"></div>
    {/each}
    <span class="visually-hidden" role="status">Loading terminals</span>
  {/if}

  {#if failure}
    <div class="problem" role="alert">
      <p>{failure.message}</p>
      <button class="btn" type="button" onclick={() => terminalList.refresh()}>Try again</button>
    </div>
  {/if}

  {#if terminals && terminals.length === 0}
    <div class="empty">
      <p>No Airlock terminals are open. A new one keeps running when you close it here.</p>
    </div>
  {/if}
{/snippet}

<main class="home">
  <MainHeader current="terminals" />

  {#if look.theme === 'boot'}
    <BootList terminals={terminals ?? []} {home} {onnew} {top} />
  {:else if look.theme === 'teletext'}
    <TeletextList terminals={terminals ?? []} {home} {onnew} {top} />
  {:else if look.theme === 'handheld'}
    <HandheldList terminals={terminals ?? []} {home} {onnew} {top} />
  {:else if look.theme === 'gameboy'}
    <PocketList terminals={terminals ?? []} {home} {onnew} {top} />
  {:else if look.theme === 'workstation'}
    <WorkstationList terminals={terminals ?? []} {home} {onnew} {top} />
  {:else if look.theme === 'vector'}
    <VectorList terminals={terminals ?? []} {home} {onnew} {top} />
  {:else if look.theme === 'hacker'}
    <HackerTable terminals={terminals ?? []} {home} {host} {onnew} {top} />
  {:else}
    <Cards terminals={terminals ?? []} {home} {onnew} {top} />
  {/if}

  {#if creating}
    <NewTerminalSheet onclose={() => (creating = false)} />
  {/if}
</main>

<style>
  .home {
    height: 100%;
    display: flex;
    flex-direction: column;
    padding-top: var(--safe-top);
  }
  .skeleton {
    flex: 0 0 auto;
    height: 150px;
    border-radius: var(--r-xl);
    background: var(--c-surface);
  }
  .problem,
  .empty {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--s-3);
    padding: var(--s-4);
    border-radius: var(--r-xl);
    background: var(--c-surface);
    color: var(--c-text-muted);
  }
  .problem p,
  .empty p {
    margin: 0;
  }
  .problem {
    background: var(--c-danger-soft);
    color: var(--c-danger-text);
  }
</style>
