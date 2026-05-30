import type {
  ExternalEndpoint,
  Pedal,
  PlacedPedal,
  Port,
} from '../../data/schema';
import {
  connectionCompatibility,
  maxCablesForConnector,
  type SignalFamily,
  signalFamily,
} from '../../lib/signalChainWarnings';
import { colorForPort } from '../../lib/signalColors';
import { Sheet } from '../../ui';
import styles from './PortPickerSheet.module.css';

/**
 * Source side of a chain-mode connection in progress. Either a previously
 * armed pedal port, or an armed external endpoint chip. When set, the
 * picker is in "complete the connection" mode: rows filter to ports whose
 * direction + signal family can validly receive from this source.
 */
export type ArmedSource =
  | { kind: 'port'; placedId: string; pedal: Pedal; port: Port }
  | {
      kind: 'endpoint';
      endpoint: ExternalEndpoint;
      /** True for guitar / amp FX send (signal originates here). */
      isSource: boolean;
    };

interface PortPickerSheetProps {
  open: boolean;
  /** Pedal whose ports the user is picking from. */
  placed: PlacedPedal | null;
  pedal: Pedal | null;
  armedSource: ArmedSource | null;
  /**
   * Number of existing cables touching each "${placedId}:${portId}".
   * Drives the per-row "connected" hint and the disconnect-count display
   * (a TRS port can host two cables via a splitter).
   */
  cableCountByPort: Map<string, number>;
  onClose: () => void;
  onPickPort: (placedId: string, portId: string) => void;
  /**
   * Called when the user taps an already-connected port while NOT in the
   * middle of completing a connection. The parent removes the cable
   * touching that port. Replaces the old "tap the cable line" delete UX.
   */
  onDisconnectPort: (placedId: string, portId: string) => void;
}

/**
 * Sheet that opens when a user taps a pedal in chain mode. Lists the
 * pedal's ports as big tappable rows. New connection grammar:
 *   tap pedal → pick port → tap pedal → pick port → cable created.
 * Each row is a pedal-width tap target rather than a 12px dot.
 */
export function PortPickerSheet({
  open,
  placed,
  pedal,
  armedSource,
  cableCountByPort,
  onClose,
  onPickPort,
  onDisconnectPort,
}: PortPickerSheetProps) {
  if (!pedal || !placed) return null;

  const isSelfPedal =
    armedSource?.kind === 'port' && armedSource.placedId === placed.id;
  const isCompletingConnection = armedSource !== null && !isSelfPedal;

  // For port sources, "is the source an output?" comes from the port
  // role. For endpoint sources, signal-originating endpoints (guitar /
  // FX send) act as outputs; sink endpoints (amp in / FX return) act
  // as inputs. The picker then filters this pedal's ports to the
  // opposite direction.
  const armedIsOutput: boolean | null =
    armedSource?.kind === 'port'
      ? isOutputRole(armedSource.port.role)
      : armedSource?.kind === 'endpoint'
        ? armedSource.isSource
        : null;
  // Signal type of the source side, used for the per-row compat check.
  // External endpoints route audio, so 'instrument' stands in.
  const armedSignalType =
    armedSource?.kind === 'port'
      ? armedSource.port.signalType
      : armedSource?.kind === 'endpoint'
        ? 'instrument'
        : null;
  const armedSourceLabel =
    armedSource?.kind === 'port'
      ? `${armedSource.pedal.name} · ${armedSource.port.label}`
      : armedSource?.kind === 'endpoint'
        ? `${armedSource.isSource ? 'From' : 'To'} ${armedSource.endpoint.label}`
        : '';

  const subtitle = isCompletingConnection
    ? `Connect to ${pedal.name} from ${armedSourceLabel}`
    : isSelfPedal
      ? 'You started here — pick this port again to cancel'
      : 'Pick a port to start a connection';

  return (
    <Sheet open={open} onClose={onClose} title={`${pedal.brand} ${pedal.name}`}>
      <p className={styles.subtitle}>{subtitle}</p>
      <ul className={styles.list}>
        {pedal.ports.length === 0 ? (
          <li className={styles.empty}>This pedal has no ports.</li>
        ) : (
          pedal.ports.map((port) => {
            const portKey = `${placed.id}:${port.id}`;
            const cableCount = cableCountByPort.get(portKey) ?? 0;
            const portMax = maxCablesForConnector(port.connector);
            const portFamily = signalFamily(port.signalType);
            // Tap = disconnect only when the port has no slots left. A
            // partially-filled TRS jack (1 of 2) stays in "arm to add
            // another cable" mode so users can wire a stereo splitter
            // without re-tapping the pedal between cables. portMax is
            // always >= 1, so cableCount >= portMax already implies > 0.
            const isDisconnectAction =
              !isCompletingConnection && cableCount >= portMax;
            let disabledReason: string | null = null;
            if (isCompletingConnection && armedSource && armedSignalType) {
              const compat = connectionCompatibility(
                armedSignalType,
                port.signalType,
              );
              if (!compat.ok) {
                disabledReason = `incompatible with ${armedSourceLabel}`;
              } else if (armedIsOutput !== null) {
                const portIsOutput = isOutputRole(port.role);
                if (portIsOutput === armedIsOutput) {
                  disabledReason = armedIsOutput
                    ? 'output → output: pick an input'
                    : 'input → input: pick an output';
                }
              }
            }
            const dotColor = colorForPort(port);
            return (
              <li key={port.id} className={styles.row}>
                <button
                  type="button"
                  className={styles.rowButton}
                  disabled={disabledReason !== null}
                  onClick={() =>
                    isDisconnectAction
                      ? onDisconnectPort(placed.id, port.id)
                      : onPickPort(placed.id, port.id)
                  }
                >
                  <span
                    className={styles.dot}
                    style={{ background: dotColor }}
                    aria-hidden
                  />
                  <span className={styles.rowText}>
                    <span className={styles.rowLabel}>{port.label}</span>
                    <span className={styles.rowSub}>
                      {disabledReason ??
                        subtitleFor(
                          port,
                          portFamily,
                          cableCount,
                          portMax,
                          isDisconnectAction,
                        )}
                    </span>
                  </span>
                </button>
              </li>
            );
          })
        )}
      </ul>
    </Sheet>
  );
}

function isOutputRole(role: Port['role']): boolean {
  return (
    role === 'output' ||
    role === 'output_l' ||
    role === 'output_r' ||
    role === 'stereo_output' ||
    role === 'fx_send' ||
    role === 'midi_out'
  );
}

function subtitleFor(
  port: Port,
  family: SignalFamily,
  cableCount: number,
  portMax: number,
  isDisconnectAction: boolean,
): string {
  const base = `${family} · ${port.connector.toUpperCase()}`;
  if (isDisconnectAction) {
    return cableCount > 1
      ? `${base} · ${cableCount} cables · tap to disconnect`
      : `${base} · tap to disconnect`;
  }
  if (cableCount > 0) {
    // Partially-filled multi-slot jack (TRS at 1 of 2). Make the
    // remaining capacity legible so the user can see they're about
    // to add another cable, not start a fresh connection.
    return `${base} · ${cableCount} of ${portMax} used · tap to add another`;
  }
  if (!port.optional) return `${base} · required`;
  return base;
}
