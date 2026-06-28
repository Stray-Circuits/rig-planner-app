import { arrayMove } from '@dnd-kit/sortable';
import type { Port, PortRole } from '../../data/schema';

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

/** Canonical base labels for the FX-loop roles that get auto-numbered. */
const FX_LOOP_BASE_LABELS: Partial<Record<PortRole, string>> = {
  fx_send: 'FX Send',
  fx_return: 'FX Return',
};

/**
 * Number the FX-loop ports so multiple loops on one pedal are tellable
 * apart: "FX Send 1 / FX Return 1", "FX Send 2 / FX Return 2", … by
 * occurrence order, per role. A lone loop keeps its bare label ("FX Send").
 * Other roles are left untouched. Re-run after any add/remove so the
 * numbering stays contiguous (#124).
 */
export function renumberFxLoops(ports: DraftPort[]): DraftPort[] {
  const totals: Partial<Record<PortRole, number>> = {};
  for (const p of ports) {
    if (p.role in FX_LOOP_BASE_LABELS) {
      totals[p.role] = (totals[p.role] ?? 0) + 1;
    }
  }
  const seen: Partial<Record<PortRole, number>> = {};
  return ports.map((p) => {
    const base = FX_LOOP_BASE_LABELS[p.role];
    if (!base) return p;
    const n = (seen[p.role] = (seen[p.role] ?? 0) + 1);
    const label = (totals[p.role] ?? 0) > 1 ? `${base} ${n}` : base;
    return p.label === label ? p : { ...p, label };
  });
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
