import type { Rig } from '../../data/schema';
import { Button } from '../../ui';
import { BoardThumb } from '../../canvas/BoardThumb';
import styles from './RigScreenPlaceholder.module.css';

interface RigScreenPlaceholderProps {
  rig: Rig;
  onBack: () => void;
}

export function RigScreenPlaceholder({
  rig,
  onBack,
}: RigScreenPlaceholderProps) {
  return (
    <div className={styles.screen}>
      <header className={styles.bar}>
        <button
          type="button"
          className={styles.iconBtn}
          aria-label="Back to rigs"
          onClick={onBack}
        >
          <i className="ti ti-chevron-left" aria-hidden />
        </button>
        <div className={styles.title}>{rig.name}</div>
        <div className={styles.dims}>
          {rig.widthIn}&quot; × {rig.depthIn}&quot;
        </div>
      </header>
      <main className={styles.main}>
        <div className={styles.preview}>
          <BoardThumb
            style={rig.style}
            width={420}
            height={Math.max(60, Math.round((rig.depthIn / rig.widthIn) * 420))}
            title={`${rig.name} board`}
          />
        </div>
        <div className={styles.hint}>
          <h2>Canvas lands in phase 3</h2>
          <p>
            Pedal placement, drag, rotation, and the chain overlay come next.
          </p>
          <Button variant="secondary" onClick={onBack}>
            Back to rigs
          </Button>
        </div>
      </main>
    </div>
  );
}
