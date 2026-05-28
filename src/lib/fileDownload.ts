/**
 * Save an in-memory string to a file the user picks.
 *
 * Under Tauri (desktop/mobile shell) we go through the official dialog + fs
 * plugins so the user gets a native save dialog and the file lands wherever
 * they choose. Under `pnpm dev` (browser) we fall back to a Blob URL + <a
 * download> click — that path works in any browser but is silently ignored
 * by WKWebView, which is why we need the Tauri branch.
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

function downloadTextFileViaBlob(
  filename: string,
  text: string,
  mimeType: string,
): void {
  const blob = new Blob([text], { type: mimeType });
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
