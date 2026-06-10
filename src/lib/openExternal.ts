/**
 * Open an external URL in the user's default browser.
 *
 * Routes through `@tauri-apps/plugin-opener` under Tauri so links hand
 * off to the OS browser on every target; falls back to `window.open`
 * in browser dev. Note: `tauri-plugin-shell`'s `open` was deprecated
 * in 2.1.0 and its Rust command is not platform-gated, so on Android
 * it tried to spawn `xdg-open` and failed with "Scoped shell IO error:
 * No such file or directory". `tauri-plugin-opener` is the documented
 * replacement and dispatches `Intent.ACTION_VIEW` natively on Android.
 */
function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export async function openExternal(url: string): Promise<void> {
  if (isTauri()) {
    const { openUrl } = await import('@tauri-apps/plugin-opener');
    await openUrl(url);
    return;
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}
