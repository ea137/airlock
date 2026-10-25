<!-- The laptop's own terminal tabs (GNOME Terminal's), above Airlock's
     terminals in every theme's list. Until new tabs are shared, it says how
     to share them. -->
<script lang="ts">
  import { ago, nowSecs } from '../../lib/format';
  import { hrefFor } from '../../lib/router.svelte';
  import { laptopTabLabel, shortPath } from './labels';
  import { laptopTabList } from './laptopTabs.svelte';

  let { home }: { home: string } = $props();

  $effect(() => laptopTabList.watch());

  const data = $derived(laptopTabList.data);
</script>

{#if data && (data.tabs.length > 0 || !data.shared)}
  <section class="laptop" aria-labelledby="laptop-tabs-title">
    <h2 id="laptop-tabs-title">ON THE LAPTOP</h2>
    {#if data.tabs.length === 0}
      <p class="hint">
        Your GNOME Terminal tabs can show here as they are, to watch and type in. On the laptop, run
        <code>airlock tabs install</code>; tabs opened after that show up.
      </p>
    {:else}
      <ul class="list">
        {#each data.tabs as tab (tab.id)}
          <li>
            <a class="row" href={hrefFor({ name: 'laptop-tab', id: tab.id })}>
              <span class="icon" aria-hidden="true">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
                  ><rect x="3" y="4" width="18" height="14" rx="2"></rect><path d="M7 9l3 2-3 2M12 14h4M8 21h8"></path></svg
                >
              </span>
              <span class="text">
                <span class="name">{laptopTabLabel(tab)}</span>
                <span class="sub">{shortPath(tab.folder, home)} · {ago(tab.active_at, nowSecs())}</span>
              </span>
              {#if tab.on_phone}<span class="chip">on the phone</span>{/if}
              <span class="chev" aria-hidden="true">›</span>
            </a>
          </li>
        {/each}
      </ul>
    {/if}
  </section>
{/if}

<style>
  .laptop {
    flex: 0 0 auto;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  h2 {
    margin: 0;
    color: var(--c-text-muted);
    font-size: var(--fs-md);
    font-weight: 700;
    letter-spacing: 0.5px;
  }
  .hint {
    margin: 0;
    padding: var(--s-3);
    border-radius: var(--r-lg);
    background: var(--c-surface);
    color: var(--c-text-muted);
    font-size: var(--fs-md);
    line-height: 1.45;
  }
  code {
    color: var(--c-text);
    font: var(--fs-sm) var(--font-mono);
  }
  .list {
    margin: 0;
    padding: 0;
    overflow: hidden;
    border-radius: var(--r-lg);
    background: var(--c-surface);
    box-shadow: 0 0 0 1px var(--c-line);
    list-style: none;
  }
  .list > li + li {
    border-top: 1px solid var(--c-surface-2);
  }
  .row {
    display: flex;
    align-items: center;
    gap: var(--s-3);
    min-height: 52px;
    padding: var(--s-2) var(--s-3);
    color: var(--c-text);
    text-decoration: none;
    transition-property: background-color;
    transition-duration: var(--t-hover);
  }
  .row:hover,
  .row:active {
    background: var(--c-surface-2);
  }
  .icon {
    flex: 0 0 auto;
    display: flex;
    color: var(--c-accent-text);
  }
  .text {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .name,
  .sub {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .name {
    font-weight: 600;
  }
  .sub {
    color: var(--c-text-muted);
    font-size: var(--fs-sm);
  }
  .chip {
    flex: 0 0 auto;
    padding: 2px 7px;
    border-radius: var(--r-pill);
    background: var(--c-ok-soft);
    color: var(--c-ok-text);
    font-size: var(--fs-xs);
    white-space: nowrap;
  }
  .chev {
    color: var(--c-text-faint);
  }
</style>
