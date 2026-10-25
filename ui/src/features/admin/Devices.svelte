<!-- The paired devices. Revoking one cuts it off at once, after a
     confirmation; it has to pair again to get back in. -->
<script lang="ts">
  import ConfirmDialog from '../../lib/ConfirmDialog.svelte';
  import { ago } from '../../lib/format';
  import type { Device } from './hub';

  let {
    devices,
    now,
    onrevoke,
  }: { devices: Device[]; now: number; onrevoke: (device: Device) => Promise<void> } = $props();

  let asking = $state<Device | null>(null);
  let busy = $state<string | null>(null);

  async function revoke(device: Device) {
    busy = device.id;
    try {
      await onrevoke(device);
    } finally {
      busy = null;
    }
  }
</script>

<section aria-labelledby="devices-title">
  <h2 id="devices-title">Paired devices</h2>
  {#if devices.length === 0}
    <p class="empty">No devices are paired.</p>
  {:else}
    <ul class="list">
      {#each devices as device (device.id)}
        <li class="row">
          <div class="who">
            <strong>
              {device.name}
              {#if device.face_id}<span class="lock">Face ID</span>{/if}
            </strong>
            <span class="meta">
              {device.login} · paired {ago(device.created_at, now)} · seen {ago(device.last_seen, now)}
            </span>
          </div>
          <button
            class="btn btn--quiet revoke"
            type="button"
            aria-disabled={busy !== null}
            onclick={() => {
              if (busy === null) asking = device;
            }}
          >
            {busy === device.id ? 'Revoking…' : 'Revoke'}
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</section>

{#if asking}
  {@const device = asking}
  <ConfirmDialog
    title={`Revoke ${device.name}?`}
    body={`${device.name} is cut off at once, and has to pair again to get back in.`}
    confirm="Revoke"
    onconfirm={() => void revoke(device)}
    onclose={() => (asking = null)}
  />
{/if}

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
    margin: 0;
    padding: 0;
    list-style: none;
    border-radius: var(--r-xl);
    background: var(--c-surface);
    box-shadow: 0 0 0 1px var(--c-line);
  }
  .row {
    display: flex;
    align-items: center;
    gap: var(--s-3);
    padding: var(--s-3) var(--s-3) var(--s-3) var(--s-4);
  }
  .row + .row {
    border-top: 1px solid var(--c-line);
  }
  .who {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: var(--s-1);
    min-width: 0;
  }
  .meta {
    color: var(--c-text-muted);
    font-size: var(--fs-md);
  }
  .lock {
    margin-left: var(--s-2);
    padding: 2px var(--s-2);
    border-radius: var(--r-pill);
    background: var(--c-ok-soft);
    color: var(--c-ok-text);
    font-size: var(--fs-xs);
    font-weight: 600;
  }
  .revoke {
    color: var(--c-danger-text);
  }
</style>
