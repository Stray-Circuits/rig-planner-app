import { useEffect, useState } from 'react';
import styles from './Toast.module.css';

interface ToastProps {
  message: string;
  /** Total visible duration in ms, including the fade-in/out tails. */
  duration?: number;
  onDismiss: () => void;
}

/**
 * Android-Toast-style transient message. Mounts → fades in → holds →
 * fades out → calls onDismiss. Caller controls lifetime by keying the
 * component (a new key remounts and restarts the timer).
 */
export function Toast({ message, duration = 2500, onDismiss }: ToastProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const fadeIn = requestAnimationFrame(() => setVisible(true));
    const fadeOut = setTimeout(
      () => setVisible(false),
      Math.max(0, duration - 200),
    );
    const remove = setTimeout(onDismiss, duration);

    return () => {
      cancelAnimationFrame(fadeIn);
      clearTimeout(fadeOut);
      clearTimeout(remove);
    };
  }, [duration, onDismiss]);

  return (
    <div
      className={`${styles.toast} ${visible ? styles.visible : ''}`}
      role="status"
      aria-live="polite"
    >
      {message}
    </div>
  );
}
