<!-- A dev server running on the laptop, live. It's shown from Airlock's
     preview origin (this host on its own port), so the app being previewed
     can't reach Airlock. -->
<script lang="ts">
  import { api, type SystemView } from '../../lib/api';
  import { Polled } from '../../lib/polled.svelte';
  import { go, hrefFor } from '../../lib/router.svelte';
  import { handleError, leaveOnPurpose, session } from '../../lib/session.svelte';
  import SubHeader from '../../lib/SubHeader.svelte';
  import { openTerminal } from '../center/open';

  let { port }: { port: number } = $props();

  const REFRESH_MS = 10_000;
  const system = new Polled<SystemView>(() => api.system(), REFRESH_MS);
  $effect(() => system.watch());

  let reloads = $state(0);
  let notice = $state<{ text: string; error: boolean } | null>(null);

  const paired = $derived(session.state.status === 'paired' ? session.state.session : null);
  const origin = $derived(
    paired?.preview_port ? `${location.protocol}//${location.hostname}:${paired.preview_port}` : null,
  );
  const servers = $derived(system.data?.ports.filter((p) => p.dev) ?? []);
  const current = $derived(servers.find((p) => p.port === port));
  const src = $derived(origin ? `${origin}/__airlock/open?port=${port}` : null);

  /** How long the preview origin has to answer before it counts as blocked. */
  const PING_MS = 5000;
  /** Whether the tailnet lets this phone reach the preview port at all. */
  let reach = $state<'checking' | 'open' | 'blocked'>('checking');
  $effect(() => {
    if (!origin) return;
    const stop = new AbortController();
    const timer = setTimeout(() => stop.abort(), PING_MS);
    fetch(`${origin}/__airlock/ping`, { mode: 'no-cors', cache: 'no-store', signal: stop.signal })
      .then(() => (reach = 'open'))
      .catch(() => (reach = 'blocked'))
      .finally(() => clearTimeout(timer));
    return () => {
      clearTimeout(timer);
      stop.abort();
    };
  });

  async function openOnLaptop() {
    notice = null;
    try {
      await api.openDevServer(port);
      notice = { text: 'Opened on the laptop.', error: false };
    } catch (error) {
      notice = { text: handleError(error).message, error: true };
    }
  }
</script>

