<!-- A full diff, file by file: a worktree's changes since its base, or a pull
     request's. Each file folds open and shut. -->
<script lang="ts">
  import { api, type DiffAnswer } from '../../lib/api';
  import DiffFiles from '../../lib/DiffFiles.svelte';
  import Problem from '../../lib/Problem.svelte';
  import { hrefFor } from '../../lib/router.svelte';
  import { handleError } from '../../lib/session.svelte';
  import SubHeader from '../../lib/SubHeader.svelte';

  let {
    repoKey,
    worktree = null,
    number = null,
  }: { repoKey: string; worktree?: string | null; number?: number | null } = $props();

  type Load = { status: 'loading' } | { status: 'ready'; answer: DiffAnswer } | { status: 'error'; message: string };
  let load = $state<Load>({ status: 'loading' });

  async function fetchDiff() {
    load = { status: 'loading' };
    try {
      const answer =
        number !== null ? await api.pullDiff(repoKey, number) : await api.worktreeDiff(repoKey, worktree ?? '');
      load = { status: 'ready', answer };
    } catch (error) {
      load = { status: 'error', message: handleError(error).message };
    }
  }

  $effect(() => {
    void fetchDiff();
  });

  const back = $derived(
    number !== null
      ? { href: hrefFor({ name: 'pull', key: repoKey, number }), label: `#${number}` }
      : { href: hrefFor({ name: 'repo', key: repoKey }), label: 'Repo' },
  );
  const subtitle = $derived(
    load.status !== 'ready'
      ? ''
      : number !== null
        ? `${load.answer.diff.files.length} files`
        : `${load.answer.diff.files.length} files${load.answer.compared_to ? ` since ${load.answer.compared_to}` : ''}, uncommitted changes included`,
  );
</script>

<main class="screen">
  <SubHeader back={back.href} backLabel={back.label} title="Diff" />

  <div class="scroll">
    {#if load.status === 'ready'}
      {@const diff = load.answer.diff}
      <p class="sub">{subtitle}</p>
      {#if diff.truncated}
        <p class="truncated" role="status">This diff is too big to show whole; the end is cut off.</p>
      {/if}
      {#if diff.files.length === 0}
        <p class="note">No changes.</p>
      {/if}
      <div><DiffFiles files={diff.files} /></div>
    {:else if load.status === 'error'}
      <Problem message={load.message} onretry={() => fetchDiff()} />
    {:else}
      <span class="visually-hidden" role="status">Loading the diff</span>
    {/if}
  </div>
</main>

<style>
  .screen {
    height: 100%;
    display: flex;
    flex-direction: column;
    padding-top: var(--safe-top);
  }
  .scroll {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: var(--s-3);
    padding: var(--s-2) var(--s-3) calc(var(--s-6) + var(--safe-bottom));
  }
  .sub {
    margin: 0;
    color: var(--c-text-muted);
    font-size: var(--fs-sm);
    text-align: center;
  }
  .truncated {
    margin: 0;
    padding: var(--s-2) var(--s-3);
    border-radius: var(--r-md);
    background: var(--c-warn-soft);
    color: var(--c-warn);
    font-size: var(--fs-md);
  }
  .note {
    margin: 0;
    color: var(--c-text-muted);
    font-size: var(--fs-md);
  }
</style>
