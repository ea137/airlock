// The laptop's terminals, kept fresh while a screen shows them.

import { api, type Terminal } from '../../lib/api';
import { Polled } from '../../lib/polled.svelte';

export const REFRESH_MS = 1500;

export const terminalList = new Polled<Terminal[]>(() => api.terminals(), REFRESH_MS);

/** Asked for from outside the list (the Game Boy's Start): the list opens its new-terminal sheet. */
export const newTerminal = $state({ asked: false });
