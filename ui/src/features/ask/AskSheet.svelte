<!-- Ask Claude, from any screen: a question about what you're looking at, or
     the laptop as a whole, answered by Claude Code on the laptop as it
     comes, with what it checks on the way. Follow-ups carry on the
     conversation. The model is chosen in Settings. -->
<script lang="ts">
  import { api } from '../../lib/api';
  import { hrefFor } from '../../lib/router.svelte';
  import Sheet from '../../lib/Sheet.svelte';
  import { asking } from './ask.svelte';
  import AnswerText from './AnswerText.svelte';

  let question = $state('');
  let modelName = $state<string | null>(null);

  // The model's name, for the line under the question.
  $effect(() => {
    if (!asking.open) return;
    const wanted = asking.model;
    api.askModels().then(
      ({ models }) => {
        modelName = (models.find((model) => model.id === wanted) ?? models[0])?.name ?? null;
      },
      () => {
        modelName = null;
      },
    );
  });

  const suggestions = $derived(
    asking.about
      ? ['What is this?', 'Should I worry about it?', 'How do I fix it?']
      : ['Is anything wrong with the laptop?', "What's using the most memory?", 'Why is the disk so full?'],
  );

  function send(text: string) {
    const asked = text.trim();
    if (!asked || asking.busy) return;
    question = '';
    void asking.ask(asked);
  }
</script>

{#if asking.open}
  <Sheet title="Ask Claude" onclose={() => asking.close()}>
    {#if asking.about}
      <p class="about">About <strong>{asking.about.title}</strong></p>
    {/if}

    {#each asking.turns as turn, index (index)}
      <div class="turn">
        <p class="question">{turn.question}</p>
        <div class="reply" aria-live={index === asking.turns.length - 1 ? 'polite' : 'off'}>
          {#if turn.looked.length > 0}
            <ul class="looked" aria-label="What Claude checked">
              {#each turn.looked.slice(-3) as looked, at (at)}
                <li><span aria-hidden="true">↳</span> <code>{looked}</code></li>
              {/each}
            </ul>
          {/if}
          {#if turn.answer}
            <AnswerText text={turn.answer} />
          {:else if !turn.done && !turn.error}
            <p class="thinking" role="status">Claude is looking into it…</p>
          {/if}
          {#if turn.error}<p class="error-text" role="alert">{turn.error}</p>{/if}
        </div>
      </div>
    {/each}

    {#if asking.turns.length === 0}
      <div class="suggestions" role="group" aria-label="Suggestions">
        {#each suggestions as suggestion (suggestion)}
          <button class="chip" type="button" onclick={() => send(suggestion)}>{suggestion}</button>
        {/each}
      </div>
    {/if}

    <form
      class="ask"
      onsubmit={(event) => {
        event.preventDefault();
        send(question);
      }}
    >
      <label class="visually-hidden" for="ask-question">Your question</label>
      <textarea
        id="ask-question"
        rows="2"
        bind:value={question}
        placeholder={asking.turns.length > 0 ? 'Ask a follow-up' : 'Ask about the laptop'}
        onkeydown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            send(question);
          }
        }}
      ></textarea>
      {#if asking.busy}
        <button class="btn" type="button" onclick={() => asking.stop()}>Stop</button>
      {:else}
        <button class="btn btn--primary" type="submit" aria-disabled={!question.trim()}>Ask</button>
      {/if}
    </form>
    <p class="model">
      {modelName ?? 'Claude'} looks around with read-only tools; it can't change anything.
      <a href={hrefFor({ name: 'theme' })} onclick={() => asking.close()}>Model</a>
    </p>
  </Sheet>
{/if}

<style>
  .about {
    margin: 0;
    color: var(--c-text-muted);
    font-size: var(--fs-md);
  }
  .about strong {
    color: var(--c-text);
  }
  .turn {
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
  }
  .question {
    align-self: flex-end;
    max-width: 85%;
    margin: 0;
    padding: var(--s-2) var(--s-3);
    border-radius: var(--r-lg) var(--r-lg) var(--r-sm) var(--r-lg);
    background: var(--c-accent);
    color: var(--c-on-accent);
    overflow-wrap: anywhere;
  }
  .reply {
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
  }
  .looked {
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin: 0;
    padding: 0;
    color: var(--c-text-faint);
    font-size: var(--fs-sm);
    list-style: none;
  }
  .looked code {
    font: var(--fs-xs) var(--font-mono);
    overflow-wrap: anywhere;
  }
  .thinking {
    margin: 0;
    color: var(--c-text-muted);
  }
  .suggestions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s-2);
  }
  .chip {
    min-height: 36px;
    padding: 0 var(--s-3);
    border: 0;
    border-radius: var(--r-pill);
    background: var(--c-surface-2);
    color: var(--c-text);
    font-size: var(--fs-md);
    cursor: pointer;
  }
  .chip:hover {
    background: var(--c-surface-hover);
  }
  .ask {
    display: flex;
    align-items: flex-end;
    gap: var(--s-2);
  }
  textarea {
    flex: 1;
    min-width: 0;
    min-height: var(--tap);
    padding: var(--s-2) var(--s-3);
    border: 1px solid var(--c-line);
    border-radius: var(--r-md);
    background: var(--c-surface-2);
    color: var(--c-text);
    font: inherit;
    resize: none;
    -webkit-user-select: text;
    user-select: text;
  }
  textarea:focus-visible {
    outline: 2px solid var(--c-accent-text);
    outline-offset: 0;
  }
  .model {
    margin: 0;
    color: var(--c-text-faint);
    font-size: var(--fs-sm);
    line-height: 1.4;
  }
  .model a {
    color: var(--c-accent-text);
  }
</style>
