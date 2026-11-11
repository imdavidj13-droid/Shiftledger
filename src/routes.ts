import { useSyncExternalStore } from 'react';

export const PAGE_SLUGS = {
  Overview: 'overview', Schedule: 'schedule', Team: 'team', Timesheets: 'timesheets',
  Leave: 'leave', 'Shift swaps': 'shift-swaps', Reports: 'reports', Settings: 'settings', Locations: 'locations', Access: 'access', Setup: 'setup'
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
  if (!page || (resourceId && !['Locations', 'Schedule', 'Leave', 'Timesheets', 'Shift swaps', 'Team'].includes(page))) return null;
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

/**
 * Route same-origin application links through React without reloading the document.
 * Preserve regular browser behaviour for external URLs, downloads, target windows,
 * modified clicks and unsupported pages.
 */
export function installClientNavigation() {
  function handleClick(event: MouseEvent) {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    const anchor = target.closest('a[href]');
    if (!(anchor instanceof HTMLAnchorElement)) return;
    if (anchor.hasAttribute('download') || (anchor.target && anchor.target !== '_self')) return;
    const href = anchor.getAttribute('href');
    if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) return;
    const destination = new URL(anchor.href, window.location.href);
    if (destination.origin !== window.location.origin) return;
    if (!parseWorkspace(destination.pathname) &&
      !['/', '/profile', '/onboarding', '/sign-in', '/register', '/forgot-password', '/check-email'].includes(destination.pathname)) return;
    if (destination.href === window.location.href) {
      event.preventDefault();
      return;
    }
    event.preventDefault();
    go(destination.pathname + destination.search + destination.hash);
  }
  document.addEventListener('click', handleClick);
  return () => document.removeEventListener('click', handleClick);
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
