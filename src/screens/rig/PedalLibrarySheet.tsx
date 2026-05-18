import { useState } from 'react';
import type { Pedal } from '../../data/schema';
import { colorFromImagePath } from '../../data/seedPedals';
import { Button, Sheet } from '../../ui';
import styles from './PedalLibrarySheet.module.css';

interface PedalLibrarySheetProps {
  open: boolean;
  pedals: Pedal[];
  onClose: () => void;
  onAddPedal: (pedal: Pedal) => void;
  onSeed: () => Promise<void>;
}

export function PedalLibrarySheet({
  open,
  pedals,
  onClose,
  onAddPedal,
  onSeed,
}: PedalLibrarySheetProps) {
  const [seeding, setSeeding] = useState(false);
  const [seedError, setSeedError] = useState<string | null>(null);

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

  return (
    <Sheet open={open} onClose={onClose} title="Add a pedal">
      <div className={styles.body}>
        {pedals.length === 0 ? (
          <div className={styles.empty}>
            <p>Your library is empty.</p>
            <Button onClick={handleSeed} disabled={seeding}>
              {seeding ? 'Seeding…' : 'Seed sample pedals'}
            </Button>
            {seedError ? (
              <p className={styles.error}>{seedError}</p>
            ) : (
              <p className={styles.muted}>
                Adds 6 common pedals. The real Add Pedal wizard lands in phase
                4.
              </p>
            )}
          </div>
        ) : (
          <ul className={styles.list}>
            {pedals.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  className={styles.entry}
                  onClick={() => onAddPedal(p)}
                >
                  <span
                    className={styles.thumb}
                    style={{
                      background: colorFromImagePath(p.imagePath) ?? '#444',
                    }}
                    aria-hidden
                  />
                  <div className={styles.info}>
                    <div className={styles.name}>{p.name}</div>
                    <div className={styles.brand}>{p.brand}</div>
                  </div>
                  <i className={`ti ti-plus ${styles.plusIcon}`} aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Sheet>
  );
}
