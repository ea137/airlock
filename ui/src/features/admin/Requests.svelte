<!-- Devices asking to pair, each with the code it shows. Letting one in is
     the laptop's call: the code here must match the one on the device. -->
<script lang="ts">
  import { ago, spacedCode } from '../../lib/format';
  import type { Pairing } from './hub';

  let {
    pairings,
    now,
    onapprove,
    ondeny,
  }: {
    pairings: Pairing[];
    now: number;
    onapprove: (pairing: Pairing) => Promise<void>;
    ondeny: (pairing: Pairing) => Promise<void>;
  } = $props();

  /** The request being answered; its buttons wait until the hub replies. */
  let busy = $state<string | null>(null);

  async function answer(pairing: Pairing, work: (pairing: Pairing) => Promise<void>) {
    if (busy) return;
    busy = pairing.id;
    try {
      await work(pairing);
    } finally {
      busy = null;
    }
  }
</script>

<section aria-labelledby="requests-title">
  <h2 id="requests-title">Waiting to pair</h2>
  {#if pairings.length === 0}
    <p class="empty">No device is asking to pair. To add one, open Airlock on it and ask the laptop.</p>
  {:else}
    <ul class="list">
      {#each pairings as pairing (pairing.id)}
        <li class="card">
          <div class="who">
            <strong>{pairing.name}</strong>
            <span class="meta">{pairing.login} · asked {ago(pairing.created_at, now)}</span>
          </div>
          <div class="code" aria-label={`Code ${pairing.code}`}>{spacedCode(pairing.code)}</div>
          <p class="hint">Let it in only if the device shows this code.</p>
          <div class="actions">
            <button
              class="btn"
              type="button"
              aria-disabled={busy !== null}
              onclick={() => answer(pairing, ondeny)}
            >
              Turn away
            </button>
            <button
              class="btn btn--primary"
              type="button"
              aria-disabled={busy !== null}
              onclick={() => answer(pairing, onapprove)}
            >
              {busy === pairing.id ? 'Answering…' : `Let ${pairing.name} in`}
            </button>
          </div>
        </li>
      {/each}
    </ul>
  {/if}
</section>

<style>
  h2 {
    margin: 0 0 var(--s-3);
    font-size: var(--fs-xl);
    font-weight: 600;
  }
  .empty {
    margin: 0;
    color: var(--c-text-muted);
  }
  .list {
    display: flex;
    flex-direction: column;
    gap: var(--s-3);
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .card {
    display: grid;
    grid-template-columns: 1fr auto;
    align-items: center;
    gap: var(--s-2) var(--s-4);
    padding: var(--s-4);
    border-radius: var(--r-xl);
    background: var(--c-surface);
    box-shadow: 0 0 0 1px var(--c-accent-soft);
  }
  .who {
    display: flex;
    flex-direction: column;
    gap: var(--s-1);
    min-width: 0;
  }
  .who strong {
    font-size: var(--fs-xl);
  }
  .meta,
  .hint {
    color: var(--c-text-muted);
    font-size: var(--fs-md);
  }
  .code {
    grid-row: span 2;
    font: 600 32px var(--font-mono);
    letter-spacing: 3px;
    -webkit-user-select: text;
    user-select: text;
  }
  .hint {
    margin: 0;
  }
  .actions {
    grid-column: 1 / -1;
    display: flex;
    justify-content: flex-end;
    gap: var(--s-2);
  }
</style>
