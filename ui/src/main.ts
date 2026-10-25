import '@xterm/xterm/css/xterm.css';
import './styles/tokens.css';
import './styles/themes.css';
import './styles/base.css';

import { mount } from 'svelte';

import App from './App.svelte';
import { registerWorker } from './features/notifications/push';
import { lockWhenHidden } from './lib/session.svelte';
import { applyLook } from './lib/theme.svelte';

applyLook();
lockWhenHidden();
registerWorker();

// The app is as tall as the visible viewport, so the key bar stays above
// the iOS keyboard.
function fitViewport(): void {
  const height = window.visualViewport?.height ?? window.innerHeight;
  document.documentElement.style.setProperty('--app-height', `${height}px`);
  window.scrollTo(0, 0);
}
window.visualViewport?.addEventListener('resize', fitViewport);
window.addEventListener('resize', fitViewport);
fitViewport();

const target = document.getElementById('app');
if (!target) {
  throw new Error('Airlock: index.html has no #app element to mount into.');
}
mount(App, { target });
