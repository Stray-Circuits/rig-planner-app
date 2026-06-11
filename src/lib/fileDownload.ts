/**
 * Save an in-memory string to a file the user picks, or open a text file
 * the user picks.
 *
 * Under Tauri (desktop/mobile shell) we go through the official dialog + fs
 * plugins so the user gets a native picker and the OS hands back a URI with
 * proper read/write permission. Under `pnpm dev` (browser) save falls back
 * to a Blob URL + <a download> click; open falls back to <input type="file">
 * (handled by the caller — see `openTextFile`'s return contract).
 *
 * The Tauri branch is load-bearing on Android specifically: wry's
 * `RustWebChromeClient.kt::showFilePicker` uses `ACTION_GET_CONTENT`, which
 * returns content URIs without read permission for the Downloads provider.
 * Picking a file from the Files app's "Downloads" shortcut yields a `File`
 * with `size = 0` and empty reads (issue #81). Going through plugin-dialog
 * uses `ACTION_OPEN_DOCUMENT`, which grants the URI permission.
 */

function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

interface SaveTextFileOptions {
  /** Suggested filename shown in the save dialog. */
  suggestedFilename: string;
  /** File contents. */
  text: string;
  /** Dialog file-type filters. Honoured under Tauri only. */
  filters?: { name: string; extensions: string[] }[];
  /** Mime type used for the browser Blob fallback. */
  mimeType?: string;
}

/**
 * Result of a save attempt. `path` is null when the user cancelled the
 * native dialog. Under the browser fallback we can't know the chosen path,
 * so `path` is null on success too — but `cancelled` is false.
 */
export interface SaveTextFileResult {
  cancelled: boolean;
  path: string | null;
}

export async function saveTextFile(
  opts: SaveTextFileOptions,
): Promise<SaveTextFileResult> {
  if (isTauri()) {
    const { save } = await import('@tauri-apps/plugin-dialog');
    const { writeTextFile } = await import('@tauri-apps/plugin-fs');
    const path = await save({
      defaultPath: opts.suggestedFilename,
      ...(opts.filters ? { filters: opts.filters } : {}),
    });
    if (path === null) return { cancelled: true, path: null };
    await writeTextFile(path, opts.text);
    return { cancelled: false, path };
  }
  downloadTextFileViaBlob(
    opts.suggestedFilename,
    opts.text,
    opts.mimeType ?? 'application/json',
  );
  return { cancelled: false, path: null };
}

interface OpenTextFileOptions {
  /** Dialog file-type filters. Honoured under Tauri only. */
  filters?: { name: string; extensions: string[] }[];
}

export type OpenTextFileResult =
  | { kind: 'opened'; text: string; path: string }
  | { kind: 'cancelled' }
  /** Tauri is unavailable; the caller should fall back to <input type="file">. */
  | { kind: 'unavailable' };

/**
 * Prompt the user to pick a text file and return its contents.
 *
 * Under Tauri, returns `{kind: 'opened'}` on success, `{kind: 'cancelled'}`
 * if the user dismissed the dialog. Under browser dev, returns
 * `{kind: 'unavailable'}` — the caller should trigger a hidden
 * `<input type="file">` instead.
 */
export async function openTextFile(
  opts: OpenTextFileOptions = {},
): Promise<OpenTextFileResult> {
  if (!isTauri()) return { kind: 'unavailable' };
  const { open } = await import('@tauri-apps/plugin-dialog');
  const { readTextFile } = await import('@tauri-apps/plugin-fs');
  const path = await open({
    multiple: false,
    directory: false,
    ...(opts.filters ? { filters: opts.filters } : {}),
  });
  if (path === null) return { kind: 'cancelled' };
  const text = await readTextFile(path);
  return { kind: 'opened', text, path };
}

function downloadTextFileViaBlob(
  filename: string,
  text: string,
  mimeType: string,
): void {
  const blob = new Blob([text], { type: mimeType });
  downloadBlob(filename, blob);
}

interface SaveBinaryFileOptions {
  /** Suggested filename shown in the save dialog. */
  suggestedFilename: string;
  /** File contents. */
  blob: Blob;
  /** Dialog file-type filters. Honoured under Tauri only. */
  filters?: { name: string; extensions: string[] }[];
}

/**
 * Save a binary Blob to a file the user picks. Same routing as
 * `saveTextFile` (Tauri plugin-dialog + plugin-fs writeFile under the
 * shell; `<a download>` Blob URL fallback in the browser).
 *
 * Used by the rig Share PNG export — see src/lib/rigSnapshot.ts.
 */
