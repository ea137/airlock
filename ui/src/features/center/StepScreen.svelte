<!-- One thing a Claude session did, in full: the command and what it
     printed, the edit as a diff, the file it read or wrote, the search or
     page and what came back. Read from the session's transcript. -->
<script lang="ts">
  import { api, type StepDetail } from '../../lib/api';
  import { ago, nowSecs } from '../../lib/format';
  import Problem from '../../lib/Problem.svelte';
  import { hrefFor } from '../../lib/router.svelte';
  import { handleError, session as appSession } from '../../lib/session.svelte';
  import SubHeader from '../../lib/SubHeader.svelte';
  import { shortPath } from '../terminals/labels';

  let { id, seq }: { id: string; seq: number } = $props();

  type Load = { status: 'loading' } | { status: 'ready'; detail: StepDetail } | { status: 'error'; message: string };
  let load = $state<Load>({ status: 'loading' });

  async function read() {
    load = { status: 'loading' };
    try {
      load = { status: 'ready', detail: await api.stepDetail(id, seq) };
    } catch (error) {
      load = { status: 'error', message: handleError(error).message };
    }
  }

  $effect(() => {
    void read();
  });

  const TITLE: Record<string, string> = {
    Bash: 'Command',
    Edit: 'Edit',
    MultiEdit: 'Edits',
    NotebookEdit: 'Notebook edit',
    Write: 'File written',
    Read: 'File read',
    Grep: 'Search',
    Glob: 'Files found',
    WebFetch: 'Web page',
    WebSearch: 'Web search',
    Task: 'Subagent',
    Agent: 'Subagent',
  };

  const home = $derived(appSession.state.status === 'paired' ? appSession.state.session.home : '');
  const detail = $derived(load.status === 'ready' ? load.detail : null);
  const input = $derived(detail?.call.input ?? {});
  const text = (key: string): string | null => {
    const value = input[key];
    return typeof value === 'string' && value !== '' ? value : null;
  };
  const filePath = $derived(text('file_path') ?? text('notebook_path'));
  const lines = $derived((text('content') ?? '').split('\n'));
  const SHOWN_LINES = 400;
</script>

