import { useEffect, useState } from 'react';

/**
 * Subscribe to a CSS media query. Returns true when the query currently
 * matches. Safe to call outside the browser (returns the optional
 * `serverFallback`).
 */
export function useMediaQuery(query: string, serverFallback = false): boolean {
  const [matches, setMatches] = useState<boolean>(() => {
    if (typeof window === 'undefined' || !window.matchMedia) {
      return serverFallback;
    }
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mql = window.matchMedia(query);
    const handler = (e: MediaQueryListEvent) => setMatches(e.matches);
    setMatches(mql.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, [query]);

  return matches;
}
