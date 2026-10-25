// News pushed by the hub: for now only that a Claude session changed how it
// stands (it waits on you, works, finished, ended), so the screens showing
// sessions ask again at once instead of on their next poll. The news never
// says which session or how; each screen asks for what it shows. Connected
// while something listens and the page is visible; polling carries on
// regardless, so a lost connection only makes things slower.

import { newsUrl } from './api';

type Listener = () => void;

/** Waits before connecting again, after each failure in a row. */
const RETRY_MS = [1000, 3000, 10_000, 30_000];

const listeners = new Set<Listener>();
let socket: WebSocket | null = null;
let retry: ReturnType<typeof setTimeout> | undefined;
let failures = 0;

function connect() {
  clearTimeout(retry);
  if (socket || listeners.size === 0 || document.hidden) return;
  const opened = new WebSocket(newsUrl());
  let live = false;
  socket = opened;
  opened.onopen = () => {
    live = true;
    failures = 0;
  };
  opened.onmessage = (event: MessageEvent<unknown>) => {
    if (typeof event.data === 'string' && event.data.includes('"sessions_changed"')) {
      for (const listener of listeners) listener();
    }
  };
  opened.onclose = () => {
    if (socket !== opened) return;
    socket = null;
    if (listeners.size === 0 || document.hidden) return;
    // The hub ended it: this phone was revoked, or the hub is stopping.
    // What the screens ask next says which, at once.
    if (live) for (const listener of listeners) listener();
    const wait = RETRY_MS[Math.min(failures, RETRY_MS.length - 1)] ?? 30_000;
    failures += 1;
    retry = setTimeout(connect, wait);
  };
}

function disconnect() {
  clearTimeout(retry);
  const open = socket;
  socket = null;
  open?.close();
}

// iOS drops a hidden page's sockets anyway; coming back connects again, and
// the screens refresh what's due on their own.
function onVisibility() {
  if (document.hidden) disconnect();
  else connect();
}

/** Calls `listener` whenever a Claude session changes how it stands; call
 * the result to stop. */
export function onSessionsChanged(listener: Listener): () => void {
  listeners.add(listener);
  if (listeners.size === 1) document.addEventListener('visibilitychange', onVisibility);
  connect();
  return () => {
    if (!listeners.delete(listener) || listeners.size > 0) return;
    document.removeEventListener('visibilitychange', onVisibility);
    disconnect();
  };
}
