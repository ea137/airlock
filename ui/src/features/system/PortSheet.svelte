<!-- One listening port, opened from System: what it is, who can reach it,
     whether it should worry you and what to do, and stopping it when the
     phone can. -->
<script lang="ts">
  import type { PortView } from '../../lib/api';
  import { hrefFor } from '../../lib/router.svelte';
  import Sheet from '../../lib/Sheet.svelte';
  import { askAbout } from '../ask/ask.svelte';
  import CopyCommand from './CopyCommand.svelte';
  import { exposureLabel } from './labels';
  import { portStory } from './ports';
  import Verdict from './Verdict.svelte';

  let {
    port,
    firewall,
    previews,
    onstop,
    onterminal,
    onclose,
  }: {
    port: PortView;
    firewall: boolean | null;
    /** Whether the hub serves previews of dev servers. */
    previews: boolean;
    onstop: () => void;
    onterminal: () => void;
    onclose: () => void;
  } = $props();

  const story = $derived(portStory(port, firewall));

  const runBy = $derived(
    port.owner === 'docker'
      ? `the ${port.container ?? ''} container`
      : port.owner === 'you'
        ? port.pid === null
          ? 'you'
          : `you, as process ${port.pid}`
        : 'the system',
  );
</script>

<Sheet title={`:${port.port} ${story.title}`} {onclose}>
  <Verdict {...story.verdict} />

  <section class="part" aria-labelledby="port-what">
    <h3 id="port-what">What it is</h3>
    <p>{story.what}</p>
    <p class="faint">Run by {runBy}{port.image ? ` · ${port.image}` : ''}</p>
  </section>

  <section class="part" aria-labelledby="port-reach">
    <h3 id="port-reach">Who can reach it <span class={`chip chip--${story.verdict.level}`}>{exposureLabel(port.exposure)}</span></h3>
    <p>{story.reach}</p>
  </section>

  {#if story.todo}
    <section class="part" aria-labelledby="port-todo">
      <h3 id="port-todo">What to do</h3>
      <p>{story.todo}</p>
      {#if story.command}<CopyCommand command={story.command} />{/if}
    </section>
  {/if}

  <div class="actions">
    <button
      class="btn btn--wide"
      type="button"
      onclick={() => {
        // Asked before it closes: closing lets go of the port.
        askAbout({
          title: `port ${port.port}, ${story.title}`,
          context: [
            `Listening port ${port.port} on ${port.address}, run by ${runBy}${port.image ? ` (image ${port.image})` : ''}.`,
            story.what,
            `Who can reach it: ${story.reach}`,
            `Airlock's verdict: ${story.verdict.headline}. ${story.verdict.why}`,
            story.todo ? `Airlock suggests: ${story.todo}${story.command ? ` ${story.command}` : ''}` : '',
          ]
            .filter(Boolean)
            .join('\n'),
        });
        onclose();
      }}>Ask Claude about it</button
    >
    {#if port.dev && previews}
      <a class="btn btn--wide" href={hrefFor({ name: 'preview', port: port.port })}>Preview</a>
    {/if}
    {#if port.terminal}
      <button class="btn btn--wide" type="button" onclick={onterminal}>Its terminal</button>
    {/if}
    {#if story.stop === 'process'}
      <button class="btn btn--danger btn--wide" type="button" onclick={onstop}>Stop {port.name}…</button>
    {:else if story.stop === 'container'}
      <button class="btn btn--danger btn--wide" type="button" onclick={onstop}>Stop the container…</button>
    {:else if port.owner === 'system' && port.kind !== 'airlock'}
      <p class="faint">The system runs it, so stopping it needs your password on the laptop; Airlock only looks.</p>
    {/if}
  </div>
</Sheet>

<style>
  .part {
    display: flex;
    flex-direction: column;
    gap: var(--s-1);
  }
  h3 {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    margin: 0;
    color: var(--c-text-muted);
    font-size: var(--fs-md);
    font-weight: 700;
  }
  p {
    margin: 0;
    line-height: 1.45;
  }
  .faint {
    color: var(--c-text-muted);
    font-size: var(--fs-md);
  }
  .chip {
    padding: 2px 7px;
    border-radius: var(--r-pill);
    font-size: var(--fs-xs);
    font-weight: 500;
    white-space: nowrap;
  }
  .chip--safe {
    background: var(--c-surface-2);
    color: var(--c-text-soft);
  }
  .chip--look {
    background: var(--c-warn-soft);
    color: var(--c-warn);
  }
  .chip--worry {
    background: var(--c-danger-soft);
    color: var(--c-danger-text);
  }
  .actions {
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
  }
</style>
