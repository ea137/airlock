<!-- Picks a folder on the laptop: what's open in a terminal now, then your
     project folders by group (Freelance, Projects, Learning…), then home.
     A field finds one by name; long groups show their newest first. The
     folders come from the laptop, never from the app's own code. -->
<script lang="ts">
  import { api, type Folders } from '../../lib/api';
  import { ago, nowSecs } from '../../lib/format';
  import { handleError, session } from '../../lib/session.svelte';
  import { shortPath } from './labels';

  let { legend, chosen = $bindable('') }: { legend: string; chosen?: string } = $props();

  /** A group shows this many folders until you ask for all of them. */
  const SHORT_LIST = 5;

  type Choice = { path: string; name: string; note: string };
  type Group = { id: string; title: string; choices: Choice[] };
  type Choices = { status: 'loading' } | { status: 'ready'; groups: Group[] } | { status: 'error'; message: string };

  let choices = $state<Choices>({ status: 'loading' });
  let filter = $state('');
  let opened = $state<string[]>([]);

  const home = $derived(session.state.status === 'paired' ? session.state.session.home : '');
  const baseName = (path: string) => path.split('/').filter(Boolean).at(-1) ?? 'home';
  const parentOf = (path: string) => shortPath(path.split('/').slice(0, -1).join('/') || '/', home);

  /** What's open now, then each project root, then home; each folder once. */
  function groupsOf(found: Folders): Group[] {
    const seen = new Set<string>();
    const once = (choice: Choice) => (seen.has(choice.path) ? false : (seen.add(choice.path), true));
    const open: Group = {
      id: 'open',
      title: 'Open in a terminal now',
      choices: found.open
        .map((path) => ({ path, name: path === found.home ? 'Home' : baseName(path), note: parentOf(path) }))
        .filter(once),
    };
    const roots: Group[] = found.roots.map((root) => ({
      id: root.path,
      title: root.name,
      choices: root.projects
        .map((project) => ({ path: project.path, name: project.name, note: `changed ${ago(project.changed_at, nowSecs())}` }))
        .filter(once),
    }));
    const rest: Group = {
      id: 'home',
      title: 'Elsewhere',
      choices: [{ path: found.home, name: 'Home', note: '~' }].filter(once),
    };
    return [open, ...roots, rest].filter((group) => group.choices.length > 0);
  }

  $effect(() => {
    api
      .folders()
      .then((found) => {
        const groups = groupsOf(found);
        choices = { status: 'ready', groups };
        if (!chosen) chosen = groups[0]?.choices[0]?.path ?? found.home;
      })
      .catch((error) => {
        choices = { status: 'error', message: handleError(error).message };
      });
  });

  const words = $derived(filter.trim().toLowerCase());
  const shownGroups = $derived.by(() => {
    if (choices.status !== 'ready') return [];
    return choices.groups
      .map((group) => {
        const matching = words
          ? group.choices.filter(
              (choice) => choice.path === chosen || shortPath(choice.path, home).toLowerCase().includes(words),
            )
          : group.choices;
        const all = words !== '' || opened.includes(group.id) || matching.length <= SHORT_LIST + 1;
        const shown = all ? matching : matching.slice(0, SHORT_LIST);
        // The chosen folder is never folded out of sight.
        const picked = matching.find((choice) => choice.path === chosen);
        if (picked && !shown.includes(picked)) shown.push(picked);
        return { ...group, shown, more: matching.length - shown.length };
      })
      .filter((group) => group.shown.length > 0);
  });
</script>

