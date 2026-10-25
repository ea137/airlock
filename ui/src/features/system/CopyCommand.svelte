<script lang="ts">
  let { command }: { command: string } = $props();

  let copied = $state(false);
  let problem = $state<string | null>(null);

  async function copy() {
    problem = null;
    try {
      await navigator.clipboard.writeText(command);
      copied = true;
    } catch (error) {
      problem = `Couldn't copy it: ${(error as Error).message}`;
    }
  }
</script>

<div class="command">
  <code>{command}</code>
  <button class="btn btn--quiet copy" type="button" onclick={copy}>{copied ? 'Copied' : 'Copy'}</button>
</div>
{#if problem}<p class="error-text" role="alert">{problem}</p>{/if}

<style>
  .command {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    padding: var(--s-2) var(--s-2) var(--s-2) var(--s-3);
    border-radius: var(--r-md);
    background: var(--c-surface-2);
  }
  code {
    flex: 1;
    min-width: 0;
    font: var(--fs-sm) / 1.4 var(--font-mono);
    overflow-wrap: anywhere;
  }
  .copy {
    flex: 0 0 auto;
    min-height: 36px;
  }
  .error-text {
    margin: 0;
  }
</style>
