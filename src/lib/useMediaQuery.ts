import { useCallback, useSyncExternalStore } from 'react';

/**
 * Subscribe to a CSS media query. Returns true when the query currently
 * matches. Safe to call outside the browser (returns the optional
 * `serverFallback`).
 */
export function useMediaQuery(query: string, serverFallback = false): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (typeof window === 'undefined' || !window.matchMedia) {
        return () => undefined;
      }
      const mql = window.matchMedia(query);
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    },
    [query],
  );

  const getSnapshot = useCallback(() => {
    if (typeof window === 'undefined' || !window.matchMedia) {
      return serverFallback;
    }
    return window.matchMedia(query).matches;
  }, [query, serverFallback]);

  const getServerSnapshot = useCallback(() => serverFallback, [serverFallback]);

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
