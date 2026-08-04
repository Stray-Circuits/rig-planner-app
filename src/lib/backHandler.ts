/**
 * Android-style back-button routing for the web shell. A stack of handlers is
 * consulted top-down (LIFO) on each back press; the first to consume it wins —
 * wizard, sheet, screen — instead of exiting the app.
 *
 * Two transports, picked at install time:
 *
 * - **Tauri (Android):** the native `onBackButtonPress` event. Once a listener
 *   is registered, Tauri routes the hardware back straight to us and skips its
 *   default `WebView.canGoBack()` / `goBack()` / close logic. We must therefore
 *   exit the app ourselves when nothing in the stack consumes the press. We do
 *   NOT use the history/`popstate` trick here: Android's `canGoBack()` reports
 *   `false` until the WebView has been physically touched (tauri#13957), so a
 *   back gesture on a freshly-loaded screen would close the app.
 *
 * - **Browser (desktop dev):** a sentinel `history.pushState` entry turns the
 *   browser back into a `popstate` we intercept; re-armed after each consumed
 *   pop. Also gives desktop users a working browser-back.
 */

type Handler = () => boolean;

const handlers: Handler[] = [];
let installed = false;

// The native back-button event only fires on Android; desktop and iOS Tauri
// (and the browser) keep the history/popstate path for trackpad/edge-swipe back.
function isTauriAndroid(): boolean {
  return (
    typeof window !== 'undefined' &&
    '__TAURI_INTERNALS__' in window &&
    typeof navigator !== 'undefined' &&
    /android/i.test(navigator.userAgent)
  );
}

// Run the stack top-down; return true if a handler consumed the back press.
function runHandlers(): boolean {
  for (let i = handlers.length - 1; i >= 0; i--) {
    if (handlers[i]?.()) return true;
  }
  return false;
}

function install() {
  if (installed) return;
  installed = true;
  if (isTauriAndroid()) {
    // Fire-and-forget: registration is async (IPC) but only needs to land
    // before the first back press, which is well after app mount.
    void installTauriBackButton();
  } else {
    window.history.pushState({ rpBack: true }, '');
    window.addEventListener('popstate', onPopState);
  }
}

async function installTauriBackButton() {
  const { onBackButtonPress } = await import('@tauri-apps/api/app');
  await onBackButtonPress(() => {
    if (runHandlers()) return;
    // Nothing to pop — we're at a top-level screen. Tauri won't exit for us
    // once we've claimed the event, so close the window (finishes the Android
    // activity), matching the OS default back-at-root behavior.
    void import('@tauri-apps/api/window').then(({ getCurrentWindow }) =>
      getCurrentWindow().close(),
    );
  });
}

function onPopState() {
  if (runHandlers()) {
    // Re-arm so the next back still hits us instead of unloading.
    window.history.pushState({ rpBack: true }, '');
    return;
  }
  // Nothing consumed the back — let the browser navigate (exits at the top).
}

/**
 * Register a back handler. The most recently registered handler wins
 * (LIFO). Return value from the handler:
 *   true  — back was consumed; the next back re-hits the stack.
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
