<!-- One pull request: its branches, size, checks and files. For looking:
     Full diff and Open on GitHub. -->
<script lang="ts">
  import { api, type PullDetail } from '../../lib/api';
  import { Polled } from '../../lib/polled.svelte';
  import Problem from '../../lib/Problem.svelte';
  import { hrefFor } from '../../lib/router.svelte';
  import SubHeader from '../../lib/SubHeader.svelte';
  import FileList from './FileList.svelte';
  import PullBadge from './PullBadge.svelte';

  let { repoKey, number }: { repoKey: string; number: number } = $props();

  const REFRESH_MS = 30_000;
  const CHECK_MARK = { passed: '✓', failed: '✕', running: '•', skipped: '–', other: '?' } as const;

  const pull = new Polled<PullDetail>(() => api.pull(repoKey, number), REFRESH_MS);
  $effect(() => pull.watch());

  const data = $derived(pull.data);

  function day(iso: string | null): string {
    if (!iso) return '';
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  const when = $derived(
    data?.merged_at
      ? `merged ${day(data.merged_at)}`
      : data?.closed_at
        ? `closed ${day(data.closed_at)}`
        : data
          ? `opened ${day(data.created_at)}`
          : '',
  );
</script>

<main class="screen">
  <SubHeader back={hrefFor({ name: 'repo', key: repoKey })} backLabel="Repo" title={`#${number}`}>
    {#snippet badge()}
      {#if data}<PullBadge state={data.state} draft={data.draft} />{/if}
    {/snippet}
  </SubHeader>

  <div class="scroll">
    {#if data}
      <h2 class="title">{data.title}</h2>
      <p class="branches">{data.head} → {data.base}</p>
      <p class="size">
        <span class="added">+{data.additions.toLocaleString()}</span>
        <span class="removed">−{data.deletions.toLocaleString()}</span>
        · {data.changed_files} files · {when}
      </p>

      <h3>CHECKS</h3>
      {#if data.checks.length === 0}
        <p class="note">No checks ran.</p>
      {:else}
        <ul class="checks">
          {#each data.checks as check, index (index)}
            <li class={`check check--${check.outcome}`}>
              <span class="mark" role="img" aria-label={check.outcome}>{CHECK_MARK[check.outcome]}</span>
              <span class="name">{check.name}</span>
              <span class="outcome">{check.outcome}</span>
            </li>
          {/each}
        </ul>
      {/if}

      <h3>FILES · {data.changed_files}</h3>
      <FileList files={data.files} first={5} />
    {:else if pull.error}
      <Problem message={pull.error.message} onretry={() => pull.refresh()} />
    {:else}
      <span class="visually-hidden" role="status">Loading the pull request</span>
    {/if}
  </div>

  {#if data}
    <footer class="actions">
      <a class="btn btn--primary" href={hrefFor({ name: 'pull-diff', key: repoKey, number })}>Full diff</a>
      <a class="btn" href={data.url} target="_blank" rel="noopener noreferrer">Open on GitHub</a>
    </footer>
  {/if}
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
    gap: var(--s-2);
    padding: var(--s-2) var(--s-4) var(--s-4);
  }
  .title {
    margin: 0;
    font-size: 19px;
    font-weight: 700;
    line-height: 1.3;
  }
  .branches {
    margin: 0;
    color: var(--c-text-soft);
    font: var(--fs-sm) / 1.4 var(--font-mono);
    overflow-wrap: anywhere;
  }
  .size {
    margin: 0 0 var(--s-2);
    color: var(--c-text-muted);
    font-size: var(--fs-md);
  }
  .added {
    color: var(--c-add);
  }
  .removed {
    color: var(--c-del);
  }
  h3 {
    margin: var(--s-2) 0 0;
    color: var(--c-text-muted);
    font-size: var(--fs-md);
    font-weight: 700;
    letter-spacing: 0.5px;
  }
  .checks {
    margin: 0;
    padding: 0;
    overflow: hidden;
    border-radius: var(--r-lg);
    background: var(--c-surface);
    box-shadow: 0 0 0 1px var(--c-line);
    font-size: var(--fs-md);
    list-style: none;
  }
  .check {
    display: flex;
    align-items: center;
    gap: var(--s-3);
    padding: var(--s-2) var(--s-3);
  }
  .check + .check {
    border-top: 1px solid var(--c-surface-2);
  }
  .name {
    flex: 1;
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .outcome {
    color: var(--c-text-muted);
  }
  .check--failed .mark,
  .check--failed .outcome {
    color: var(--c-del);
  }
  .check--passed .mark {
    color: var(--c-add);
  }
  .check--running .mark,
  .check--running .outcome {
    color: var(--c-warn);
  }
  .check--skipped .mark,
  .check--other .mark {
    color: var(--c-text-faint);
  }
  .note {
    margin: 0;
    color: var(--c-text-muted);
    font-size: var(--fs-md);
  }
  .actions {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--s-2);
    padding: var(--s-3) var(--s-4) calc(var(--s-5) + var(--safe-bottom));
  }
</style>
