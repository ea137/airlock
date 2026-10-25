<!-- Stopping something on the laptop: always asked first. A process is
     asked politely; if it's still running after 5 seconds, you're asked
     again before it is forced. -->
<script lang="ts">
  import { keepInCase } from '../../lib/inCase';
  import { handleError } from '../../lib/session.svelte';

  let {
    name,
    details,
    stop,
    canForce,
    onclose,
    ondone,
  }: {
    name: string;
    /** What it is and what stopping it ends, in a sentence or two. */
    details: string;
    /** Stops it; `force` only after the polite way didn't. Says whether it stopped. */
    stop: (force: boolean) => Promise<boolean>;
    /** Whether forcing is possible (processes, not services). */
    canForce: boolean;
    onclose: () => void;
    ondone: () => void;
  } = $props();

  const titleId = `stop-${Math.random().toString(36).slice(2, 10)}`;
  let dialog: HTMLDialogElement | undefined = $state();
  let cancel: HTMLButtonElement | undefined = $state();
  let step = $state<'ask' | 'stopping' | 'still'>('ask');
  let problem = $state<string | null>(null);

  $effect(() => {
    if (!dialog) return;
    dialog.showModal();
    keepInCase(dialog);
    cancel?.focus();
  });

  async function run(force: boolean) {
    step = 'stopping';
    problem = null;
    try {
      if (await stop(force)) {
        dialog?.close();
        ondone();
        return;
      }
      step = 'still';
    } catch (error) {
      problem = handleError(error).message;
      step = 'ask';
    }
  }
</script>

<dialog bind:this={dialog} class="dialog" role="alertdialog" aria-labelledby={titleId} {onclose}>
  {#if step === 'still'}
    <h2 id={titleId}>{name} is still running</h2>
    <p>It didn't stop when asked. Force it? It won't get to save or clean up.</p>
  {:else}
    <h2 id={titleId}>Stop {name}?</h2>
    <p>{details}</p>
    {#if canForce}
      <p class="faint">
        Airlock asks it to stop politely first. If it is still running after 5 seconds, you'll be asked again before it
        is forced.
      </p>
    {/if}
  {/if}
  {#if problem}<p class="error-text" role="alert">{problem}</p>{/if}
  <div class="actions">
    <button bind:this={cancel} class="btn" type="button" onclick={() => dialog?.close()}>Cancel</button>
    {#if step === 'still'}
      <button class="btn btn--danger" type="button" onclick={() => run(true)}>Force stop</button>
    {:else}
      <button class="btn btn--danger" type="button" aria-disabled={step === 'stopping'} onclick={() => step === 'ask' && run(false)}>
        {step === 'stopping' ? 'Stopping…' : 'Stop'}
      </button>
    {/if}
  </div>
</dialog>

<style>
  .dialog {
    width: min(360px, calc(100% - 2 * 28px));
    padding: var(--s-5) var(--s-4) var(--s-4);
    border: 0;
    border-radius: var(--r-2xl);
    background: var(--c-surface);
    color: var(--c-text);
    box-shadow: var(--shadow-dialog);
    text-align: center;
  }
  .dialog::backdrop {
    background: var(--c-scrim);
  }
  h2 {
    margin: 0 0 var(--s-3);
    font-size: 18px;
    font-weight: 700;
    overflow-wrap: anywhere;
  }
  p {
    margin: 0 0 var(--s-2);
    color: var(--c-text-soft);
    line-height: 1.4;
  }
  .faint {
    color: var(--c-text-muted);
    font-size: var(--fs-md);
  }
  .actions {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--s-2);
    margin-top: var(--s-3);
  }
</style>