<fieldset class="start">
  <legend>{legend}</legend>
  {#if choices.status === 'loading'}
    <div class="skeleton" aria-hidden="true"></div>
    <span class="visually-hidden" role="status">Loading folders</span>
  {:else if choices.status === 'error'}
    <p class="error-text" role="alert">{choices.message}</p>
  {:else}
    <label class="find">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"
        ><circle cx="11" cy="11" r="7"></circle><path d="M21 21l-4.3-4.3"></path></svg
      >
      <span class="visually-hidden">Find a folder</span>
      <input type="search" bind:value={filter} placeholder="Find a folder" autocomplete="off" />
    </label>

    <div class="list">
      {#each shownGroups as group (group.id)}
        <div class="group" role="group" aria-label={group.title}>
          <div class="group__title" aria-hidden="true">{group.title}</div>
          {#each group.shown as choice (choice.path)}
            <label class="folder" class:folder--chosen={choice.path === chosen}>
              <input class="visually-hidden" type="radio" name="start-folder" value={choice.path} bind:group={chosen} />
              <span class="folder__icon" aria-hidden="true">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
                  ><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path></svg
                >
              </span>
              <span class="folder__text">
                <span class="folder__name">{choice.name}</span>
                <span class="folder__note">{choice.note}</span>
              </span>
              <span class="folder__tick" aria-hidden="true">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"
                  ><path d="M5 12l5 5 9-10"></path></svg
                >
              </span>
            </label>
          {/each}
          {#if group.more > 0}
            <button class="more" type="button" onclick={() => (opened = [...opened, group.id])}>
              Show {group.more} more in {group.title}
            </button>
          {/if}
        </div>
      {:else}
        <p class="none">No folder is called "{filter.trim()}".</p>
      {/each}
    </div>
  {/if}
</fieldset>

<style>
  legend {
    float: left;
    width: 100%;
    padding: 0;
    color: var(--c-text-muted);
    font-size: var(--fs-sm);
    font-weight: 600;
  }
  .start {
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
    min-width: 0;
    margin: 0;
    padding: 0;
    border: 0;
  }
  .find {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    height: 40px;
    padding: 0 var(--s-3);
    border-radius: var(--r-lg);
    background: var(--c-surface-2);
    color: var(--c-text-muted);
  }
  .find:focus-within {
    box-shadow: 0 0 0 2px var(--c-accent-text);
  }
  .find input {
    flex: 1;
    min-width: 0;
    border: 0;
    background: transparent;
    font-size: var(--fs-lg);
    -webkit-user-select: text;
    user-select: text;
  }
  .find input:focus-visible {
    outline: none;
  }
  /* The folders scroll on their own, so what's around them stays put. It's
     positioned so the hidden radios stay inside it; otherwise they stretch
     the sheet's scroll far past its end. */
  .list {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: var(--s-3);
    max-height: min(46vh, 380px);
    overflow-y: auto;
    padding: 2px;
  }
  .list > * {
    flex-shrink: 0;
  }
  .group {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .group__title {
    padding: 0 var(--s-1) var(--s-1);
    color: var(--c-text-muted);
    font-size: var(--fs-xs);
    font-weight: 700;
    letter-spacing: 0.6px;
    text-transform: uppercase;
  }
  .folder {
    position: relative;
    display: flex;
    align-items: center;
    gap: var(--s-3);
    min-height: 52px;
    padding: var(--s-1) var(--s-3) var(--s-1) var(--s-2);
    border-radius: var(--r-lg);
    background: var(--c-bg);
    cursor: pointer;
    transition-property: background-color, box-shadow;
    transition-duration: var(--t-hover);
  }
  .folder:hover {
    background: var(--c-surface-2);
  }
  .folder--chosen {
    background: var(--c-accent-soft);
    box-shadow: inset 0 0 0 1.5px var(--c-accent);
  }
  .folder:has(input:focus-visible) {
    outline: 2px solid var(--c-accent-text);
    outline-offset: 1px;
  }
  .folder__icon {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 34px;
    height: 34px;
    border-radius: var(--r-md);
    background: var(--c-surface-2);
    color: var(--c-folder);
  }
  .folder__text {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
  .folder__name {
    overflow: hidden;
    font-size: var(--fs-lg);
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .folder__note {
    overflow: hidden;
    color: var(--c-text-muted);
    font-size: var(--fs-sm);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .folder__tick {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    border-radius: var(--r-pill);
    box-shadow: inset 0 0 0 1.5px var(--c-surface-3);
    color: transparent;
  }
  .folder--chosen .folder__tick {
    background: var(--c-accent);
    box-shadow: none;
    color: var(--c-on-accent);
  }
  .more {
    align-self: flex-start;
    min-height: 36px;
    padding: 0 var(--s-2);
    border: 0;
    background: transparent;
    color: var(--c-accent-text);
    font-size: var(--fs-md);
    font-weight: 600;
    cursor: pointer;
  }
  .none {
    margin: 0;
    padding: var(--s-3);
    color: var(--c-text-muted);
  }
  .skeleton {
    height: 220px;
    border-radius: var(--r-lg);
    background: var(--c-bg);
  }
</style>
