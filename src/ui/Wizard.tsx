import type { ReactNode } from 'react';
import styles from './Wizard.module.css';

interface WizardShellProps {
  /** 0-indexed current step */
  step: number;
  /** Total number of steps */
  totalSteps: number;
  title: string;
  subtitle?: string;
  /** Body content for the current step */
  children: ReactNode;
  /** Action button rendered in the footer (usually the Continue/Submit) */
  footerAction: ReactNode;
  /** Optional secondary footer node (e.g. cancel link) */
  footerSecondary?: ReactNode;
  /** Back handler — when omitted, the back arrow is hidden */
  onBack?: () => void;
  /** Close (X) handler — when omitted, the close button is hidden */
  onClose?: () => void;
}

export function WizardShell({
  step,
  totalSteps,
  title,
  subtitle,
  children,
  footerAction,
  footerSecondary,
  onBack,
  onClose,
}: WizardShellProps) {
  return (
    <div
      className={styles.overlay}
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        // Desktop modal: clicking the backdrop closes (if onClose available).
        if (onClose && e.target === e.currentTarget) onClose();
      }}
    >
      <div className={styles.shell} onClick={(e) => e.stopPropagation()}>
        <header className={styles.header}>
          <div className={styles.headerRow}>
            {onBack ? (
              <button
                type="button"
                className={styles.iconBtn}
                onClick={onBack}
                aria-label="Back"
              >
                <i className="ti ti-chevron-left" aria-hidden />
              </button>
            ) : (
              <span className={styles.iconBtnSpacer} />
            )}
            <div className={styles.progress} aria-hidden>
              {Array.from({ length: totalSteps }).map((_, i) => (
                <span
                  key={i}
                  className={[
                    styles.pip,
                    i < step ? styles.pipDone : '',
                    i === step ? styles.pipActive : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                />
              ))}
            </div>
            {onClose ? (
              <button
                type="button"
                className={styles.iconBtn}
                onClick={onClose}
                aria-label="Close"
              >
                <i className="ti ti-x" aria-hidden />
              </button>
            ) : (
              <span className={styles.iconBtnSpacer} />
            )}
          </div>
          <div className={styles.stepLabel}>
            Step {step + 1} of {totalSteps}
          </div>
          <h1 className={styles.title}>{title}</h1>
          {subtitle ? <p className={styles.subtitle}>{subtitle}</p> : null}
        </header>
        <div className={styles.body}>{children}</div>
        <footer className={styles.footer}>
          {footerSecondary ? (
            <div className={styles.footerSecondary}>{footerSecondary}</div>
          ) : null}
          {footerAction}
        </footer>
      </div>
    </div>
  );
}
