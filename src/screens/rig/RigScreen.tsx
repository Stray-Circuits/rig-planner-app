import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { Pedal, PlacedPedal, Rig } from '../../data/schema';
import { BoardCanvas } from '../../canvas/BoardCanvas';
import { useViewport } from '../../canvas/useViewport';
import { centeredOnRig, clampToBoard } from '../../lib/geometry';
import type { Connection, ExternalEndpoint } from '../../data/schema';
import { usePedalsStore } from '../../stores/pedalsStore';
import { usePlacedPedalsStore } from '../../stores/placedPedalsStore';
import { useRigsStore } from '../../stores/rigsStore';
import { useSignalChainStore } from '../../stores/signalChainStore';
import { Sheet, SheetItem } from '../../ui';
import { AddPedalWizard } from '../add-pedal/AddPedalWizard';
import { PedalLibrarySheet } from './PedalLibrarySheet';
import { SettingsSheet } from './SettingsSheet';
import styles from './RigScreen.module.css';

// Stable reference so the selector below doesn't return a fresh `[]` on
// every render and re-trigger the component infinitely.
const EMPTY_PLACED: PlacedPedal[] = [];
const EMPTY_CONNECTIONS: Connection[] = [];
const EMPTY_ENDPOINTS: ExternalEndpoint[] = [];

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

  const renameRig = useRigsStore((s) => s.renameRig);
  const updateBoard = useRigsStore((s) => s.updateBoard);

  const connections = useSignalChainStore(
    (s) => s.connectionsByRig[rig.id] ?? EMPTY_CONNECTIONS,
  );
  const endpoints = useSignalChainStore(
    (s) => s.endpointsByRig[rig.id] ?? EMPTY_ENDPOINTS,
  );
  const loadSignalChain = useSignalChainStore((s) => s.loadForRig);

  const [actionsFor, setActionsFor] = useState<string | null>(null);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [chainMode, setChainMode] = useState(false);

  useEffect(() => {
    if (pedalsStatus === 'idle') void loadPedals();
  }, [pedalsStatus, loadPedals]);

  useEffect(() => {
    void loadForRig(rig.id);
    void loadSignalChain(rig.id);
  }, [rig.id, loadForRig, loadSignalChain]);

  const pedalsById = useMemo(() => {
    const m = new Map<string, Pedal>();
    for (const p of pedals) m.set(p.id, p);
    return m;
  }, [pedals]);

  const handleAddPedal = (pedal: Pedal) => {
    const { xIn, yIn } = centeredOnRig(pedal, rig);
    void addPedalToRig(rig.id, pedal.id, xIn, yIn);
    setLibraryOpen(false);
  };

  const handleSeed = async (): Promise<void> => {
    await seedSamples();
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

  return (
    <div className={styles.screen}>
      <CanvasArea
        rig={rig}
        placed={placed}
        pedalsById={pedalsById}
        onDragMove={dragMove}
        onDragCommit={(id) => {
          void commitMove(id);
        }}
        onRequestActions={setActionsFor}
        chainMode={chainMode}
        connections={connections}
        endpoints={endpoints}
      >
        <div className={styles.fabBackWrap}>
          <button
            type="button"
            className={styles.fab}
            aria-label="Back to rigs"
            onClick={onBack}
          >
            <i className="ti ti-chevron-left" aria-hidden />
          </button>
        </div>
        <div className={styles.fabActions}>
          <button
            type="button"
            className={`${styles.fab} ${chainMode ? styles.fabActive : ''}`}
            aria-label={chainMode ? 'Hide signal chain' : 'Show signal chain'}
            aria-pressed={chainMode}
            onClick={() => setChainMode((v) => !v)}
          >
            <i className="ti ti-route" aria-hidden />
          </button>
          <button
            type="button"
            className={styles.fab}
            aria-label="Add pedal"
            onClick={() => setLibraryOpen(true)}
          >
            <i className="ti ti-plus" aria-hidden />
          </button>
          <button
            type="button"
            className={styles.fab}
            aria-label="Rig settings"
            onClick={() => setSettingsOpen(true)}
          >
            <i className="ti ti-settings" aria-hidden />
          </button>
        </div>
      </CanvasArea>

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

      <PedalLibrarySheet
        open={libraryOpen}
        pedals={pedals}
        onClose={() => setLibraryOpen(false)}
        onAddPedal={handleAddPedal}
        onStartNewPedal={() => {
          setLibraryOpen(false);
          setWizardOpen(true);
        }}
        onSeed={handleSeed}
      />

      <SettingsSheet
        open={settingsOpen}
        rig={rig}
        onClose={() => setSettingsOpen(false)}
        onRename={(name) => renameRig(rig.id, name)}
        onChangeBoard={(w, d, style) => updateBoard(rig.id, w, d, style)}
      />

      {wizardOpen ? (
        <AddPedalWizard
          onCancel={() => setWizardOpen(false)}
          onCreated={(pedal) => {
            // New pedal lands on the board immediately so the user sees what
            // they just made; they can drag it from there.
            handleAddPedal(pedal);
            setWizardOpen(false);
          }}
        />
      ) : null}
    </div>
  );
}

interface CanvasAreaProps {
  rig: Rig;
  placed: PlacedPedal[];
  pedalsById: Map<string, Pedal>;
  onDragMove: (placedId: string, xIn: number, yIn: number) => void;
  onDragCommit: (placedId: string) => void;
  onRequestActions: (placedId: string) => void;
  chainMode: boolean;
  connections: Connection[];
  endpoints: ExternalEndpoint[];
  /** Overlay elements (mobile floating buttons, etc.) painted above the board. */
  children?: ReactNode;
}

function CanvasArea({
  rig,
  placed,
  pedalsById,
  onDragMove,
  onDragCommit,
  onRequestActions,
  chainMode,
  connections,
  endpoints,
  children,
}: CanvasAreaProps) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [pxPerInch, setPxPerInch] = useState(18);
  const { viewport, pointerHandlers, attachWheel, reset, setScale } =
    useViewport();

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const fit = () => {
      const padding = 24;
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
          chainMode={chainMode}
          connections={connections}
          endpoints={endpoints}
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
      {children}
    </div>
  );
}
