// The screen in view, kept in the URL hash so Back and reloads land on it.

import { parseRoute, type Route, hrefFor } from './routes';

export { hrefFor, parseRoute, type Route };

export const router = $state<{ route: Route }>({ route: parseRoute(location.hash) });

window.addEventListener('hashchange', () => {
  router.route = parseRoute(location.hash);
});

export function go(route: Route): void {
  location.hash = hrefFor(route);
}
