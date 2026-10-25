<script lang="ts">
  let { message, onretry }: { message: string; onretry: () => void } = $props();
</script>

<div class="problem" role="alert">
  <p>{message}</p>
  <button class="btn" type="button" onclick={onretry}>Try again</button>
</div>

<style>
  .problem {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--s-3);
    padding: var(--s-4);
    border-radius: var(--r-xl);
    background: var(--c-danger-soft);
    color: var(--c-danger-text);
  }
  p {
    margin: 0;
    overflow-wrap: anywhere;
  }
</style>
