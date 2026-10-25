<!-- The secret game opens over the screens (or in the case), only while unlocked. -->
<script lang="ts">
  import CenterScreen from './features/center/CenterScreen.svelte';
  import DiffScreen from './features/center/DiffScreen.svelte';
  import ProjectScreen from './features/center/ProjectScreen.svelte';
  import PullScreen from './features/center/PullScreen.svelte';
  import RepoScreen from './features/center/RepoScreen.svelte';
  import SessionScreen from './features/center/SessionScreen.svelte';
  import StepScreen from './features/center/StepScreen.svelte';
  import LockScreen from './features/faceid/LockScreen.svelte';
  import EditScreen from './features/files/EditScreen.svelte';
  import GameHost from './features/game/GameHost.svelte';
  import HomeScreen from './features/home/HomeScreen.svelte';
  import EditsScreen from './features/files/EditsScreen.svelte';
  import FileScreen from './features/files/FileScreen.svelte';
  import FilesScreen from './features/files/FilesScreen.svelte';
  import Pair from './features/pairing/Pair.svelte';
  import PreviewScreen from './features/system/PreviewScreen.svelte';
  import SystemScreen from './features/system/SystemScreen.svelte';
  import AskSheet from './features/ask/AskSheet.svelte';
  import LaptopTabScreen from './features/terminals/LaptopTabScreen.svelte';
  import TerminalScreen from './features/terminals/TerminalScreen.svelte';
  import TerminalsScreen from './features/terminals/TerminalsScreen.svelte';
  import GameBoyShell from './features/theme/GameBoyShell.svelte';
  import ThemeScreen from './features/theme/ThemeScreen.svelte';
  import { router } from './lib/router.svelte';
  import { checkSession, session } from './lib/session.svelte';
  import { look } from './lib/theme.svelte';
  import ThemeLayer from './lib/ThemeLayer.svelte';

  $effect(() => {
    void checkSession();
  });

  // A terminal, a laptop tab or a preview takes the whole phone.
  const inCase = $derived(
    look.theme === 'gameboy' && !['terminal', 'laptop-tab', 'preview'].includes(router.route.name),
  );
</script>

{#snippet screens()}
  {@const route = router.route}
  {#key route}
    {#if route.name === 'terminals'}
      <TerminalsScreen />
    {:else if route.name === 'terminal'}
      <TerminalScreen id={route.id} />
    {:else if route.name === 'laptop-tab'}
      <LaptopTabScreen id={route.id} />
    {:else if route.name === 'center'}
      <CenterScreen />
    {:else if route.name === 'repo'}
      <RepoScreen repoKey={route.key} />
    {:else if route.name === 'project'}
      <ProjectScreen path={route.path} />
    {:else if route.name === 'session'}
      <SessionScreen id={route.id} />
    {:else if route.name === 'step'}
      <StepScreen id={route.id} seq={route.seq} />
    {:else if route.name === 'pull'}
      <PullScreen repoKey={route.key} number={route.number} />
    {:else if route.name === 'diff'}
      <DiffScreen repoKey={route.key} worktree={route.worktree} />
    {:else if route.name === 'pull-diff'}
      <DiffScreen repoKey={route.key} number={route.number} />
    {:else if route.name === 'files'}
      <FilesScreen path={route.path} />
    {:else if route.name === 'file'}
      <FileScreen path={route.path} />
    {:else if route.name === 'edit'}
      <EditScreen path={route.path} />
    {:else if route.name === 'edits'}
      <EditsScreen />
    {:else if route.name === 'system'}
      <SystemScreen tab={route.tab} port={route.port} unit={route.unit} />
    {:else if route.name === 'preview'}
      <PreviewScreen port={route.port} />
    {:else if route.name === 'theme'}
      <ThemeScreen />
    {:else}
      <HomeScreen />
    {/if}
  {/key}
  <!-- Outside the screens, so a conversation lasts while you look around. -->
  <AskSheet />
{/snippet}

<ThemeLayer />

{#if session.state.status === 'checking'}
  <div class="splash" role="status" aria-label="Connecting to the laptop"></div>
{:else if session.state.status === 'offline'}
  <main class="offline">
    <h1>Can't reach the laptop</h1>
    <p>{session.state.error.message}</p>
    <button class="btn btn--primary" type="button" onclick={() => checkSession()}>Try again</button>
  </main>
{:else if session.state.status === 'unpaired'}
  <Pair />
{:else if session.state.status === 'locked'}
  <LockScreen />
{:else if inCase}
  <GameBoyShell>{@render screens()}</GameBoyShell>
{:else}
  {@render screens()}
  <GameHost />
{/if}

<style>
  .splash {
    height: 100%;
  }
  .offline {
    height: 100%;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    gap: var(--s-4);
    padding: var(--s-6);
    text-align: center;
  }
  h1 {
    margin: 0;
    font-size: var(--fs-2xl);
  }
  p {
    margin: 0;
    color: var(--c-text-muted);
  }
</style>
