<!-- The key bar's "Go to…": picks one of your folders and types the `cd`
     into the terminal. -->
<script lang="ts">
  import Sheet from '../../lib/Sheet.svelte';
  import FolderPicker from './FolderPicker.svelte';
  import { cdInto } from './keys';

  let { ongo, onclose }: { ongo: (command: string) => void; onclose: () => void } = $props();

  let chosen = $state('');
</script>

<Sheet title="Go to a folder" {onclose}>
  <FolderPicker legend="Folder" bind:chosen />
  <button
    class="btn btn--primary btn--wide"
    type="button"
    aria-disabled={!chosen}
    onclick={() => {
      if (!chosen) return;
      ongo(cdInto(chosen));
      onclose();
    }}>Go there</button
  >
</Sheet>
