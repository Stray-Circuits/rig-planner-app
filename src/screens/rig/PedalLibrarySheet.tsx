import { useState } from 'react';
import type { Pedal } from '../../data/schema';
import { pedalImageStyle } from '../../lib/pedalImage';
import { Button, Sheet } from '../../ui';
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
            <li key={p.id}>
              <button
                type="button"
                className={styles.entry}
                onClick={() => onAddPedal(p)}
              >
                <span
                  className={styles.thumb}
                  style={pedalImageStyle(p.imagePath)}
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
        {pedals.length === 0 ? (
          <div className={styles.empty}>
            <p className={styles.muted}>
              Your library is empty — tap <strong>Add new pedal</strong> above
              to create one.
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
  );
}
