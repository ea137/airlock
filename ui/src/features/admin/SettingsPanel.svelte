<!-- What only the laptop decides. -->
<script lang="ts">
  import Switch from '../../lib/Switch.svelte';
  import { type Settings, hub } from './hub';

  let { settings, onchanged }: { settings: Settings; onchanged: () => void } = $props();

  let busy = $state(false);
  let problem = $state<string | null>(null);

  async function setSensitive(on: boolean) {
    busy = true;
    problem = null;
    try {
      await hub.saveSettings({ ...settings, sensitive_files: on });
      onchanged();
    } catch (error) {
      problem = error instanceof Error ? error.message : String(error);
    } finally {
      busy = false;
    }
  }
</script>

<section aria-labelledby="settings-title">
  <h2 id="settings-title">Settings</h2>
  <div class="panel">
    <Switch
      label="The phone may read sensitive files"
      help="Files that look like secrets: .env files, keys, credentials. Airlock's own files are never shown. The terminal can always read anything you can."
      checked={settings.sensitive_files}
      {busy}
      onchange={setSensitive}
    />
  </div>
  {#if problem}<p class="error-text" role="alert">{problem}</p>{/if}
</section>

<style>
  h2 {
    margin: 0 0 var(--s-3);
    font-size: var(--fs-xl);
    font-weight: 600;
  }
  .panel {
    border-radius: var(--r-xl);
    background: var(--c-surface);
    box-shadow: 0 0 0 1px var(--c-line);
  }
  .error-text {
    margin: var(--s-2) 0 0;
  }
</style>
