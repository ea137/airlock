<script lang="ts">
  import { keepInCase } from './inCase';

  let {
    title,
    body,
    confirm,
    onconfirm,
    onclose,
  }: { title: string; body: string; confirm: string; onconfirm: () => void; onclose: () => void } = $props();

  const titleId = `confirm-${Math.random().toString(36).slice(2, 10)}`;
  let dialog: HTMLDialogElement | undefined = $state();
  let cancel: HTMLButtonElement | undefined = $state();

  $effect(() => {
    if (!dialog) return;
    dialog.showModal();
    keepInCase(dialog);
    cancel?.focus();
  });
</script>

<dialog bind:this={dialog} class="dialog" aria-labelledby={titleId} {onclose}>
  <h2 id={titleId}>{title}</h2>
  <p>{body}</p>
  <div class="actions">
    <button bind:this={cancel} class="btn" type="button" onclick={() => dialog?.close()}>Cancel</button>
    <button
      class="btn btn--danger"
      type="button"
      onclick={() => {
        onconfirm();
        dialog?.close();
      }}
    >
      {confirm}
    </button>
  </div>
</dialog>

<style>
  .dialog {
    width: min(420px, calc(100% - 2 * var(--s-4)));
    padding: var(--s-5);
    border: 0;
    border-radius: var(--r-xl);
    background: var(--c-surface);
    color: var(--c-text);
    box-shadow: var(--shadow-dialog);
  }
  .dialog::backdrop {
    background: var(--c-scrim);
  }
  h2 {
    margin: 0 0 var(--s-2);
    font-size: var(--fs-2xl);
    font-weight: 600;
  }
  p {
    margin: 0 0 var(--s-5);
    color: var(--c-text-muted);
    line-height: 1.45;
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--s-2);
  }
</style>
