import styles from './Spinner.module.css';

interface SpinnerOverlayProps {
  label?: string;
}

/**
 * Absolutely-positioned spinner that fills its containing element.
 * Used while pedal data + images warm so the user sees something is
 * happening instead of a half-painted board.
 */
export function SpinnerOverlay({ label = 'Loading…' }: SpinnerOverlayProps) {
  return (
    <div className={styles.overlay} role="status" aria-live="polite">
      <span className={styles.spinner} aria-hidden />
      <span className={styles.label}>{label}</span>
    </div>
  );
}
