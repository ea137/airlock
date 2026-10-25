<!-- Offered once paired, until set up or put off: lock Airlock with Face ID,
     so a copied cookie alone gets nobody in. -->
<script lang="ts">
  import { api } from '../../lib/api';
  import { creationOptions, passkeyFailure, passkeysAvailable, registrationJson } from '../../lib/passkey';
  import { checkSession, session, toApiError } from '../../lib/session.svelte';

  const LATER_KEY = 'airlock.faceIdLater';

  function putOff(): boolean {
    try {
      return localStorage.getItem(LATER_KEY) === '1';
    } catch {
      return false;
    }
  }

  let later = $state(putOff());
  let busy = $state(false);
  let problem = $state<string | null>(null);

  const offered = $derived(
    !later && passkeysAvailable() && session.state.status === 'paired' && session.state.session.lock === 'none',
  );

  function notNow() {
    later = true;
    try {
      localStorage.setItem(LATER_KEY, '1');
    } catch {
      // Not remembered; it's hidden for now.
    }
  }

  async function setUp() {
    if (busy) return;
    busy = true;
    problem = null;
    try {
      const options = creationOptions(await api.faceIdSetupStart());
      const credential = await navigator.credentials.create({ publicKey: options });
      await api.faceIdSetupFinish(registrationJson(credential));
      await checkSession();
    } catch (error) {
      problem = error instanceof DOMException ? passkeyFailure(error) : toApiError(error).message;
    } finally {
      busy = false;
    }
  }
</script>

{#if offered}
  <section class="offer" aria-labelledby="faceid-title">
    <h2 id="faceid-title">Lock Airlock with Face ID</h2>
    <p>
      After 5 minutes in the background, Airlock asks for Face ID. Someone with a copy of this phone's cookie still
      can't get in.
    </p>
    <div class="actions">
      <button class="btn" type="button" onclick={notNow}>Not now</button>
      <button class="btn btn--primary" type="button" aria-disabled={busy} onclick={setUp}>
        {busy ? 'Setting up…' : 'Set up Face ID'}
      </button>
    </div>
    {#if problem}<p class="error-text" role="alert">{problem}</p>{/if}
  </section>
{/if}

<style>
  .offer {
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
    padding: var(--s-3) var(--s-4) var(--s-4);
    border-radius: var(--r-xl);
    background: var(--c-accent-soft);
    box-shadow: 0 0 0 1px var(--c-accent);
  }
  h2 {
    margin: 0;
    font-size: var(--fs-xl);
    font-weight: 600;
  }
  p {
    margin: 0;
    color: var(--c-text-soft);
    font-size: var(--fs-md);
    line-height: 1.45;
  }
  .actions {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--s-2);
    margin-top: var(--s-1);
  }
  .error-text {
    margin: 0;
  }
</style>