<main class="screen">
  <SubHeader back={hrefFor({ name: 'session', id })} backLabel="Session" title={detail ? (TITLE[detail.call.tool] ?? detail.call.tool) : 'Step'} />

  <div class="scroll">
    {#if load.status === 'loading'}
      <div class="skeleton" aria-hidden="true"></div>
      <span class="visually-hidden" role="status">Reading the step</span>
    {:else if load.status === 'error'}
      <Problem message={load.message} onretry={read} />
    {:else if detail}
      {@const call = detail.call}
      <p class="sub">
        {detail.step.text} · {ago(detail.step.at, nowSecs())}{#if call.failed}<span class="failed"> · failed</span>{/if}
      </p>

      {#if filePath}
        <a class="file" href={hrefFor({ name: 'file', path: filePath })}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
            ><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"></path><path d="M14 3v5h5"></path></svg
          >
          <span class="file__path">{shortPath(filePath, home)}</span>
          <span class="file__open">Open ›</span>
        </a>
      {/if}

      {#if call.tool === 'Bash'}
        {#if text('description')}<p class="said">{text('description')}</p>{/if}
        <h2>COMMAND</h2>
        <pre class="code">{text('command')}</pre>
      {:else if call.tool === 'Grep' || call.tool === 'Glob'}
        <h2>LOOKED FOR</h2>
        <pre class="code">{text('pattern')}{#if text('path')}  in {shortPath(text('path') ?? '', home)}{/if}{#if text('glob')}  ({text('glob')}){/if}</pre>
      {:else if call.tool === 'WebFetch'}
        {#if text('url')}<a class="url" href={text('url')} target="_blank" rel="noopener noreferrer">{text('url')}</a>{/if}
        {#if text('prompt')}<p class="said">{text('prompt')}</p>{/if}
      {:else if call.tool === 'WebSearch'}
        <h2>SEARCHED FOR</h2>
        <pre class="code">{text('query')}</pre>
      {:else if call.tool === 'Task' || call.tool === 'Agent'}
        {#if text('description')}<p class="said">{text('description')}</p>{/if}
        {#if text('prompt')}
          <h2>ASKED</h2>
          <pre class="code code--wrap">{text('prompt')}</pre>
        {/if}
      {:else if call.tool === 'Read'}
        {#if input.offset || input.limit}
          <p class="said">Lines {Number(input.offset ?? 1)}–{Number(input.offset ?? 1) + Number(input.limit ?? 0)}</p>
        {/if}
      {/if}

      {#if call.diff.length > 0}
        <h2>CHANGE</h2>
        <div class="diff" role="region" aria-label="The change">
          {#each call.diff as line, index (index)}
            {#if line.tag === '@'}
              <div class="line line--gap" aria-hidden="true">⋯</div>
            {:else}
              <div class={`line line--${line.tag === '+' ? 'add' : line.tag === '-' ? 'del' : 'same'}`}>
                <span class="mark" aria-label={line.tag === '+' ? 'added' : line.tag === '-' ? 'removed' : undefined}>{line.tag}</span
                ><span class="text">{line.text}</span>
              </div>
            {/if}
          {/each}
        </div>
      {:else if call.tool === 'Write' && text('content')}
        <h2>WHAT IT WROTE · {lines.length} LINES</h2>
        <pre class="code">{lines.slice(0, SHOWN_LINES).join('\n')}{#if lines.length > SHOWN_LINES}{'\n'}…{/if}</pre>
      {/if}

      {#if !['Bash', 'Edit', 'MultiEdit', 'Write', 'Read', 'Grep', 'Glob', 'WebFetch', 'WebSearch', 'Task', 'Agent'].includes(call.tool)}
        <h2>INPUT</h2>
        <pre class="code">{JSON.stringify(call.input, null, 2)}</pre>
      {/if}

      {#if call.output !== null && call.output !== ''}
        <h2>{call.failed ? 'WHAT WENT WRONG' : call.tool === 'Bash' ? 'OUTPUT' : 'WHAT CAME BACK'}</h2>
        <pre class="code" class:code--failed={call.failed}>{call.output}</pre>
      {:else if call.output === null}
        <p class="note">No result is in the transcript yet.</p>
      {/if}
    {/if}
  </div>
</main>

<style>
  .screen {
    height: 100%;
    display: flex;
    flex-direction: column;
    padding-top: var(--safe-top);
  }
  .scroll {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
    padding: var(--s-2) var(--s-4) calc(var(--s-6) + var(--safe-bottom));
  }
  .sub {
    margin: 0 0 var(--s-2);
    color: var(--c-text-muted);
    font-size: var(--fs-sm);
    text-align: center;
    overflow-wrap: anywhere;
  }
  .failed {
    color: var(--c-danger-text);
    font-weight: 700;
  }
  .file {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    min-height: var(--tap);
    padding: 0 var(--s-3);
    border-radius: var(--r-lg);
    background: var(--c-surface);
    box-shadow: 0 0 0 1px var(--c-line);
    color: var(--c-text);
    text-decoration: none;
  }
  .file__path {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    font: var(--fs-md) var(--font-mono);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .file__open {
    color: var(--c-accent-text);
    font-size: var(--fs-md);
    font-weight: 600;
  }
  .said {
    margin: 0;
    color: var(--c-text-soft);
    font-size: var(--fs-md);
    line-height: 1.45;
  }
  .url {
    color: var(--c-accent-text);
    font: var(--fs-md) var(--font-mono);
    overflow-wrap: anywhere;
  }
  h2 {
    margin: var(--s-2) 0 0;
    color: var(--c-text-muted);
    font-size: var(--fs-md);
    font-weight: 700;
    letter-spacing: 0.5px;
  }
  .code {
    margin: 0;
    padding: var(--s-3);
    overflow-x: auto;
    border-radius: var(--r-lg);
    background: var(--c-code-bg);
    color: var(--c-code);
    font: var(--fs-sm) / 1.5 var(--font-mono);
    white-space: pre;
    -webkit-user-select: text;
    user-select: text;
  }
  .code--wrap {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .code--failed {
    box-shadow: inset 3px 0 0 var(--c-danger);
  }
  .diff {
    overflow-x: auto;
    padding: var(--s-2) 0;
    border-radius: var(--r-lg);
    background: var(--c-code-bg);
    font: var(--fs-sm) / 1.5 var(--font-mono);
    -webkit-user-select: text;
    user-select: text;
  }
  .line {
    display: flex;
    min-width: max-content;
    padding: 0 var(--s-3) 0 0;
    color: var(--c-code);
    white-space: pre;
  }
  .line--add {
    background: var(--c-add-soft);
    color: var(--c-add);
  }
  .line--del {
    background: var(--c-del-soft);
    color: var(--c-del);
  }
  .line--gap {
    justify-content: center;
    color: var(--c-text-faint);
  }
  .mark {
    flex: 0 0 auto;
    width: 22px;
    text-align: center;
    opacity: 0.8;
  }
  .note {
    margin: 0;
    color: var(--c-text-muted);
    font-size: var(--fs-md);
  }
  .skeleton {
    height: 220px;
    border-radius: var(--r-lg);
    background: var(--c-surface);
  }
</style>
