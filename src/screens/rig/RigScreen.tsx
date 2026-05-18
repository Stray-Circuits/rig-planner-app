import { useEffect, useMemo, useRef, useState } from 'react';
import type { Pedal, PlacedPedal, Rig } from '../../data/schema';
import { colorFromImagePath } from '../../data/seedPedals';
import { BoardCanvas } from '../../canvas/BoardCanvas';
import { centeredOnRig } from '../../lib/geometry';
import { usePedalsStore } from '../../stores/pedalsStore';
import { usePlacedPedalsStore } from '../../stores/placedPedalsStore';
import { Button } from '../../ui';
import styles from './RigScreen.module.css';

// Stable reference so the selector below doesn't return a fresh `[]` on
// every render and re-trigger the component infinitely.
const EMPTY_PLACED: PlacedPedal[] = [];

interface RigScreenProps {
  rig: Rig;
  onBack: () => void;
}

export function RigScreen({ rig, onBack }: RigScreenProps) {
  const pedals = usePedalsStore((s) => s.pedals);
  const pedalsStatus = usePedalsStore((s) => s.status);
  const loadPedals = usePedalsStore((s) => s.loadPedals);
  const seedSamples = usePedalsStore((s) => s.seedSamples);

  const placed = usePlacedPedalsStore((s) => s.byRig[rig.id] ?? EMPTY_PLACED);
  const loadForRig = usePlacedPedalsStore((s) => s.loadForRig);
  const addPedalToRig = usePlacedPedalsStore((s) => s.addPedalToRig);
  const dragMove = usePlacedPedalsStore((s) => s.dragMove);
  const commitMove = usePlacedPedalsStore((s) => s.commitMove);

  const [seeding, setSeeding] = useState(false);
  const [seedError, setSeedError] = useState<string | null>(null);

  useEffect(() => {
    if (pedalsStatus === 'idle') void loadPedals();
  }, [pedalsStatus, loadPedals]);

  useEffect(() => {
    void loadForRig(rig.id);
  }, [rig.id, loadForRig]);

  const pedalsById = useMemo(() => {
    const m = new Map<string, Pedal>();
    for (const p of pedals) m.set(p.id, p);
    return m;
  }, [pedals]);

  const handleAddPedal = (pedal: Pedal) => {
    const { xIn, yIn } = centeredOnRig(pedal, rig);
    void addPedalToRig(rig.id, pedal.id, xIn, yIn);
  };

  const handleSeed = () => {
    void (async () => {
      setSeeding(true);
      setSeedError(null);
      try {
        await seedSamples();
      } catch (err) {
        setSeedError(err instanceof Error ? err.message : String(err));
      } finally {
        setSeeding(false);
      }
    })();
  };

  return (
    <div className={styles.screen}>
      <header className={styles.topBar}>
        <button
          type="button"
          className={styles.iconBtn}
          aria-label="Back to rigs"
          onClick={onBack}
        >
          <i className="ti ti-chevron-left" aria-hidden />
        </button>
        <div className={styles.titleGroup}>
          <div className={styles.title}>{rig.name}</div>
          <div className={styles.dims}>
            {rig.widthIn}&quot; × {rig.depthIn}&quot;
          </div>
        </div>
      </header>

      <div className={styles.body}>
        <CanvasArea
          rig={rig}
          placed={placed}
          pedalsById={pedalsById}
          empty={placed.length === 0 && pedals.length === 0}
          onSeed={handleSeed}
          seeding={seeding}
          seedError={seedError}
          onDragMove={dragMove}
          onDragCommit={(id) => {
            void commitMove(id);
          }}
        />

        <aside className={styles.sidebar} aria-label="Pedal library">
          <Sidebar
            pedals={pedals}
            seeding={seeding}
            onSeed={handleSeed}
            onAddPedal={handleAddPedal}
          />
        </aside>
      </div>

      <footer className={styles.bottomBar}>
        <span className={styles.bottomHint}>
          {placed.length} placed · style: {rig.style}
        </span>
        <span className={styles.bottomHint}>Tap a pedal to add</span>
      </footer>
    </div>
  );
}

interface CanvasAreaProps {
  rig: Rig;
  placed: PlacedPedal[];
  pedalsById: Map<string, Pedal>;
  empty: boolean;
  onSeed: () => void;
  seeding: boolean;
  seedError: string | null;
  onDragMove: (placedId: string, xIn: number, yIn: number) => void;
  onDragCommit: (placedId: string) => void;
}

function CanvasArea({
  rig,
  placed,
  pedalsById,
  empty,
  onSeed,
  seeding,
  seedError,
  onDragMove,
  onDragCommit,
}: CanvasAreaProps) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [pxPerInch, setPxPerInch] = useState(18);

  // Fit the board into the available viewport whenever the wrap resizes.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const fit = () => {
      const padding = 40;
      const availW = el.clientWidth - padding * 2;
      const availH = el.clientHeight - padding * 2;
      if (availW <= 0 || availH <= 0) return;
      const px = Math.min(availW / rig.widthIn, availH / rig.depthIn);
      setPxPerInch(Math.max(6, Math.min(80, px)));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [rig.widthIn, rig.depthIn]);

  return (
    <div className={styles.canvasArea} ref={wrapRef}>
      <BoardCanvas
        rig={rig}
        placed={placed}
        pedalsById={pedalsById}
        pxPerInch={pxPerInch}
        onDragMove={onDragMove}
        onDragCommit={onDragCommit}
      />
      {empty ? (
        <div className={styles.emptyOverlay}>
          <p>Your library is empty.</p>
          <Button onClick={onSeed} disabled={seeding}>
            {seeding ? 'Seeding…' : 'Seed sample pedals'}
          </Button>
          {seedError ? (
            <p className={styles.error}>{seedError}</p>
          ) : (
            <p className={styles.muted}>
              Adds 6 common pedals. The real Add Pedal wizard lands in phase 4.
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}

interface SidebarProps {
  pedals: Pedal[];
  seeding: boolean;
  onSeed: () => void;
  onAddPedal: (pedal: Pedal) => void;
}

function Sidebar({ pedals, seeding, onSeed, onAddPedal }: SidebarProps) {
  return (
    <>
      <div className={styles.sidebarHeader}>
        <span>Pedals</span>
      </div>
      <div className={styles.pedalList}>
        {pedals.map((p) => (
          <button
            key={p.id}
            type="button"
            className={styles.pedalEntry}
            title={`Add ${p.name} to rig`}
            onClick={() => onAddPedal(p)}
          >
            <span
              className={styles.pedalThumb}
              style={{
                background: colorFromImagePath(p.imagePath) ?? '#444',
              }}
              aria-hidden
            />
            <div className={styles.pedalInfo}>
              <div className={styles.pedalName}>{p.name}</div>
              <div className={styles.pedalBrand}>{p.brand}</div>
            </div>
          </button>
        ))}
        {pedals.length === 0 ? (
          <p className={styles.sidebarMuted}>No pedals yet.</p>
        ) : null}
      </div>
      <div className={styles.sidebarFooter}>
        <Button
          variant="secondary"
          size="sm"
          fullWidth
          disabled={seeding}
          onClick={onSeed}
        >
          <i className="ti ti-flask" aria-hidden />{' '}
          {seeding ? 'Seeding…' : 'Seed samples'}
        </Button>
      </div>
    </>
  );
}
