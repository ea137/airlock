<!-- Pairing: this device asks the laptop to let it in, then waits for the
     approval. Shown whenever the hub says this device isn't paired. -->
<script lang="ts">
  import { api } from '../../lib/api';
  import { spacedCode } from '../../lib/format';
  import { checkSession, toApiError } from '../../lib/session.svelte';

  /** How often a waiting phone checks for the laptop's answer. */
  const POLL_MS = 2000;

  type Step = { name: 'ask' } | { name: 'waiting'; code: string };

  let step = $state<Step>({ name: 'ask' });
  let deviceName = $state('');
  let sending = $state(false);
  let notice = $state<string | null>(null);

  // A request already waiting survives a reload.
  $effect(() => {
    api
      .pairStatus()
      .then((status) => {
        if (status.state === 'pending') step = { name: 'waiting', code: status.code };
      })
      .catch(() => {});
  });

  async function ask() {
    if (sending) return;
    sending = true;
    notice = null;
    try {
      const { code } = await api.pair(deviceName);
      step = { name: 'waiting', code };
    } catch (error) {
      notice = toApiError(error).message;
    } finally {
      sending = false;
    }
  }

  $effect(() => {
    if (step.name !== 'waiting') return;
    const timer = setInterval(async () => {
      const status = await api.pairStatus().catch(() => null);
      if (!status || status.state === 'pending') return;
      clearInterval(timer);
      if (status.state === 'approved') {
        await checkSession();
        return;
      }
      notice =
        status.state === 'denied'
          ? 'The laptop turned this device away.'
          : status.state === 'none'
            ? "This browser didn't keep the pairing cookie, so the laptop's answer can't reach it. Allow cookies for this site, then ask again."
            : 'The request expired. Ask again.';
      step = { name: 'ask' };
    }, POLL_MS);
    return () => clearInterval(timer);
  });
</script>

<main class="pair">
  <h1>Airlock</h1>

  {#if step.name === 'ask'}
    <p>This device isn't paired with the laptop yet. Ask the laptop to let it in.</p>
    <div class="field">
      <label for="device-name">Name for this device</label>
      <input
        id="device-name"
        bind:value={deviceName}
        placeholder="iPhone"
        maxlength="40"
        autocomplete="off"
        autocapitalize="words"
      />
    </div>
    <button class="btn btn--primary btn--wide" type="button" onclick={ask} aria-disabled={sending}>
      {sending ? 'Asking…' : 'Ask the laptop'}
    </button>
  {:else}
    <p>On the laptop, approve this code:</p>
    <div class="code" aria-label={`Code ${step.code}`}>{spacedCode(step.code)}</div>
    <p>In a laptop terminal: <code>airlock approve {step.code}</code></p>
    <p class="faint">The request expires in 5 minutes.</p>
  {/if}

  {#if notice}<p class="error-text" role="alert">{notice}</p>{/if}
</main>

<style>
  .pair {
    height: 100%;
    max-width: 380px;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: var(--s-4);
    padding: var(--s-6) var(--s-4);
    text-align: center;
  }
  h1 {
    margin: 0;
    font-size: var(--fs-3xl);
  }
  p {
    margin: 0;
    color: var(--c-text-muted);
    line-height: 1.45;
  }
  .field {
    text-align: left;
  }
  .code {
    padding: var(--s-4) var(--s-5);
    border-radius: var(--r-xl);
    background: var(--c-surface);
    box-shadow: 0 0 0 1px var(--c-line);
    /* One line, even in a wide pixel face on a small phone. */
    font: 600 clamp(24px, 9vw, 40px) var(--font-mono);
    letter-spacing: 4px;
    white-space: nowrap;
    -webkit-user-select: text;
    user-select: text;
  }
  code {
    color: var(--c-text);
    font-family: var(--font-mono);
  }
  .faint {
    color: var(--c-text-faint);
    font-size: var(--fs-md);
  }
</style>
