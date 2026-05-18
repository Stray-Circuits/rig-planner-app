/**
 * Stable ID generation. Uses crypto.randomUUID where available (browsers,
 * jsdom, Node ≥ 19); falls back to a Math.random-based v4-shaped string.
 */
export function newId(): string {
  if (
    typeof crypto !== 'undefined' &&
    typeof crypto.randomUUID === 'function'
  ) {
    return crypto.randomUUID();
  }
  // Non-crypto fallback — sufficient for client-only entity IDs.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
