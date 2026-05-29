import type { Pedal, PlacedPedal, Port } from '../../data/schema';
import {
  connectionCompatibility,
  type SignalFamily,
  signalFamily,
} from '../../lib/signalChainWarnings';
import { colorForPort } from '../../lib/signalColors';
import { Sheet } from '../../ui';
import styles from './PortPickerSheet.module.css';

interface PortPickerSheetProps {
  open: boolean;
  /** Pedal whose ports the user is picking from. */
  placed: PlacedPedal | null;
  pedal: Pedal | null;
  /**
   * The port previously armed elsewhere (on a different pedal). When
   * set, the picker is in "to" mode: rows are filtered to ports whose
   * direction and signal family can validly complete the connection.
   */
  armedFromPort: {
    placedId: string;
    pedal: Pedal;
    port: Port;
  } | null;
  /**
   * "${placedId}:${portId}" keys of ports already touched by an
   * existing cable on this rig. Surfaces a "connected" hint per row.
   */
  connectedPortIds: Set<string>;
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
  armedFromPort,
  connectedPortIds,
  onClose,
  onPickPort,
  onDisconnectPort,
}: PortPickerSheetProps) {
  if (!pedal || !placed) return null;

  const isCompletingConnection =
    armedFromPort !== null && armedFromPort.placedId !== placed.id;
  const isSelfPedal = armedFromPort?.placedId === placed.id;

  const armedIsOutput = armedFromPort
    ? isOutputRole(armedFromPort.port.role)
    : null;

  const subtitle =
    isCompletingConnection && armedFromPort
      ? `Connect to ${pedal.name} from ${armedFromPort.pedal.name} · ${armedFromPort.port.label}`
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
            const isConnected = connectedPortIds.has(portKey);
            const portFamily = signalFamily(port.signalType);
            // A connected port outside the in-flight "to" step becomes a
            // disconnect button — the only way to delete a cable now that
            // tapping the cable line is gone.
            const isDisconnectAction = isConnected && !isCompletingConnection;
            let disabledReason: string | null = null;
            if (isCompletingConnection && armedFromPort) {
              const compat = connectionCompatibility(
                armedFromPort.port.signalType,
                port.signalType,
              );
              if (!compat.ok) {
                disabledReason = `incompatible with ${armedFromPort.port.label}`;
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
                          isConnected,
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
  isConnected: boolean,
  isDisconnectAction: boolean,
): string {
  const base = `${family} · ${port.connector.toUpperCase()}`;
  if (isDisconnectAction) return `${base} · tap to disconnect`;
  if (isConnected) return `${base} · connected`;
  if (!port.optional) return `${base} · required`;
  return base;
}
