import { useEffect, useState } from 'react';
import { initDb } from '../data/db';
import styles from './App.module.css';

type BootState =
  | { status: 'loading' }
  | { status: 'ready' }
  | { status: 'error'; message: string };

export function App() {
  const [boot, setBoot] = useState<BootState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    initDb()
      .then(() => {
        if (!cancelled) setBoot({ status: 'ready' });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        setBoot({ status: 'error', message });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className={styles.shell}>
      <header className={styles.titlebar}>
        <i className="ti ti-circuit-board" aria-hidden />
        <span className={styles.title}>Rig Planner</span>
      </header>
      <main className={styles.main}>
        {boot.status === 'loading' && (
          <p className={styles.muted}>Starting up…</p>
        )}
        {boot.status === 'ready' && (
          <div className={styles.hero}>
            <h1 className={styles.heroTitle}>Welcome</h1>
            <p className={styles.muted}>
              Phase 1 scaffold is live. The New Rig wizard lands in phase 2.
            </p>
          </div>
        )}
        {boot.status === 'error' && (
          <div className={styles.errorBox} role="alert">
            <strong>Could not start the app.</strong>
            <pre>{boot.message}</pre>
          </div>
        )}
      </main>
    </div>
  );
}
