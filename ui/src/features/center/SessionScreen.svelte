<!-- One Claude session: where it runs, what it waits for, what it did, and
     the files its branch changed. -->
<script lang="ts">
  import { api, type ClaudeSession, type SessionDetail } from '../../lib/api';
  import ConfirmDialog from '../../lib/ConfirmDialog.svelte';
  import { ago, nowSecs } from '../../lib/format';
  import { onSessionsChanged } from '../../lib/news';
  import { Polled } from '../../lib/polled.svelte';
  import Problem from '../../lib/Problem.svelte';
  import { go, hrefFor } from '../../lib/router.svelte';
  import { session as appSession, handleError } from '../../lib/session.svelte';
  import SubHeader from '../../lib/SubHeader.svelte';
  import { shortPath } from '../terminals/labels';
  import FileList from './FileList.svelte';
  import { sessionName } from './labels';
  import LiveScreen from './LiveScreen.svelte';
  import NeedsYou from './NeedsYou.svelte';
  import { lasted, openTerminal } from './open';

  let { id }: { id: string } = $props();

  const REFRESH_MS = 3000;
  const STATE_LABEL = { needs_you: 'Needs you', working: 'Working', idle: 'Idle', ended: 'Ended' } as const;

  const detail = new Polled<SessionDetail>(() => api.claudeSession(id), REFRESH_MS);
  $effect(() => detail.watch());
  // A prompt shows the moment it comes, not on the next poll.
  $effect(() => onSessionsChanged(() => detail.nudge()));

  const data = $derived(detail.data);
  const current = $derived(data?.session);
  const home = $derived(appSession.state.status === 'paired' ? appSession.state.session.home : '');
  const back = $derived(
    current?.repo
      ? { href: hrefFor({ name: 'repo', key: current.repo }), label: current.repo_name ?? 'Repo' }
      : { href: hrefFor({ name: 'center' }), label: 'Work' },
  );

  let continuing = $state(false);
  let askingToMove = $state(false);
  let problem = $state<string | null>(null);

  function placeWords(place: ClaudeSession['place']): string {
    switch (place.kind) {
      case 'airlock':
        return "in one of Airlock's terminals";
      case 'tmux':
        return 'in tmux';
      case 'laptop':
        return `in a ${place.app ?? 'laptop'} tab the phone reaches`;
      case 'elsewhere':
        return `in ${place.app ?? 'a terminal'}, outside tmux`;
      case 'unknown':
        return 'somewhere its hooks didn’t say';
    }
  }

  /** Carries the session on in an Airlock terminal: moved from the laptop
   * terminal it is open in, or continued once nothing runs it. */
  async function carryOn(how: 'move' | 'continue') {
    if (continuing) return;
    continuing = true;
    problem = null;
    try {
      const { terminal } = await (how === 'move' ? api.moveSession(id) : api.continueSession(id));
      go({ name: 'terminal', id: terminal });
    } catch (error) {
      problem = handleError(error).message;
    } finally {
      continuing = false;
    }
  }
</script>

