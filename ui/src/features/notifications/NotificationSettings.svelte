<!-- Settings' Notifications: when Claude waits on you or finishes, a
     notification on this phone, even with Airlock closed and the phone
     locked. On an iPhone they need Airlock on the Home Screen, opened from
     there; this says how until it is. -->
<script lang="ts">
  import { api } from '../../lib/api';
  import { type PushStatus, pushStatus, turnOff, turnOn } from './push';

  let status = $state<PushStatus | 'checking'>('checking');
  let busy = $state(false);
  let problem = $state<string | null>(null);
  let note = $state<string | null>(null);

  $effect(() => {
    pushStatus().then(
      (found) => (status = found),
      (error: unknown) => {
        status = 'off';
        problem = `Couldn't tell whether notifications are on: ${(error as Error).message}`;
      },
    );
  });

  async function act(action: () => Promise<PushStatus | void>, done?: string) {
    busy = true;
    problem = null;
    note = null;
    try {
      const next = await action();
      if (next) status = next;
      if (done) note = done;
    } catch (error) {
      problem = (error as Error).message;
    } finally {
      busy = false;
    }
  }
</script>

<div class="settings">
  {#if status === 'checking'}
    <p class="note" role="status">Checking…</p>
  {:else if status === 'home-screen'}
    <div class="explain">
      <p>To get notifications on this iPhone, Airlock has to be on the Home Screen:</p>
      <ol>
        <li>Tap Share <span aria-hidden="true">(the square with the arrow)</span>, then <strong>Add to Home Screen</strong>.</li>
        <li>Open Airlock from its icon on the Home Screen.</li>
        <li>Come back here and turn notifications on.</li>
      </ol>
    </div>
  {:else if status === 'unsupported'}
    <p class="note">This browser can't show notifications from a website.</p>
  {:else if status === 'blocked'}
    <p class="note">Notifications are turned off for Airlock in the phone's settings (Settings, Notifications, Airlock). Allow them there, then come back.</p>
  {:else}
    <div class="row">
      <span class="text">
        <span class="label">{status === 'on' ? 'Notifications are on' : 'Notifications are off'}</span>
        <span class="help">When Claude waits on you or finishes, with the terminal it's in, and nothing of what it asks.</span>
      </span>
    </div>
    <div class="actions">
      {#if status === 'on'}
        <button class="btn" type="button" disabled={busy} onclick={() =>
            act(async () => {
              await api.pushTest();
            }, 'Sent. It should show in a moment.')}>Send a test</button>
        <button class="btn btn--quiet" type="button" disabled={busy} onclick={() => act(turnOff)}>Turn off</button>
      {:else}
        <button class="btn btn--primary" type="button" disabled={busy} onclick={() => act(turnOn)}>Turn on notifications</button>
      {/if}
    </div>
  {/if}
  {#if note}<p class="note" role="status">{note}</p>{/if}
  {#if problem}<p class="error-text note" role="alert">{problem}</p>{/if}
</div>

<style>
  .settings {
    overflow: hidden;
    border-radius: var(--r-lg);
    background: var(--c-surface);
    box-shadow: 0 0 0 1px var(--c-line);
  }
  .row,
  .explain,
  .actions,
  .note {
    margin: 0;
    padding: var(--s-3);
  }
  .text {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .label {
    font-weight: 600;
  }
  .help,
  .note {
    color: var(--c-text-muted);
    font-size: var(--fs-sm);
    line-height: 1.4;
  }
  .explain p,
  .explain ol {
    margin: 0;
    line-height: 1.5;
  }
  .explain ol {
    margin-top: var(--s-2);
    padding-left: var(--s-5);
  }
  .actions {
    display: flex;
    gap: var(--s-2);
    padding-top: 0;
  }
</style>
