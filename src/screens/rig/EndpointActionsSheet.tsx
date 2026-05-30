import type {
  ExternalEndpoint,
  Pedal,
  PlacedPedal,
  Port,
} from '../../data/schema';
import { colorForPort } from '../../lib/signalColors';
import { Sheet } from '../../ui';
import styles from './PortPickerSheet.module.css';

export interface EndpointCable {
  connectionId: string;
  pedal: Pedal;
  placed: PlacedPedal;
  port: Port;
}

interface EndpointActionsSheetProps {
  open: boolean;
  endpoint: ExternalEndpoint | null;
  /** True for guitar / amp_fx_send (signal originates at this endpoint). */
  isSource: boolean;
  /** Existing cables that terminate at this endpoint. */
  cables: EndpointCable[];
  onClose: () => void;
  /** Arm this endpoint as the source for a new connection. */
  onArm: (endpointId: string) => void;
  /** Remove the specified cable. */
  onDisconnect: (connectionId: string) => void;
}

/**
 * Sheet that opens when the user taps a connected external endpoint
 * chip in chain mode. Mirrors PortPickerSheet's two-mode behavior:
 * each existing cable becomes a tap-to-disconnect row, plus a top
 * action to arm this endpoint as the source for another connection.
 */
export function EndpointActionsSheet({
  open,
  endpoint,
  isSource,
  cables,
  onClose,
  onArm,
  onDisconnect,
}: EndpointActionsSheetProps) {
  if (!endpoint) return null;
  const headerLabel = isSource
    ? `From ${endpoint.label}`
    : `To ${endpoint.label}`;
  const subtitle =
    cables.length === 0
      ? 'Pick an action to start a connection from this endpoint.'
      : `Tap a cable below to disconnect it, or start another connection from this endpoint.`;
  return (
    <Sheet open={open} onClose={onClose} title={headerLabel}>
      <p className={styles.subtitle}>{subtitle}</p>
      <ul className={styles.list}>
        <li className={styles.row}>
          <button
            type="button"
            className={styles.rowButton}
            onClick={() => onArm(endpoint.id)}
          >
            <span className={styles.rowText}>
              <span className={styles.rowLabel}>
                Start a new connection from here
              </span>
              <span className={styles.rowSub}>
                Then tap a pedal and pick a port to complete the cable
              </span>
            </span>
          </button>
        </li>
        {cables.map((cable) => {
          const dotColor = colorForPort(cable.port);
          return (
            <li key={cable.connectionId} className={styles.row}>
              <button
                type="button"
                className={styles.rowButton}
                onClick={() => onDisconnect(cable.connectionId)}
              >
                <span
                  className={styles.dot}
                  style={{ background: dotColor }}
                  aria-hidden
                />
                <span className={styles.rowText}>
                  <span className={styles.rowLabel}>
                    {cable.pedal.name} · {cable.port.label}
                  </span>
                  <span className={styles.rowSub}>Tap to disconnect</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </Sheet>
  );
}
