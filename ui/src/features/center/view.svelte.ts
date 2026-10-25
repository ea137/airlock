// How this phone shows the command center: the projects and groups you
// hid, and the groups you folded. Kept in this browser only; storage can be
// unavailable (private browsing), and then it's just for now.

const KEY = 'airlock.centerView';

export type CenterView = { hidden: string[]; folded: string[] };

/** A saved view, as stored; anything missing or malformed is empty. */
export function parseView(text: string | null): CenterView {
  try {
    const saved: unknown = JSON.parse(text ?? 'null');
    const fields = saved && typeof saved === 'object' ? (saved as Record<string, unknown>) : {};
    const strings = (value: unknown) =>
      Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
    return { hidden: strings(fields.hidden), folded: strings(fields.folded) };
  } catch {
    return { hidden: [], folded: [] };
  }
}

function saved(): CenterView {
  try {
    return parseView(localStorage.getItem(KEY));
  } catch {
    return { hidden: [], folded: [] };
  }
}

export const centerView = $state<CenterView>(saved());

function save(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(centerView));
  } catch {
    // Not remembered; it still applies now.
  }
}

function toggle(list: string[], item: string): string[] {
  return list.includes(item) ? list.filter((other) => other !== item) : [...list, item];
}

/** Hides a project or a group (by its path or name), or shows it again. */
export function toggleHidden(key: string): void {
  centerView.hidden = toggle(centerView.hidden, key);
  save();
}

export function toggleFolded(key: string): void {
  centerView.folded = toggle(centerView.folded, key);
  save();
}
