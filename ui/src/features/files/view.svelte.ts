// How this phone lays folders out: a list or a grid, and the order. Kept in
// this browser only; storage can be unavailable (private browsing), and
// then it's just for now.

import { type Arrangement, DEFAULT_ARRANGEMENT, type FolderView, parseArrangement, type SortOrder } from './arrange';

const KEY = 'airlock.filesView';

function saved(): Arrangement {
  try {
    return parseArrangement(localStorage.getItem(KEY));
  } catch {
    return { ...DEFAULT_ARRANGEMENT };
  }
}

export const arrangement = $state<Arrangement>(saved());

function save(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(arrangement));
  } catch {
    // Not remembered; it still applies now.
  }
}

export function setView(view: FolderView): void {
  arrangement.view = view;
  save();
}

export function setOrder(order: SortOrder): void {
  arrangement.order = order;
  save();
}
