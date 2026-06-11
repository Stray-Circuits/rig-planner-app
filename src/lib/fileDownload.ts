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
