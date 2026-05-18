import {
  useEffect,
  useRef,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from 'react';
import styles from './Sheet.module.css';

interface SheetProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  /** Hint for visual placement on desktop ("center" | "anchored") */
  desktopPlacement?: 'center' | 'anchored';
}

export function Sheet({
  open,
  onClose,
  title,
  children,
  desktopPlacement = 'center',
}: SheetProps) {
  const lastActive = useRef<Element | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    lastActive.current = document.activeElement;
    panelRef.current?.focus();
    return () => {
      if (lastActive.current instanceof HTMLElement) {
        lastActive.current.focus();
      }
    };
  }, [open]);

  if (!open) return null;

  function handleKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Escape') onClose();
  }

  function stopProp(e: MouseEvent<HTMLDivElement>) {
    e.stopPropagation();
  }

  return (
    <div
      className={[
        styles.backdrop,
        desktopPlacement === 'center' ? styles.center : styles.anchored,
      ].join(' ')}
      role="presentation"
      onClick={onClose}
      onKeyDown={handleKeyDown}
    >
      <div
        ref={panelRef}
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-label={title ?? 'Action sheet'}
        tabIndex={-1}
        onClick={stopProp}
      >
        {title ? <div className={styles.title}>{title}</div> : null}
        <div className={styles.body}>{children}</div>
      </div>
    </div>
  );
}

interface SheetItemProps {
  icon?: ReactNode;
  label: string;
  destructive?: boolean;
  onClick: () => void;
}

export function SheetItem({
  icon,
  label,
  destructive,
  onClick,
}: SheetItemProps) {
  return (
    <button
      type="button"
      className={[styles.item, destructive ? styles.destructive : '']
        .filter(Boolean)
        .join(' ')}
      onClick={onClick}
    >
      {icon ? <span className={styles.itemIcon}>{icon}</span> : null}
      <span className={styles.itemLabel}>{label}</span>
    </button>
  );
}