<main class="screen">
  <SubHeader back={hrefFor({ name: 'system' })} backLabel="System" title="Preview">
    {#snippet badge()}
      {#if src}
        <a class="safari" href={src} target="_blank" rel="noopener noreferrer" aria-label="Open in Safari" onclick={leaveOnPurpose}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
            ><path d="M14 4h6v6"></path><path d="M20 4l-9 9"></path><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"></path></svg
          >
        </a>
      {/if}
    {/snippet}
  </SubHeader>

  {#if servers.length > 0}
    <div class="servers">
      <span class="caption">Running on the laptop</span>
      <div class="chips" role="group" aria-label="Dev servers">
        {#each servers as server (server.port)}
          <button
            class="chip"
            type="button"
            aria-pressed={server.port === port}
            onclick={() => go({ name: 'preview', port: server.port })}
          >
            <span class="dot" aria-hidden="true"></span>:{server.port} · {server.name}
          </button>
        {/each}
      </div>
    </div>
  {/if}

  {#if !origin}
    <p class="note">
      Previews aren't set up on this laptop. They need <code>preview_listen</code> in Airlock's config and Tailscale Serve
      on port 8443.
    </p>
  {:else if reach === 'blocked'}
    <div class="note blocked" role="alert">
      <p><strong>This phone can't reach port {paired?.preview_port} on the laptop.</strong></p>
      <p>
        Previews come from their own port, and your tailnet's access policy doesn't allow it yet. On the laptop, run
        <code>./policy.sh</code> in Airlock's folder and paste what it prints into the Tailscale admin console, under Access
        controls. Then reload.
      </p>
      <button class="btn" type="button" onclick={() => location.reload()}>Reload</button>
    </div>
  {:else}
    <div class="address">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
        ><rect x="5" y="11" width="14" height="10" rx="2"></rect><path d="M8 11V7a4 4 0 0 1 8 0v4"></path></svg
      >
      <span class="url"><span class="host">{location.hostname}</span>:{port}/</span>
      <button class="reload" type="button" aria-label="Reload" onclick={() => (reloads += 1)}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
          ><path d="M20 12a8 8 0 1 1-2.3-5.7"></path><path d="M20 4v5h-5"></path></svg
        >
      </button>
    </div>
    {#key `${port}-${reloads}`}
      <iframe class="page" title={`Preview of :${port}`} src={src ?? ''}></iframe>
    {/key}
  {/if}

  {#if notice}
    <p class={notice.error ? 'error-text notice' : 'notice ok'} role={notice.error ? 'alert' : 'status'}>{notice.text}</p>
  {/if}

  <footer class="actions">
    {#if current?.terminal}
      {@const link = current.terminal}
      <button class="btn" type="button" onclick={() => openTerminal(link)}>Its terminal</button>
    {:else}
      <button class="btn" type="button" disabled>No terminal</button>
    {/if}
    <button class="btn" type="button" onclick={openOnLaptop}>Open on laptop</button>
  </footer>
</main>

<style>
  .screen {
    height: 100%;
    display: flex;
    flex-direction: column;
    padding-top: var(--safe-top);
  }
  .safari {
    display: flex;
    align-items: center;
    justify-content: center;
    width: var(--tap);
    height: var(--tap);
    color: var(--c-accent-text);
  }
  .servers {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 6px var(--s-4) var(--s-3);
  }
  .caption {
    color: var(--c-text-muted);
    font-size: var(--fs-sm);
    font-weight: 600;
  }
  .chips {
    display: flex;
    gap: 6px;
    overflow-x: auto;
  }
  .chip {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: 6px;
    height: 34px;
    padding: 0 var(--s-3);
    border: 0;
    border-radius: var(--r-pill);
    background: var(--c-surface-2);
    color: var(--c-text-muted);
    font-size: var(--fs-md);
    font-weight: 600;
    cursor: pointer;
  }
  .chip[aria-pressed='true'] {
    background: var(--c-accent-soft);
    color: var(--c-accent-text);
  }
  .dot {
    width: 7px;
    height: 7px;
    border-radius: var(--r-pill);
    background: var(--c-ok);
  }
  .address {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    height: 40px;
    margin: 0 var(--s-4) var(--s-3);
    padding: 0 6px 0 var(--s-3);
    border-radius: var(--r-lg);
    background: var(--c-surface-2);
    color: var(--c-ok);
  }
  .url {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    color: var(--c-text-muted);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .host {
    color: var(--c-text);
  }
  .reload {
    width: 36px;
    height: 36px;
    border: 0;
    border-radius: var(--r-md);
    background: transparent;
    color: var(--c-accent-text);
    cursor: pointer;
  }
  .page {
    flex: 1;
    min-height: 0;
    margin: 0 var(--s-2);
    border: 0;
    border-radius: var(--r-xl);
    background: var(--c-web-page);
  }
  .note {
    margin: var(--s-4);
    color: var(--c-text-muted);
    line-height: 1.45;
  }
  .blocked {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--s-2);
    padding: var(--s-4);
    border-radius: var(--r-xl);
    background: var(--c-warn-soft);
    color: var(--c-text);
  }
  .blocked p {
    margin: 0;
  }
  .notice {
    margin: var(--s-2) var(--s-4) 0;
    font-size: var(--fs-md);
  }
  .ok {
    color: var(--c-ok-text);
  }
  .actions {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--s-2);
    padding: var(--s-3) var(--s-4) calc(var(--s-5) + var(--safe-bottom));
  }
</style>
