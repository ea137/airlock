<script lang="ts">
  import type { FileType } from './arrange';

  let { type, size = 22 }: { type: FileType; size?: number } = $props();
</script>

{#if type === 'folder'}
  <svg class="icon folder" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
    <path class="fill" d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>
  </svg>
{:else}
  <svg class="icon {type}" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
    <path class="fill" d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"></path>
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"></path>
    <path d="M14 3v5h5"></path>
    {#if type === 'image'}
      <circle cx="9.5" cy="11.5" r="1.2"></circle>
      <path d="M7.5 17.5l3-3 2 2 1.5-1.5 2.5 2.5"></path>
    {:else if type === 'video'}
      <path d="M10 11.5v5l4-2.5z"></path>
    {:else if type === 'audio'}
      <path d="M11 17.5v-6l4-1v6"></path>
      <circle cx="10" cy="17.5" r="1"></circle>
      <circle cx="14" cy="16.5" r="1"></circle>
    {:else if type === 'archive'}
      <path d="M10 6h1M10 9h1M10 12h1M9.5 14.5h2v3h-2z"></path>
    {:else if type === 'pdf' || type === 'document'}
      <path d="M8.5 12h7M8.5 15h7M8.5 18h4"></path>
    {:else if type === 'spreadsheet'}
      <path d="M8.5 11.5h7v6h-7zM8.5 14.5h7M12 11.5v6"></path>
    {:else if type === 'code'}
      <path d="M10 12.5l-2 2 2 2M14 12.5l2 2-2 2"></path>
    {:else if type === 'text'}
      <path d="M8.5 12h7M8.5 15h5"></path>
    {/if}
  </svg>
{/if}

<style>
  .icon {
    flex: 0 0 auto;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.8;
    stroke-linecap: round;
    stroke-linejoin: round;
    color: var(--c-file-plain);
  }
  .fill {
    fill: currentColor;
    stroke: none;
    opacity: 0.14;
  }
  .folder {
    color: var(--c-folder);
  }
  .folder .fill {
    opacity: 0.3;
  }
  .image {
    color: var(--c-file-image);
  }
  .video,
  .audio {
    color: var(--c-file-media);
  }
  .archive {
    color: var(--c-file-archive);
  }
  .pdf {
    color: var(--c-file-pdf);
  }
  .document {
    color: var(--c-file-document);
  }
  .spreadsheet {
    color: var(--c-file-sheet);
  }
  .code {
    color: var(--c-file-code);
  }
</style>
