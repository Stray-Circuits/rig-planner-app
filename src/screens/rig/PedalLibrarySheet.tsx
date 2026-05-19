import { useEffect, useRef, useState } from 'react';
import type { Pedal } from '../../data/schema';
import { pedalImageStyle } from '../../lib/pedalImage';
import { getLocalStorageUsageFraction } from '../../data/memoryAdapter';
import { usePedalsStore } from '../../stores/pedalsStore';
import { Button, Sheet, SheetItem } from '../../ui';
import styles from './PedalLibrarySheet.module.css';

interface PedalLibrarySheetProps {
  open: boolean;
  pedals: Pedal[];
  onClose: () => void;
  onAddPedal: (pedal: Pedal) => void;
  /** Opens the New Pedal wizard. The library sheet closes itself first. */
  onStartNewPedal: () => void;
  onSeed: () => Promise<void>;
}

const HOLD_MS = 450;

export function PedalLibrarySheet({
  open,
  pedals,
  onClose,
  onAddPedal,
  onStartNewPedal,
  onSeed,
}: PedalLibrarySheetProps) {
  const [seeding, setSeeding] = useState(false);
  const [seedError, setSeedError] = useState<string | null>(null);
  const [actionsFor, setActionsFor] = useState<Pedal | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{
    pedal: Pedal;
    rigCount: number;
  } | null>(null);
  const [removing, setRemoving] = useState(false);

  const usage = usePedalsStore((s) => s.usage);
  const deletePedal = usePedalsStore((s) => s.deletePedal);

  // Re-poll the localStorage usage every time the sheet opens or the pedal
  // list changes (which is when usage moves). Browser dev only; Tauri's
  // SQLite has no comparable limit and this returns 0 there.
  const [quotaFraction, setQuotaFraction] = useState<number | null>(null);
  useEffect(() => {
    if (!open) return;
    setQuotaFraction(getLocalStorageUsageFraction());
  }, [open, pedals.length]);

  const handleSeed = () => {
    void (async () => {
      setSeeding(true);
      setSeedError(null);
      try {
        await onSeed();
      } catch (err) {
        setSeedError(err instanceof Error ? err.message : String(err));
      } finally {
        setSeeding(false);
      }
    })();
  };

  const openActions = (pedal: Pedal) => setActionsFor(pedal);
  const closeActions = () => setActionsFor(null);

  const handleStartRemove = () => {
    if (!actionsFor) return;
    const pedal = actionsFor;
    closeActions();
    void (async () => {
      const rigIds = await usage(pedal.id);
      setConfirmDelete({ pedal, rigCount: rigIds.length });
    })();
  };

  const handleConfirmRemove = () => {
    if (!confirmDelete) return;
    const pedal = confirmDelete.pedal;
    setRemoving(true);
    void (async () => {
      try {
        await deletePedal(pedal.id);
        setConfirmDelete(null);
      } finally {
        setRemoving(false);
      }
    })();
  };

  return (
    <>
      <Sheet open={open} onClose={onClose} title="Add a pedal">
        <div className={styles.body}>
          {quotaFraction !== null && quotaFraction >= 0.7 ? (
            <div className={styles.quotaWarn} role="status">
              <i className="ti ti-database-exclamation" aria-hidden /> Browser
              storage is {Math.round(quotaFraction * 100)}% full. New pedal
              photos may start failing — pick placeholder colors, or remove
              unused pedals. Tauri/desktop builds aren&apos;t limited.
            </div>
          ) : null}
          <ul className={styles.list}>
            <li>
              <button
                type="button"
                className={`${styles.entry} ${styles.newEntry}`}
                onClick={onStartNewPedal}
              >
                <span className={styles.newThumb} aria-hidden>
                  <i className="ti ti-plus" />
                </span>
                <div className={styles.info}>
                  <div className={styles.name}>Add new pedal</div>
                  <div className={styles.brand}>5-step wizard</div>
                </div>
              </button>
            </li>
            {pedals.map((p) => (
              <PedalRow
                key={p.id}
                pedal={p}
                onAdd={onAddPedal}
                onOpenActions={openActions}
              />
            ))}
          </ul>
          {pedals.length === 0 ? (
            <div className={styles.empty}>
              <p className={styles.muted}>
                Your library is empty — tap <strong>Add new pedal</strong>
                above to create one.
              </p>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleSeed}
                disabled={seeding}
              >
                {seeding ? 'Seeding…' : 'Or seed 6 sample pedals'}
              </Button>
              {seedError ? <p className={styles.error}>{seedError}</p> : null}
            </div>
          ) : null}
        </div>
      </Sheet>

      <Sheet
        open={actionsFor !== null}
        onClose={closeActions}
        title={actionsFor ? `${actionsFor.brand} ${actionsFor.name}` : ''}
      >
        <SheetItem
          icon={<i className="ti ti-trash" aria-hidden />}
          label="Remove from collection"
          destructive
          onClick={handleStartRemove}
        />
      </Sheet>

      <Sheet
        open={confirmDelete !== null}
        onClose={() => setConfirmDelete(null)}
        title="Remove pedal?"
      >
        <div className={styles.confirmBody}>
          <p className={styles.confirmText}>
            Permanently remove{' '}
            <strong>
              {confirmDelete
                ? `${confirmDelete.pedal.brand} ${confirmDelete.pedal.name}`
                : ''}
            </strong>{' '}
            from your collection?
          </p>
          {confirmDelete && confirmDelete.rigCount > 0 ? (
            <p className={styles.confirmWarn}>
              <i className="ti ti-alert-triangle" aria-hidden /> It&apos;s
              currently placed on {confirmDelete.rigCount} rig
              {confirmDelete.rigCount === 1 ? '' : 's'}. Those placements and
              their signal-chain connections will be removed too.
            </p>
          ) : null}
          <div className={styles.confirmActions}>
            <Button variant="ghost" onClick={() => setConfirmDelete(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={handleConfirmRemove}
              disabled={removing}
            >
              {removing ? 'Removing…' : 'Remove'}
            </Button>
          </div>
        </div>
      </Sheet>
    </>
  );
}

interface PedalRowProps {
  pedal: Pedal;
  onAdd: (pedal: Pedal) => void;
  onOpenActions: (pedal: Pedal) => void;
}

function PedalRow({ pedal, onAdd, onOpenActions }: PedalRowProps) {
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const heldRef = useRef(false);

  const startHold = () => {
    heldRef.current = false;
    holdTimer.current = setTimeout(() => {
      heldRef.current = true;
      onOpenActions(pedal);
      holdTimer.current = null;
    }, HOLD_MS);
  };

  const clearHold = () => {
    if (holdTimer.current) {
      clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }
  };

  return (
    <li className={styles.row}>
      <button
        type="button"
        className={styles.entry}
        onClick={() => {
          // Suppress the click when the long-press already fired.
          if (heldRef.current) {
            heldRef.current = false;
            return;
          }
          onAdd(pedal);
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          onOpenActions(pedal);
        }}
        onMouseDown={startHold}
        onMouseUp={clearHold}
        onMouseLeave={clearHold}
        onTouchStart={startHold}
        onTouchEnd={clearHold}
        onTouchCancel={clearHold}
      >
        <span
          className={styles.thumb}
          style={pedalImageStyle(pedal.imagePath)}
          aria-hidden
        />
        <div className={styles.info}>
          <div className={styles.name}>{pedal.name}</div>
          <div className={styles.brand}>{pedal.brand}</div>
        </div>
        <i className={`ti ti-plus ${styles.plusIcon}`} aria-hidden />
      </button>
      <button
        type="button"
        className={styles.moreBtn}
        aria-label={`${pedal.name} actions`}
        onClick={(e) => {
          e.stopPropagation();
          onOpenActions(pedal);
        }}
      >
        <i className="ti ti-dots" aria-hidden />
      </button>
    </li>
  );
}
