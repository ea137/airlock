<!-- A session waiting on you. For a permission prompt, Allow once (and
     Always, where offered) and Deny are typed into its terminal for you;
     anything else is answered in the terminal itself. -->
<script lang="ts">
  import { api, type ClaudeSession, type Choice } from '../../lib/api';
  import { nowSecs } from '../../lib/format';
  import { handleError } from '../../lib/session.svelte';
  import { lasted, openTerminal } from './open';

  let {
    session,
    always = false,
    named = true,
    onanswered,
  }: {
    session: ClaudeSession;
    /** Offer "Always" too (the session screen does). */
    always?: boolean;
    /** Say which repo and session it is (the center's list does). */
    named?: boolean;
    onanswered: () => void;
  } = $props();

  let busy = $state<Choice | null>(null);
  let problem = $state<string | null>(null);

  const waiting = $derived(session.waiting);
  const canAnswer = $derived(waiting?.kind === 'permission' && session.answerable);

  async function answer(choice: Choice) {
    if (busy) return;
    busy = choice;
    problem = null;
    try {
      await api.answer(session.id, choice);
      onanswered();
    } catch (error) {
      problem = handleError(error).message;
    } finally {
      busy = null;
    }
  }
</script>

{#if waiting}
  <section class="ask" aria-label={`${session.repo_name ?? 'Session'} needs you`}>
    <div class="ask__label">
      <span class="dot" aria-hidden="true"></span>
      NEEDS YOU · {lasted(waiting.since, nowSecs())}
    </div>
    <p class="ask__what">
      {named ? `${session.repo_name ?? session.cwd} · ` : ''}{waiting.headline}
    </p>
    {#if waiting.detail}
      <pre class="ask__detail">{waiting.detail}</pre>
    {/if}
    {#if canAnswer}
      <div class="ask__answers" class:ask__answers--four={always || session.terminal}>
        <button class="btn btn--primary" type="button" aria-disabled={busy !== null} onclick={() => answer('once')}>
          {busy === 'once' ? 'Allowing…' : 'Allow once'}
        </button>
        {#if always}
          <button class="btn" type="button" aria-disabled={busy !== null} onclick={() => answer('always')}>
            {busy === 'always' ? 'Allowing…' : 'Always'}
          </button>
        {/if}
        <button class="btn" type="button" aria-disabled={busy !== null} onclick={() => answer('deny')}>
          {busy === 'deny' ? 'Denying…' : 'Deny'}
        </button>
        {#if session.terminal && !always}
          {@const link = session.terminal}
          <button class="btn" type="button" onclick={() => openTerminal(link)}>Terminal ›</button>
        {/if}
      </div>
      <p class="ask__note">Your answer is typed into its terminal.</p>
    {:else}
      <p class="ask__note">
        {waiting.kind === 'question'
          ? 'It asked a question; answer it in its terminal.'
          : 'It runs outside tmux, so answer it on the laptop.'}
      </p>
      {#if session.terminal}
        {@const link = session.terminal}
        <button class="btn" type="button" onclick={() => openTerminal(link)}>Open its terminal ›</button>
      {/if}
    {/if}
    {#if problem}<p class="error-text" role="alert">{problem}</p>{/if}
  </section>
{/if}

<style>
  .ask {
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
    padding: var(--s-3);
    border-radius: var(--r-xl);
    background: var(--c-warn-soft);
    box-shadow: 0 0 0 1px var(--c-warn);
  }
  .ask__label {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    color: var(--c-warn);
    font-size: var(--fs-sm);
    font-weight: 700;
    letter-spacing: 0.5px;
  }
  .dot {
    width: 8px;
    height: 8px;
    border-radius: var(--r-pill);
    background: var(--c-warn);
  }
  .ask__what {
    margin: 0;
    font-size: var(--fs-lg);
    font-weight: 600;
  }
  .ask__detail {
    margin: 0;
    padding: var(--s-2) var(--s-3);
    border-radius: var(--r-md);
    background: var(--c-code-bg);
    color: var(--c-code);
    font: var(--fs-sm) / 1.45 var(--font-mono);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    -webkit-user-select: text;
    user-select: text;
  }
  .ask__answers {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--s-2);
  }
  .ask__answers--four {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
  .ask__answers .btn {
    min-height: 40px;
    padding: 0 var(--s-2);
    font-size: var(--fs-md);
  }
  .ask__note {
    margin: 0;
    color: var(--c-text-muted);
    font-size: var(--fs-sm);
  }
</style>
