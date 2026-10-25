<!-- Airlock is locked: Face ID (the passkey on this phone) unlocks it. The
     hub refuses everything else until then. -->
<script lang="ts">
  import { api } from '../../lib/api';
  import { assertionJson, passkeyFailure, requestOptions } from '../../lib/passkey';
  import { checkSession, session, toApiError } from '../../lib/session.svelte';

  /** A challenge is good for 2 minutes on the hub; a fresh one is fetched
   * well before, so a tap goes straight to Face ID instead of waiting on a
   * trip to the laptop (long from far away). */
  const READY_FOR_MS = 90_000;

  let busy = $state(false);
  let problem = $state<string | null>(null);
  let ready: { options: PublicKeyCredentialRequestOptions; at: number } | null = null;

  const host = $derived(session.state.status === 'locked' ? session.state.session?.host : undefined);

  async function prepare() {
    try {
      ready = { options: requestOptions(await api.unlockStart()), at: Date.now() };
    } catch {
      ready = null;
    }
  }

  $effect(() => {
    void prepare();
    const timer = setInterval(() => {
      if (!busy && !document.hidden) void prepare();
    }, READY_FOR_MS);
    return () => clearInterval(timer);
  });

  async function unlock() {
    if (busy) return;
    busy = true;
    problem = null;
    try {
      const fresh = ready && Date.now() - ready.at < READY_FOR_MS ? ready.options : null;
      ready = null;
      const options = fresh ?? requestOptions(await api.unlockStart());
      const answer = await navigator.credentials.get({ publicKey: options });
      await api.unlockFinish(assertionJson(answer));
      await checkSession();
    } catch (error) {
      problem = error instanceof DOMException ? passkeyFailure(error) : toApiError(error).message;
      // Ready for the next try.
      void prepare();
    } finally {
      busy = false;
    }
  }
</script>

<main class="lock">
  <div class="badge" aria-hidden="true">
    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"
      ><rect x="5" y="10" width="14" height="10" rx="2"></rect><path d="M8 10V7a4 4 0 0 1 8 0v3"></path><path d="M12 14v2"></path></svg
    >
  </div>
  <h1>Airlock</h1>
  <p class="state">Locked{#if host} · {host}{/if}</p>

  <button class="unlock" type="button" aria-disabled={busy} onclick={unlock}>
    <svg width="54" height="54" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
      ><path d="M3 8V5.5A2.5 2.5 0 0 1 5.5 3H8"></path><path d="M16 3h2.5A2.5 2.5 0 0 1 21 5.5V8"></path><path
        d="M21 16v2.5a2.5 2.5 0 0 1-2.5 2.5H16"
      ></path><path d="M8 21H5.5A2.5 2.5 0 0 1 3 18.5V16"></path><path d="M8.5 9v1.5M15.5 9v1.5"></path><path d="M12 9v4h-1"></path><path
        d="M9 16.5c1.7 1.2 4.3 1.2 6 0"
      ></path></svg
    >
    <span>{busy ? 'Checking…' : 'Unlock with Face ID'}</span>
  </button>

  {#if problem}<p class="error-text" role="alert">{problem}</p>{/if}

  <p class="note">
    Airlock locks as soon as you leave it or lock the phone. If Face ID fails, your iPhone passcode works.
  </p>
  <p class="foot">Lost this phone? Revoke it from the laptop app and it is cut off at once.</p>
</main>

<style>
  .lock {
    height: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: calc(var(--s-8) * 4) 28px calc(var(--s-8) + var(--safe-bottom));
    text-align: center;
  }
  .badge {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 76px;
    height: 76px;
    border-radius: 20px;
    background: var(--c-surface);
    box-shadow: 0 0 0 1px var(--c-surface-3);
    color: var(--c-accent-text);
  }
  h1 {
    margin: 18px 0 var(--s-1);
    font-size: 26px;
    font-weight: 700;
  }
  .state {
    margin: 0;
    color: var(--c-text-muted);
  }
  .unlock {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--s-3);
    width: 100%;
    margin-top: 70px;
    padding: var(--s-5) 0;
    border: 0;
    border-radius: var(--r-2xl);
    background: var(--c-surface);
    box-shadow: 0 0 0 1px var(--c-surface-3);
    color: var(--c-accent-text);
    cursor: pointer;
    transition-property: background-color;
    transition-duration: var(--t-hover);
  }
  .unlock:hover {
    background: var(--c-surface-2);
  }
  .unlock span {
    color: var(--c-text);
    font-size: var(--fs-xl);
    font-weight: 600;
  }
  .unlock[aria-disabled='true'] {
    cursor: default;
  }
  .error-text {
    margin: var(--s-3) 0 0;
  }
  .note {
    margin: var(--s-6) 0 0;
    color: var(--c-text-muted);
    font-size: var(--fs-md);
    line-height: 1.45;
  }
  .foot {
    margin: auto 0 0;
    color: var(--c-text-muted);
    font-size: var(--fs-sm);
    line-height: 1.45;
  }
</style>
