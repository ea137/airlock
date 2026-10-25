<!-- A tab of the laptop's own terminal app, as it is: its screen and the
     key bar. While you type here it takes the phone's size; typing on the
     laptop takes it back. Hold the header to open the secret game. -->
<script lang="ts">
  import { laptopTabUrl } from '../../lib/api';
  import { go, hrefFor } from '../../lib/router.svelte';
  import { session } from '../../lib/session.svelte';
  import { secretDoor } from '../game/door.svelte';
  import { laptopTabLabel, shortPath } from './labels';
  import { laptopTabList } from './laptopTabs.svelte';
  import type { LinkStatus } from './link';
  import TerminalView from './TerminalView.svelte';

  let { id }: { id: number } = $props();

  let view: TerminalView | undefined = $state();
  let status = $state<LinkStatus>('connecting');

  $effect(() => laptopTabList.watch());

  const tabs = $derived(laptopTabList.data?.tabs);
  const tab = $derived(tabs?.find((other) => other.id === id));
  const home = $derived(session.state.status === 'paired' ? session.state.session.home : '');

  // Closed on the laptop: back to the list.
  $effect(() => {
    if (tabs && !tab) go({ name: 'terminals' });
  });
</script>

<main class="screen">
  <header class="head" use:secretDoor>
    <a class="btn btn--quiet back" href={hrefFor({ name: 'terminals' })}>
      <span aria-hidden="true">‹</span> Terminals
    </a>
    <div class="title">
      <h1>{tab ? laptopTabLabel(tab) : ''}</h1>
      <span class="where">On the laptop{tab ? ` · ${shortPath(tab.folder, home)}` : ''}</span>
    </div>
    <span class={`link link--${status}`} role="status" aria-label={status === 'live' ? 'Connected' : status === 'lost' ? 'Disconnected' : 'Connecting'}
    ></span>
  </header>

  {#if status === 'lost'}
    <div class="banner" role="status">
      <span>The link dropped. Reconnecting…</span>
      <button class="btn btn--quiet" type="button" onclick={() => view?.reconnect()}>Now</button>
    </div>
  {/if}

  <TerminalView
    bind:this={view}
    url={(cols, rows) => laptopTabUrl(id, cols, rows)}
    onstatus={(next) => {
      status = next;
      // Closed on the laptop.
      if (next === 'ended') go({ name: 'terminals' });
    }}
  />
</main>

<style>
  .screen {
    height: 100%;
    display: flex;
    flex-direction: column;
    padding-top: var(--safe-top);
  }
  .head {
    display: grid;
    grid-template-columns: minmax(max-content, 1fr) minmax(0, max-content) minmax(max-content, 1fr);
    align-items: center;
    gap: var(--s-1);
    padding: var(--s-1) var(--s-1) var(--s-1);
  }
  .back {
    justify-self: start;
    padding: 0 var(--s-2);
  }
  .title {
    display: flex;
    flex-direction: column;
    align-items: center;
    min-width: 0;
  }
  h1,
  .where {
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  h1 {
    margin: 0;
    font-size: var(--fs-xl);
    font-weight: 600;
  }
  .where {
    color: var(--c-text-muted);
    font-size: var(--fs-sm);
  }
  .link {
    justify-self: end;
    width: 10px;
    height: 10px;
    margin-right: var(--s-3);
    border-radius: var(--r-pill);
    background: var(--c-warn);
  }
  .link--live {
    background: var(--c-ok);
  }
  .link--lost {
    background: var(--c-danger);
  }
  .banner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--s-2);
    margin: 0;
    padding: 0 var(--s-1) 0 var(--s-3);
    background: var(--c-warn-soft);
    color: var(--c-warn);
    font-size: var(--fs-md);
  }
</style>
