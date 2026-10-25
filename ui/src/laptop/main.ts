// The laptop app's window, inside Tauri. It reaches the hub through the app's
// own commands, never over the network.

import '@xterm/xterm/css/xterm.css';
import '../styles/tokens.css';
import '../styles/base.css';

import { mount } from 'svelte';

import App from './App.svelte';

// No later code can add to every object through Object.prototype. Frozen
// here, once the imports above have run, rather than by Tauri's
// freezePrototype before them: xterm assigns its own `toString` while it
// loads, which a frozen prototype refuses, leaving the window blank. Any
// module that loads after this point must not do the same.
Object.freeze(Object.prototype);

const target = document.getElementById('app');
if (!target) {
  throw new Error('Airlock: laptop.html has no #app element to mount into.');
}
mount(App, { target });
