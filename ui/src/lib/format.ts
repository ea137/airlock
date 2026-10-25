// Small text formats shared by the phone and the laptop app.

/** A six-digit pairing code as people read it: `421 946`. */
export function spacedCode(code: string): string {
  return `${code.slice(0, 3)} ${code.slice(3)}`;
}

/** How long ago `at` was, both in seconds since the epoch: `just now`, `5m ago`. */
export function ago(at: number, now: number): string {
  const secs = Math.max(0, now - at);
  if (secs < 10) return 'just now';
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86_400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86_400)}d ago`;
}

/** Seconds since the epoch, as the hub counts time. */
export function nowSecs(): number {
  return Math.floor(Date.now() / 1000);
}
