import { useEffect, useState } from 'react';
import { initDb } from '../data/db';
import { seedDefaultPedals } from '../data/seedPedals';
import { useBackHandler } from '../lib/useBackHandler';
import { useRigsStore } from '../stores/rigsStore';
import { useUiStore } from '../stores/uiStore';
import { AboutScreen } from '../screens/about/AboutScreen';
import { NewRigWizard } from '../screens/new-rig/NewRigWizard';
import { RigList } from '../screens/rigs/RigList';
import { RigScreen } from '../screens/rig/RigScreen';
import type { Rig } from '../data/schema';
import styles from './App.module.css';

type BootState =
  | { status: 'loading' }
  | { status: 'ready' }
  | { status: 'error'; message: string };

type Route =
  | { kind: 'rigs' }
  | { kind: 'new-rig' }
  | { kind: 'rig'; rigId: string }
  | { kind: 'about' };

export function App() {
  const [boot, setBoot] = useState<BootState>({ status: 'loading' });
  const [route, setRoute] = useState<Route | null>(null);

  const rigs = useRigsStore((s) => s.rigs);
  const rigsStatus = useRigsStore((s) => s.status);
  const loadRigs = useRigsStore((s) => s.loadRigs);
  const openRig = useRigsStore((s) => s.openRig);
  const lastRigId = useUiStore((s) => s.lastRigId);

  useEffect(() => {
    let cancelled = false;
    initDb()
      .then(() =>
        // Best-effort: don't block boot if seeding fails (e.g. a transient
        // DB error). Missing seed pedals are recoverable on next launch.
        seedDefaultPedals().catch((err: unknown) => {
          console.warn('[boot] seedDefaultPedals failed', err);
        }),
      )
      .then(() => loadRigs())
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
  }, [loadRigs]);

  // Decide the initial route once rigs are ready and no route has been
  // chosen yet. No rigs → wizard; otherwise last-opened (or list).
  // Computed during render; once `route` is set the branch is inert.
  if (rigsStatus === 'ready' && route === null) {
    if (rigs.length === 0) {
      setRoute({ kind: 'new-rig' });
    } else if (lastRigId && rigs.some((r) => r.id === lastRigId)) {
      setRoute({ kind: 'rig', rigId: lastRigId });
    } else {
      setRoute({ kind: 'rigs' });
    }
  }

  // Hardware back navigates between top-level routes — rig → rigs list,
  // new-rig (when rigs exist) → rigs list. Top-level back at the rigs
  // list falls through to the OS so Tauri Android exits the app.
  useBackHandler(
    route !== null &&
      (route.kind === 'rig' ||
        route.kind === 'new-rig' ||
        route.kind === 'about'),
    () => {
      if (!route) return false;
      if (route.kind === 'rig') {
        setRoute({ kind: 'rigs' });
        return true;
      }
      if (route.kind === 'new-rig' && rigs.length > 0) {
        setRoute({ kind: 'rigs' });
        return true;
      }
      if (route.kind === 'about') {
        setRoute({ kind: 'rigs' });
        return true;
      }
      return false;
    },
  );

  if (boot.status === 'loading' || !route) {
    return (
      <div className={styles.shell}>
        <main className={styles.main}>
          <p className={styles.muted}>Starting up…</p>
        </main>
      </div>
    );
  }

  if (boot.status === 'error') {
    return (
      <div className={styles.shell}>
        <main className={styles.main}>
          <div className={styles.errorBox} role="alert">
            <strong>Could not start the app.</strong>
            <pre>{boot.message}</pre>
          </div>
        </main>
      </div>
    );
  }

  if (route.kind === 'new-rig') {
    return (
      <NewRigWizard
        rigCount={rigs.length}
        onCreated={(rig: Rig) => {
          void openRig(rig.id);
          setRoute({ kind: 'rig', rigId: rig.id });
        }}
        {...(rigs.length > 0
          ? { onCancel: () => setRoute({ kind: 'rigs' }) }
          : {})}
      />
    );
  }

  if (route.kind === 'rigs') {
    return (
      <RigList
        onCreateRig={() => setRoute({ kind: 'new-rig' })}
        onOpenRig={(rig) => {
          void openRig(rig.id);
          setRoute({ kind: 'rig', rigId: rig.id });
        }}
        onOpenAbout={() => setRoute({ kind: 'about' })}
      />
    );
  }

  if (route.kind === 'about') {
    return <AboutScreen onBack={() => setRoute({ kind: 'rigs' })} />;
  }

  const rig = rigs.find((r) => r.id === route.rigId);
  if (!rig) {
    // Rig was deleted out from under us; bounce to the list.
    setRoute({ kind: 'rigs' });
    return null;
  }

  return <RigScreen rig={rig} onBack={() => setRoute({ kind: 'rigs' })} />;
}
