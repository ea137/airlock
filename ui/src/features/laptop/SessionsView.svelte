<!-- Claude Code sessions, live: what each is doing and where, and what it
     did, step by step. A session in one of Airlock's terminals opens here. -->
<script lang="ts">
  import { ago } from '../../lib/format';
  import { hub, type Session, type SessionDetail } from '../admin/hub';

  let { now, onopen }: { now: number; onopen: (terminal: number, name: string) => void } = $props();

  const REFRESH_MS = 3000;
  const STATE = { needs_you: 'Needs you', working: 'Working', idle: 'Idle', ended: 'Ended' } as const;

  let sessions = $state<Session[] | null>(null);
  let open = $state<string | null>(null);
  let detail = $state<SessionDetail | null>(null);
  let problem = $state<string | null>(null);

  $effect(() => {
    const read = async () => {
      try {
        sessions = (await hub.sessions()).sessions;
        if (open) detail = await hub.session(open).catch(() => null);
        problem = null;
      } catch (error) {
        problem = error instanceof Error ? error.message : String(error);
      }
    };
    void read();
    const timer = setInterval(() => void read(), REFRESH_MS);
    return () => clearInterval(timer);
  });

  async function show(session: Session) {
    open = open === session.id ? null : session.id;
    detail = open ? await hub.session(session.id).catch(() => null) : null;
  }

  function where(session: Session): string {
    switch (session.place.kind) {
      case 'airlock':
        return "in one of Airlock's terminals";
      case 'tmux':
        return 'in tmux';
      case 'laptop':
        return `in ${session.place.app ?? 'a terminal'}, shared with the phone`;
      case 'elsewhere':
        return `in ${session.place.app ?? 'a terminal'}`;
      case 'unknown':
        return '';
    }
  }
</script>

<section aria-labelledby="sessions-title">
  <h2 id="sessions-title">Claude sessions</h2>
  {#if problem}<p class="error-text" role="alert">{problem}</p>{/if}
  {#if sessions === null && !problem}
    <p class="note" role="status">Reading the sessions…</p>
  {:else if sessions && sessions.length === 0}
    <p class="empty">No Claude sessions yet. They show up once Claude Code's hooks report to Airlock.</p>
  {:else if sessions}
    <ul class="list">
      {#each sessions as session (session.id)}
        <li class="session" class:session--open={open === session.id}>
          <button class="row" type="button" aria-expanded={open === session.id} onclick={() => show(session)}>
            <span class={`state state--${session.state}`}>{STATE[session.state]}</span>
            <span class="text">
              <span class="name">{session.title ?? 'claude'}</span>
              <span class="meta">
                {session.repo_name ?? session.cwd}{#if session.branch} · {session.branch}{/if}{#if where(session)} · {where(session)}{/if}
              </span>
              <span class="doing">{session.doing}</span>
            </span>
            <span class="when">{ago(session.updated_at, now)}</span>
          </button>
          {#if open === session.id}
            <div class="detail">
              {#if session.terminal}
                {@const link = session.terminal}
                <button class="btn btn--primary" type="button" onclick={() => onopen(link.terminal, session.title ?? 'claude')}>
                  Open its terminal here
                </button>
              {/if}
              <h3>What it did</h3>
              {#if !detail || detail.timeline.length === 0}
                <p class="note">Nothing yet.</p>
              {:else}
                <ol class="steps">
                  {#each detail.timeline as step (step.seq)}
                    <li><span class="step__when">{ago(step.at, now)}</span><span>{step.text}</span></li>
                  {/each}
                </ol>
              {/if}
            </div>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</section>

<style>
  section {
    display: flex;
    flex-direction: column;
    gap: var(--s-3);
  }
  h2 {
    margin: 0;
    font-size: var(--fs-xl);
  }
  h3 {
    margin: 0;
    color: var(--c-text-muted);
    font-size: var(--fs-md);
  }
  .note {
    margin: 0;
    color: var(--c-text-muted);
  }
  .empty {
    margin: 0;
    padding: var(--s-4);
    border-radius: var(--r-xl);
    background: var(--c-surface);
    color: var(--c-text-muted);
  }
  .list {
    margin: 0;
    padding: 0;
    overflow: hidden;
    border-radius: var(--r-xl);
    background: var(--c-surface);
    box-shadow: 0 0 0 1px var(--c-line);
    list-style: none;
  }
  .session + .session {
    border-top: 1px solid var(--c-surface-2);
  }
  .session--open {
    background: var(--c-surface-2);
  }
  .row {
    width: 100%;
    display: flex;
    align-items: flex-start;
    gap: var(--s-3);
    padding: var(--s-3);
    border: 0;
    background: transparent;
    color: var(--c-text);
    text-align: left;
    cursor: pointer;
  }
  .state {
    flex: 0 0 auto;
    padding: 2px var(--s-2);
    border-radius: var(--r-pill);
    background: var(--c-surface-3);
    color: var(--c-text-muted);
    font-size: var(--fs-sm);
    font-weight: 700;
  }
  .state--needs_you {
    background: var(--c-warn-soft);
    color: var(--c-warn);
  }
  .state--working {
    background: var(--c-ok-soft);
    color: var(--c-ok-text);
  }
  .text {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .name {
    font-weight: 600;
  }
  .meta {
    color: var(--c-text-muted);
    font-size: var(--fs-sm);
  }
  .doing {
    color: var(--c-text-soft);
    font-size: var(--fs-md);
  }
  .when {
    color: var(--c-text-muted);
    font-size: var(--fs-sm);
    white-space: nowrap;
  }
  .detail {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--s-2);
    padding: 0 var(--s-3) var(--s-3) var(--s-3);
  }
  .steps {
    display: flex;
    flex-direction: column;
    gap: var(--s-1);
    margin: 0;
    padding: 0;
    font-size: var(--fs-md);
    list-style: none;
  }
  .steps li {
    display: flex;
    gap: var(--s-3);
  }
  .step__when {
    flex: 0 0 72px;
    color: var(--c-text-muted);
  }
  .error-text {
    margin: 0;
  }
</style>
