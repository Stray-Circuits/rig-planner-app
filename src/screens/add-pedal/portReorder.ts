import { arrayMove } from '@dnd-kit/sortable';
import type { Port } from '../../data/schema';

type DraftPortFields = Omit<Port, 'id' | 'pedalId'>;

/**
 * Draft-only port shape. `_draftId` is a stable identifier used by the
 * sortable port list (dnd-kit) so reorders keep tracking the same logical
 * row across array shuffles; it's stripped before the draft is written to
 * the DB. `id` is the persistent port id — present when editing an existing
 * port, absent for ports added in the wizard. It rides through to
 * updatePedal so reconciliation can match ports by identity (#124).
 */
export type DraftPort = DraftPortFields & { _draftId: string; id?: string };

let __draftPortIdSeq = 0;
export function newDraftPortId(): string {
  __draftPortIdSeq += 1;
  return `dp-${__draftPortIdSeq}`;
}

/**
 * Move the port with `fromId` to the array slot of `toId`, then re-fill
 * the affected side's `sideOrder` values from the original same-side
 * distribution so the canvas slot layout matches the new visual order.
 * Cross-side moves are rejected (return the original array unchanged) —
 * changing a port's edge is the inline editor's job, not a drag gesture.
 */
export function applySameSideMove(
  ports: DraftPort[],
  fromId: string,
  toId: string,
): DraftPort[] {
  const oldIndex = ports.findIndex((p) => p._draftId === fromId);
  const newIndex = ports.findIndex((p) => p._draftId === toId);
  if (oldIndex < 0 || newIndex < 0) return ports;
  const activePort = ports[oldIndex];
  const overPort = ports[newIndex];
  if (!activePort || !overPort) return ports;
  if (activePort.side !== overPort.side) return ports;
  const moved = arrayMove(ports, oldIndex, newIndex);
  const sortedOrders = ports
    .filter((p) => p.side === activePort.side)
    .map((p) => p.sideOrder)
    .sort((a, b) => a - b);
  let i = 0;
  return moved.map((p) => {
    if (p.side !== activePort.side) return p;
    const order = sortedOrders[i++] ?? p.sideOrder;
    return { ...p, sideOrder: order };
  });
}
