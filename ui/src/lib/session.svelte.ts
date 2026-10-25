// Whether this device is paired with the laptop, and whether Face ID has it
// locked. Any call the hub answers with "not paired" sends the UI back to
// pairing; one answered with "locked" shows the lock screen.

import { ApiError, api, type Session } from './api';

export type PairedSession = Extract<Session, { paired: true }>;

export type SessionState =
  | { status: 'checking' }
  | { status: 'paired'; session: PairedSession }
  | { status: 'locked'; session: PairedSession | null }
  | { status: 'unpaired' }
  | { status: 'offline'; error: ApiError };

export const session = $state<{ state: SessionState }>({ state: { status: 'checking' } });

export function toApiError(error: unknown): ApiError {
  return error instanceof ApiError ? error : new ApiError(0, error instanceof Error ? error.message : String(error));
}

export async function checkSession(): Promise<void> {
  try {
    const current = await api.session();
    if (!current.paired) {
      session.state = { status: 'unpaired' };
    } else if (current.lock === 'locked') {
      session.state = { status: 'locked', session: current };
    } else {
      session.state = { status: 'paired', session: current };
    }
  } catch (error) {
    session.state = { status: 'offline', error: toApiError(error) };
  }
}

/** Until then, leaving the screen doesn't lock (see {@link leaveOnPurpose}). */
let leavingOnPurposeUntil = 0;

/**
 * The next few seconds' leaving is on purpose and doesn't lock: opening a
 * preview in Safari, which needs Airlock unlocked to show it. The hub still
 * locks it after its quiet time.
 */
export function leaveOnPurpose(): void {
  leavingOnPurposeUntil = Date.now() + 3000;
}

/**
 * With Face ID on, Airlock locks the moment it leaves the screen: another
 * app, the home screen, the phone locking. The lock screen goes up at once,
 * so the app switcher's snapshot shows it, and the hub forgets this
 * browser's unlock, so coming back always takes Face ID.
 */
export function lockWhenHidden(): void {
  const leave = () => {
    const current = session.state;
    if (current.status !== 'paired' || current.session.lock !== 'unlocked') return;
    if (Date.now() < leavingOnPurposeUntil) return;
    session.state = { status: 'locked', session: { ...current.session, lock: 'locked' } };
    // keepalive: the request outlives a page that is going away.
    void fetch('api/faceid/lock', { method: 'POST', keepalive: true, credentials: 'same-origin' }).catch(() => {
      // Not reached: the hub still locks it after its quiet time.
    });
  };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') leave();
  });
  window.addEventListener('pagehide', leave);
}

/** Turns a failure into an ApiError, and goes back to pairing when the
 * device was cut off, or to the lock screen when Face ID locked it. */
export function handleError(error: unknown): ApiError {
  const failure = toApiError(error);
  if (failure.unpaired) {
    session.state = { status: 'unpaired' };
  } else if (failure.locked && session.state.status !== 'locked') {
    const known = session.state.status === 'paired' ? session.state.session : null;
    session.state = { status: 'locked', session: known };
  }
  return failure;
}
