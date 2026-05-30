/**
 * Android-style back-button routing for the web shell. Tauri Android forwards
 * the hardware back to the WebView; with no in-app history that fires nothing
 * and the OS closes the app. Pushing a sentinel `history.pushState` entry on
 * load turns that hardware-back into a `popstate` event we can intercept and
 * dispatch to whoever's on top — wizard, sheet, screen — instead of exiting.
 *
 * The same mechanism also gives desktop browser users a working browser-back.
 */

type Handler = () => boolean;

const handlers: Handler[] = [];
let installed = false;

function install() {
  if (installed) return;
  installed = true;
  // Seed an entry so the FIRST hardware back fires popstate rather than
  // unloading the page. Subsequent pushes re-arm after each consumed pop.
  window.history.pushState({ rpBack: true }, '');
  window.addEventListener('popstate', onPopState);
}

function onPopState() {
  // Try the most recently registered handler first — UI stacks like
  // wizard → sheet should consume back at the top of the stack.
  for (let i = handlers.length - 1; i >= 0; i--) {
    if (handlers[i]?.()) {
      // Re-arm so the next back still hits us instead of unloading.
      window.history.pushState({ rpBack: true }, '');
      return;
    }
  }
  // Nothing consumed the back — let the browser navigate. At the top of
  // the app this lets Tauri Android exit the app, which is the expected
  // behavior when no in-app view can be popped.
}

/**
 * Register a back handler. The most recently registered handler wins
 * (LIFO). Return value from the handler:
 *   true  — back was consumed; we'll re-arm history so the next back
 *           hits the stack again.
 *   false — back wasn't applicable right now; the next handler down
 *           the stack gets a chance.
 *
 * Returns an unregister function — call it when the registering component
 * unmounts (or when the condition that armed it goes away).
 */
export function pushBackHandler(handler: Handler): () => void {
  install();
  handlers.push(handler);
  return () => {
    const i = handlers.lastIndexOf(handler);
    if (i >= 0) handlers.splice(i, 1);
  };
}

/** Test-only — strip every handler and detach the popstate listener. */
export function __resetBackHandlersForTests() {
  handlers.length = 0;
  if (installed) {
    window.removeEventListener('popstate', onPopState);
    installed = false;
  }
}
