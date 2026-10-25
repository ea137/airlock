// The game's settings, in this browser: on their own, with nothing of the
// game, so Settings can read and change them without loading it.

const SETTINGS = 'airlock.game.settings';

export type Settings = { muted: boolean };

export function readSettings(): Settings {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(SETTINGS) ?? 'null');
    if (saved && typeof saved === 'object' && typeof (saved as Settings).muted === 'boolean') return { muted: (saved as Settings).muted };
  } catch {
    // Unreadable: the default.
  }
  return { muted: false };
}

export function writeSettings(settings: Settings): void {
  try {
    localStorage.setItem(SETTINGS, JSON.stringify(settings));
  } catch {
    // Not remembered; it still applies now.
  }
}
