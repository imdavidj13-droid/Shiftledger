import { useSyncExternalStore } from 'react';

export const PAGE_SLUGS = {
  Overview: 'overview', Schedule: 'schedule', Team: 'team', Timesheets: 'timesheets',
  Leave: 'leave', 'Shift swaps': 'shift-swaps', Reports: 'reports', Settings: 'settings', Locations: 'locations', Access: 'access'
} as const;
export type Page = keyof typeof PAGE_SLUGS;

export function appPath(organisationId: string, page: Page) {
  return '/app/' + encodeURIComponent(organisationId) + '/' + PAGE_SLUGS[page];
}

export function parseWorkspace(pathname: string) {
  const match = pathname.match(/^\/app\/([a-zA-Z0-9_-]{1,64})(?:\/([a-z-]+)(?:\/([a-zA-Z0-9_-]{1,64}))?)?\/?$/);
  if (!match) return null;
  const [, organisationId, slug = 'overview', resourceId] = match;
  const page = (Object.keys(PAGE_SLUGS) as Page[]).find(page => PAGE_SLUGS[page] === slug);
  if (!page || (resourceId && page !== 'Locations' && page !== 'Schedule')) return null;
  return { organisationId, page, resourceId };
}

export function signInDestination(search: string) {
  const next = new URLSearchParams(search).get('next');
  if (next === '/profile') return next;
  if (!next || (!next.startsWith('/app/') && !next.startsWith('/join?'))) return null;
  const url = new URL(next, window.location.origin);
  if (url.origin !== window.location.origin) return null;
  const invite = url.pathname === '/join' && /^[a-f0-9]{64}$/.test(url.searchParams.get('token') || '');
  return invite || parseWorkspace(url.pathname) ? url.pathname + url.search : null;
}

export function go(path: string, replace = false, state: object = {}) {
  window.history[replace ? 'replaceState' : 'pushState'](state, '', path);
  window.dispatchEvent(new Event('shiftledger:navigation'));
}

function subscribe(listener: () => void) {
  window.addEventListener('popstate', listener);
  window.addEventListener('shiftledger:navigation', listener);
  return () => {
    window.removeEventListener('popstate', listener);
    window.removeEventListener('shiftledger:navigation', listener);
  };
}

export function useRoute() {
  return new URL(useSyncExternalStore(subscribe, () => window.location.href));
}
