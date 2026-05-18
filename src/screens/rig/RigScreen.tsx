import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Pedal, PlacedPedal, Rig } from '../../data/schema';
import { colorFromImagePath } from '../../data/seedPedals';
import { BoardCanvas } from '../../canvas/BoardCanvas';
import { useViewport } from '../../canvas/useViewport';
import { centeredOnRig, clampToBoard } from '../../lib/geometry';
import { usePedalsStore } from '../../stores/pedalsStore';
import { usePlacedPedalsStore } from '../../stores/placedPedalsStore';
import { Button, Sheet, SheetItem } from '../../ui';
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
  const rotateAction = usePlacedPedalsStore((s) => s.rotate);
  const moveAction = usePlacedPedalsStore((s) => s.move);
  const duplicateAction = usePlacedPedalsStore((s) => s.duplicate);
  const removeAction = usePlacedPedalsStore((s) => s.remove);

  const [actionsFor, setActionsFor] = useState<string | null>(null);

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

  const targetPlaced = useMemo(
    () => placed.find((p) => p.id === actionsFor) ?? null,
    [placed, actionsFor],
  );
  const targetPedal = targetPlaced
    ? pedalsById.get(targetPlaced.pedalId)
    : null;

  const closeActions = () => setActionsFor(null);

  const handleRotate = () => {
    if (!targetPlaced || !targetPedal) return;
    const nextRotation = ((targetPlaced.rotation + 90) %
      360) as PlacedPedal['rotation'];
    void rotateAction(targetPlaced.id, nextRotation);
    // After rotating, the footprint may push the pedal off the board — clamp.
    const clamped = clampToBoard(
      targetPlaced.xIn,
      targetPlaced.yIn,
      targetPedal,
      nextRotation,
      rig,
    );
    if (clamped.xIn !== targetPlaced.xIn || clamped.yIn !== targetPlaced.yIn) {
      void moveAction(targetPlaced.id, clamped.xIn, clamped.yIn);
    }
    closeActions();
  };

  const handleDuplicate = () => {
    if (!actionsFor) return;
    void duplicateAction(actionsFor);
    closeActions();
  };

  const handleRemove = () => {
    if (!actionsFor) return;
    void removeAction(actionsFor);
    closeActions();
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
          onRequestActions={setActionsFor}
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

      <Sheet
        open={actionsFor !== null}
        onClose={closeActions}
        title={targetPedal ? targetPedal.name : 'Pedal'}
      >
        <SheetItem
          icon={<i className="ti ti-rotate-clockwise" aria-hidden />}
          label="Rotate 90°"
          onClick={handleRotate}
        />
        <SheetItem
          icon={<i className="ti ti-copy" aria-hidden />}
          label="Duplicate"
          onClick={handleDuplicate}
        />
        <SheetItem
          icon={<i className="ti ti-trash" aria-hidden />}
          label="Remove"
          destructive
          onClick={handleRemove}
        />
      </Sheet>
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
  onRequestActions: (placedId: string) => void;
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
  onRequestActions,
}: CanvasAreaProps) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [pxPerInch, setPxPerInch] = useState(18);
  const { viewport, pointerHandlers, attachWheel, reset, setScale } =
    useViewport();

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

  const wrapRefCallback = useCallback(
    (el: HTMLDivElement | null) => {
      wrapRef.current = el;
      attachWheel(el);
    },
    [attachWheel],
  );

  return (
    <div
      className={styles.canvasArea}
      ref={wrapRefCallback}
      onPointerDown={pointerHandlers.onPointerDown}
      onPointerMove={pointerHandlers.onPointerMove}
      onPointerUp={pointerHandlers.onPointerUp}
      onPointerCancel={pointerHandlers.onPointerCancel}
    >
      <div
        className={styles.canvasTransform}
        style={{
          transform: `translate(${viewport.panX}px, ${viewport.panY}px) scale(${viewport.scale})`,
        }}
      >
        <BoardCanvas
          rig={rig}
          placed={placed}
          pedalsById={pedalsById}
          pxPerInch={pxPerInch}
          onDragMove={onDragMove}
          onDragCommit={onDragCommit}
          onRequestActions={onRequestActions}
        />
      </div>
      {viewport.scale !== 1 || viewport.panX !== 0 || viewport.panY !== 0 ? (
        <div className={styles.zoomControls}>
          <button
            type="button"
            className={styles.zoomBtn}
            aria-label="Reset zoom"
            onClick={reset}
          >
            <i className="ti ti-focus-centered" aria-hidden />
          </button>
          <button
            type="button"
            className={styles.zoomBtn}
            aria-label="Zoom out"
            onClick={() => setScale(viewport.scale * 0.8)}
          >
            <i className="ti ti-minus" aria-hidden />
          </button>
          <span className={styles.zoomLabel}>
            {Math.round(viewport.scale * 100)}%
          </span>
          <button
            type="button"
            className={styles.zoomBtn}
            aria-label="Zoom in"
            onClick={() => setScale(viewport.scale * 1.25)}
          >
            <i className="ti ti-plus" aria-hidden />
          </button>
        </div>
      ) : null}
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
