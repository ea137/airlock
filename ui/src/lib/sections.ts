// The main sections as the headers show them: name, first screen and icon.

import { type Route, SECTIONS, type Section, sectionRoute } from './routes';

export type SectionLink = { id: Section; label: string; route: Route; icon: string };

const LABEL: Record<Section, string> = {
  home: 'Home',
  terminals: 'Terminals',
  // Its route is still `center`.
  center: 'Work',
  system: 'System',
  files: 'Files',
};

/** Stroke paths on a 24px grid. */
const ICON: Record<Section, string> = {
  home: 'M4 11l8-7 8 7M6 9.5V20h12V9.5M10 20v-5h4v5',
  terminals: 'M4 17l6-5-6-5M12 19h8',
  center: 'M5 8h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1zM9 8V6a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M4 13h16',
  system: 'M3 12h4l3-8 4 16 3-8h4',
  files: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
};

export const SECTION_LINKS: SectionLink[] = SECTIONS.map((id) => ({
  id,
  label: LABEL[id],
  route: sectionRoute(id),
  icon: ICON[id],
}));

export function sectionLabel(section: Section): string {
  return LABEL[section];
}
