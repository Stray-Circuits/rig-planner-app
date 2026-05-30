import { useEffect, useRef } from 'react';
import { pushBackHandler } from './backHandler';

/**
 * React hook that registers a back-button handler while `active` is true.
 * Returning anything other than `false` from `handler` is treated as
 * consuming the back; return `false` to delegate to the next handler down
 * the stack.
 *
 * Use this anywhere a user expects hardware/browser back to "close this
 * thing" rather than exit the app — sheets, wizards, modal screens.
 */
export function useBackHandler(
  active: boolean,
  handler: () => boolean | void,
): void {
  // Keep the latest handler in a ref so the registered callback closes over
  // a stable identity but always calls the freshest props/state.
  const ref = useRef(handler);
  ref.current = handler;

  useEffect(() => {
    if (!active) return;
    return pushBackHandler(() => {
      const result = ref.current();
      return result !== false;
    });
  }, [active]);
}