export async function saveBinaryFile(
  opts: SaveBinaryFileOptions,
): Promise<SaveTextFileResult> {
  if (isTauri()) {
    const { save } = await import('@tauri-apps/plugin-dialog');
    const { writeFile } = await import('@tauri-apps/plugin-fs');
    const path = await save({
      defaultPath: opts.suggestedFilename,
      ...(opts.filters ? { filters: opts.filters } : {}),
    });
    if (path === null) return { cancelled: true, path: null };
    const bytes = new Uint8Array(await opts.blob.arrayBuffer());
    await writeFile(path, bytes);
    return { cancelled: false, path };
  }
  downloadBlob(opts.suggestedFilename, opts.blob);
  return { cancelled: false, path: null };
}

interface ShareOrSaveBinaryFileOptions extends SaveBinaryFileOptions {
  /** Mime type for the constructed File. Defaults to `opts.blob.type`. */
  mimeType?: string;
  /** Optional title surfaced to the OS share sheet (used by some targets). */
  shareTitle?: string;
  /** Optional accompanying text. */
  shareText?: string;
}

/**
 * Hand a binary file to the OS share sheet, with platform-appropriate
 * routing:
 *
 *  - Tauri (Android/iOS/macOS/Windows): write to app cache + invoke
 *    `tauri-plugin-sharekit`'s native share action (ACTION_SEND chooser
 *    on Android, UIActivityViewController on iOS, NSSharingServicePicker
 *    on macOS, Windows DataTransferManager).
 *  - Browser with file-capable `navigator.share`: use the Web Share API.
 *  - Anything else (Tauri Linux, browser without share support): fall
 *    through to {@link saveBinaryFile} so the user still gets the file.
 *
 * We can't rely on `navigator.share` inside the Tauri WebView — system
 * WebViews on Android often expose it but report `canShare({ files })`
 * as false, so the call short-circuits to the save path with no visible
 * picker. The plugin route uses the native intent directly and avoids
 * that ambiguity.
 */
export async function shareOrSaveBinaryFile(
  opts: ShareOrSaveBinaryFileOptions,
): Promise<SaveTextFileResult> {
  if (isTauri()) {
    const shared = await tryShareViaSharekit(opts);
    if (shared !== 'unsupported') return shared;
    return saveBinaryFile(opts);
  }
  if (typeof navigator !== 'undefined' && 'share' in navigator) {
    const file = new File([opts.blob], opts.suggestedFilename, {
      type: opts.mimeType ?? opts.blob.type,
    });
    const canShare = navigator.canShare?.bind(navigator);
    if (canShare?.({ files: [file] })) {
      try {
        await navigator.share({
          files: [file],
          ...(opts.shareTitle !== undefined ? { title: opts.shareTitle } : {}),
          ...(opts.shareText !== undefined ? { text: opts.shareText } : {}),
        });
        return { cancelled: false, path: null };
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
          return { cancelled: true, path: null };
        }
        // Any other failure (NotAllowedError when the WebView lied about
        // file support, etc.) falls through to the save path so the user
        // still gets their file.
      }
    }
  }
  return saveBinaryFile(opts);
}

/**
 * Save the blob to app cache and ask sharekit to share it. Returns
 * `'unsupported'` if the plugin or platform isn't available (Linux
 * desktop returns UnsupportedPlatform), so the caller can fall through
 * to {@link saveBinaryFile}.
 */
async function tryShareViaSharekit(
  opts: ShareOrSaveBinaryFileOptions,
): Promise<SaveTextFileResult | 'unsupported'> {
  try {
    const { writeFile, mkdir } = await import('@tauri-apps/plugin-fs');
    const { appCacheDir, join } = await import('@tauri-apps/api/path');
    const { shareFile } =
      await import('@choochmeque/tauri-plugin-sharekit-api');
    const cacheDir = await appCacheDir();
    // appCacheDir may not exist on a fresh install; create it so writeFile
    // doesn't fail with a missing-parent error.
    await mkdir(cacheDir, { recursive: true }).catch(() => undefined);
    const path = await join(cacheDir, opts.suggestedFilename);
    const bytes = new Uint8Array(await opts.blob.arrayBuffer());
    await writeFile(path, bytes);
    await shareFile(`file://${path}`, {
      mimeType: opts.mimeType ?? opts.blob.type ?? 'application/octet-stream',
      ...(opts.shareTitle !== undefined ? { title: opts.shareTitle } : {}),
    });
    return { cancelled: false, path };
  } catch (err) {
    // Both "user cancelled the chooser" and "Linux desktop has no share
    // sheet" surface as errors here. Treat the cancel string as a real
    // cancel; otherwise fall back so the user still gets the file via the
    // save dialog.
    if (err instanceof Error && /cancel/i.test(err.message)) {
      return { cancelled: true, path: null };
    }
    return 'unsupported';
  }
}

function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  } finally {
    // Defer revoke so the click has a chance to start the download.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}
