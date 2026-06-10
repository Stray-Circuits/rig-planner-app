/**
 * Open an external URL in the user's default browser.
 *
 * Under Tauri, `target="_blank"` either no-ops or opens an in-app webview
 * depending on the platform. We route through `@tauri-apps/plugin-shell`'s
 * `open()` so links actually hand off to the OS. In `pnpm dev` (no Tauri)
 * we fall back to `window.open(url, '_blank')`.
 */
function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export async function openExternal(url: string): Promise<void> {
  if (isTauri()) {
    try {
      const { open } = await import('@tauri-apps/plugin-shell');
      await open(url);
      return;
    } catch (err) {
      // Debug aid: surface the failure inline so Android testers see
      // what plugin-shell::open() is rejecting with. Removed once we
      // know the cause.
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[openExternal] plugin-shell open() failed', err);
      alert(`Could not open link:\n${url}\n\n${msg}`);
      throw err;
    }
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}