<main class="screen">
  <SubHeader back={back.href} backLabel={back.label} title={current ? sessionName(current) : 'Session'}>
    {#snippet badge()}
      {#if current}<span class={`state state--${current.state}`}>{STATE_LABEL[current.state]}</span>{/if}
    {/snippet}
  </SubHeader>

  <div class="scroll">
    {#if data && current}
      <dl class="facts">
        <dt>Worktree</dt>
        <dd>{shortPath(current.worktree ?? current.cwd, home)}</dd>
        {#if current.branch}
          <dt>Branch</dt>
          <dd class="mono">{current.branch}</dd>
        {/if}
        <dt>{current.state === 'ended' ? 'Ran' : 'Running'}</dt>
        <dd>
          {lasted(current.started_at, nowSecs())}
          {#if current.terminal}
            {@const link = current.terminal}
            · <button class="inline" type="button" onclick={() => openTerminal(link)}>in its terminal ›</button>
          {:else if current.state !== 'ended'}
            · {placeWords(current.place)}
          {/if}
        </dd>
      </dl>

      {#if current.state === 'needs_you'}
        <NeedsYou session={current} always named={false} onanswered={() => detail.refresh()} />
      {:else}
        <p class="doing">{current.doing}</p>
      {/if}

      {#if current.state !== 'ended'}
        <h2>ITS TERMINAL</h2>
        {#if current.place.kind === 'airlock' || current.place.kind === 'tmux' || current.place.kind === 'laptop'}
          {@const link = current.terminal}
          {@const tab = current.laptop_tab}
          <LiveScreen
            {id}
            onopen={link
              ? () => openTerminal(link)
              : tab !== null
                ? () => go({ name: 'laptop-tab', id: tab })
                : null}
          />
        {:else if current.place.kind === 'elsewhere'}
          {@const working = current.state === 'working'}
          <div class="away">
            <p>
              It's open in {current.place.app ?? 'a terminal'} on the laptop, in a tab opened before it was shared, so the
              phone can follow it but not type into it.
            </p>
            <p>
              <strong>Share with the phone:</strong> Claude quits in that tab, and the same conversation carries on in a
              terminal both reach: here, and in a new window on the laptop. There's only ever one Claude on it.
            </p>
            {#if working}<p class="note">It's working. It can be shared once it has finished its turn.</p>{/if}
            <button
              class="btn btn--primary"
              type="button"
              aria-disabled={continuing || working}
              onclick={() => {
                if (!continuing && !working) askingToMove = true;
              }}
            >
              {continuing ? 'Sharing…' : 'Share with the phone'}
            </button>
            {#if problem}<p class="error-text" role="alert">{problem}</p>{/if}
          </div>
        {:else}
          <div class="away">
            <p>Airlock hasn't heard where it runs: its hooks didn't say.</p>
            <p>
              <strong>Continue it here:</strong> Airlock opens a terminal in its folder and picks the conversation up with
              <code>claude --resume</code>. If it's still open somewhere, close it there first.
            </p>
            <button class="btn btn--primary" type="button" aria-disabled={continuing} onclick={() => carryOn('continue')}>
              {continuing ? 'Opening…' : 'Continue it here'}
            </button>
            {#if problem}<p class="error-text" role="alert">{problem}</p>{/if}
          </div>
        {/if}
      {:else}
        <div class="away">
          <p>It has ended. Continue it here picks the conversation up in an Airlock terminal, in its folder.</p>
          <button class="btn btn--primary" type="button" aria-disabled={continuing} onclick={() => carryOn('continue')}>
            {continuing ? 'Opening…' : 'Continue it here'}
          </button>
          {#if problem}<p class="error-text" role="alert">{problem}</p>{/if}
        </div>
      {/if}

      <h2>WHAT IT DID</h2>
      {#if data.timeline.length === 0}
        <p class="note">Nothing yet.</p>
      {:else}
        <ol class="steps">
          {#each data.timeline as step (step.seq)}
            <li>
              {#if step.tool}
                <a class="step step--open" href={hrefFor({ name: 'step', id, seq: step.seq })}>
                  <span class="when">{ago(step.at, nowSecs())}</span>
                  <span class="what">{step.text}</span>
                  <span class="chev" aria-hidden="true">›</span>
                </a>
              {:else}
                <div class="step">
                  <span class="when">{ago(step.at, nowSecs())}</span>
                  <span class="what">{step.text}</span>
                </div>
              {/if}
            </li>
          {/each}
        </ol>
      {/if}

      {#if current.worktree}
        <h2>ON THIS BRANCH · {data.files.length} FILES</h2>
        {#if data.files.length === 0}
          <p class="note">No changes{#if data.compared_to} since {data.compared_to}{/if}.</p>
        {:else}
          <FileList files={data.files} />
        {/if}
      {/if}
    {:else if detail.error}
      <Problem message={detail.error.message} onretry={() => detail.refresh()} />
    {:else}
      <span class="visually-hidden" role="status">Loading the session</span>
    {/if}
  </div>

  {#if current?.repo && current.worktree}
    <footer class="actions">
      <a class="btn btn--primary" href={hrefFor({ name: 'diff', key: current.repo, worktree: current.worktree })}>Full diff</a>
      {#if data?.github_url}
        <a class="btn" href={data.github_url} target="_blank" rel="noopener noreferrer">Branch on GitHub</a>
      {/if}
    </footer>
  {/if}

  {#if askingToMove}
    <ConfirmDialog
      title="Share this session with the phone?"
      body={`Claude quits in its ${current?.place.app ?? 'terminal'} tab on the laptop, then the conversation carries on where it stopped, in a terminal shown here and in a new window on the laptop.`}
      confirm="Share it"
      onconfirm={() => {
        askingToMove = false;
        void carryOn('move');
      }}
      onclose={() => (askingToMove = false)}
    />
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
    gap: var(--s-3);
    padding: var(--s-2) var(--s-4) var(--s-4);
  }
  .state {
    padding: 3px var(--s-2);
    border-radius: var(--r-pill);
    font-size: var(--fs-sm);
    font-weight: 700;
    white-space: nowrap;
  }
  .state--needs_you {
    background: var(--c-warn-soft);
    color: var(--c-warn);
  }
  .state--working {
    background: var(--c-ok-soft);
    color: var(--c-ok-text);
  }
  .state--idle,
  .state--ended {
    background: var(--c-surface-2);
    color: var(--c-text-muted);
  }
  .facts {
    display: grid;
    grid-template-columns: 84px 1fr;
    row-gap: var(--s-1);
    margin: 0;
    font-size: var(--fs-md);
  }
  dt {
    color: var(--c-text-muted);
  }
  dd {
    margin: 0;
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .mono {
    font: var(--fs-sm) / 1.5 var(--font-mono);
  }
  .inline {
    min-height: 24px;
    padding: 0;
    border: 0;
    background: none;
    color: var(--c-accent-text);
    font: inherit;
    cursor: pointer;
  }
  .doing {
    margin: 0;
    padding: var(--s-3);
    border-radius: var(--r-xl);
    background: var(--c-surface);
    color: var(--c-text-soft);
  }
  h2 {
    margin: var(--s-2) 0 0;
    color: var(--c-text-muted);
    font-size: var(--fs-md);
    font-weight: 700;
    letter-spacing: 0.5px;
  }
  .steps {
    margin: 0;
    padding: 0;
    overflow: hidden;
    border-radius: var(--r-xl);
    background: var(--c-surface);
    box-shadow: 0 0 0 1px var(--c-line);
    font-size: var(--fs-md);
    list-style: none;
  }
  .steps li + li {
    border-top: 1px solid var(--c-surface-2);
  }
  .step {
    display: flex;
    align-items: center;
    gap: var(--s-3);
    min-height: 44px;
    padding: var(--s-2) var(--s-3);
    color: var(--c-text-soft);
    text-decoration: none;
  }
  .step--open {
    color: var(--c-text);
  }
  .step--open:hover,
  .step--open:active {
    background: var(--c-surface-2);
  }
  .when {
    flex: 0 0 60px;
    color: var(--c-text-muted);
    font-size: var(--fs-sm);
  }
  .what {
    flex: 1;
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .chev {
    color: var(--c-text-faint);
  }
  .away {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--s-2);
    padding: var(--s-3);
    border-radius: var(--r-xl);
    background: var(--c-surface);
    box-shadow: 0 0 0 1px var(--c-line);
    color: var(--c-text-soft);
    font-size: var(--fs-md);
    line-height: 1.45;
  }
  .away p {
    margin: 0;
  }
  .away code {
    font: var(--fs-sm) var(--font-mono);
  }
  .note {
    margin: 0;
    color: var(--c-text-muted);
    font-size: var(--fs-md);
  }
  .actions {
    display: grid;
    grid-auto-columns: minmax(0, 1fr);
    grid-auto-flow: column;
    gap: var(--s-2);
    padding: var(--s-3) var(--s-4) calc(var(--s-5) + var(--safe-bottom));
  }
</style>
