// The laptop's own terminal tabs (GNOME Terminal's), kept fresh while a
// screen shows them.

import { api, type LaptopTabs } from '../../lib/api';
import { Polled } from '../../lib/polled.svelte';

const REFRESH_MS = 3000;

export const laptopTabList = new Polled<LaptopTabs>(() => api.laptopTabs(), REFRESH_MS);
