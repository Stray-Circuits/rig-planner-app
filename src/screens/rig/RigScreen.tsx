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
import {
  centeredOnRig,
  clampToBoard,
  placedFootprint,
} from '../../lib/geometry';
import { computeUnconnectedRequiredPorts } from '../../lib/signalChainWarnings';
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
  const clampToRigBounds = usePlacedPedalsStore((s) => s.clampToRigBounds);

  const renameRig = useRigsStore((s) => s.renameRig);
  const updateBoard = useRigsStore((s) => s.updateBoard);
  const deleteRig = useRigsStore((s) => s.deleteRig);

  const connections = useSignalChainStore(
    (s) => s.connectionsByRig[rig.id] ?? EMPTY_CONNECTIONS,
  );
  const endpoints = useSignalChainStore(
    (s) => s.endpointsByRig[rig.id] ?? EMPTY_ENDPOINTS,
  );
  const loadSignalChain = useSignalChainStore((s) => s.loadForRig);
  const addConnection = useSignalChainStore((s) => s.addConnection);
  const removeConnection = useSignalChainStore((s) => s.removeConnection);

  const [actionsFor, setActionsFor] = useState<string | null>(null);
  // Short-lived non-blocking message shown above the canvas (e.g. when we
  // refuse a rotation that wouldn't fit). Auto-dismisses after a few seconds.
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 3500);
    return () => clearTimeout(t);
  }, [notice]);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [chainMode, setChainMode] = useState(false);
  const [armedPort, setArmedPort] = useState<{
    placedId: string;
    portId: string;
  } | null>(null);

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

  const unconnectedRequired = useMemo(
    () => computeUnconnectedRequiredPorts(placed, pedalsById, connections),
    [placed, pedalsById, connections],
  );

  const handleAddPedal = (pedal: Pedal) => {
    const { xIn, yIn } = centeredOnRig(pedal, rig);
    void addPedalToRig(rig.id, pedal.id, xIn, yIn);
    setLibraryOpen(false);
  };

  const handleSeed = async (): Promise<void> => {
    await seedSamples();
  };

  // Reset armed port when leaving chain mode.
  useEffect(() => {
    if (!chainMode) setArmedPort(null);
  }, [chainMode]);

  const isOutputRole = (role: string) =>
    role === 'output' ||
    role === 'output_l' ||
    role === 'output_r' ||
    role === 'stereo_output' ||
    role === 'fx_send' ||
    role === 'midi_out';

  const handlePortTap = (placedId: string, portId: string) => {
    if (!armedPort) {
      setArmedPort({ placedId, portId });
      return;
    }
    if (armedPort.placedId === placedId && armedPort.portId === portId) {
      setArmedPort(null);
      return;
    }
    // Determine flow direction by role: outputs become "from", inputs become
    // "to". If the user tapped input-then-output, swap them so cables point
    // the right way for the chain view.
    const armed = placed
      .map((p) => ({
        placed: p,
        pedal: pedalsById.get(p.pedalId),
      }))
      .find((x) => x.placed.id === armedPort.placedId);
    const target = placed
      .map((p) => ({
        placed: p,
        pedal: pedalsById.get(p.pedalId),
      }))
      .find((x) => x.placed.id === placedId);
    const armedPortDef = armed?.pedal?.ports.find(
      (p) => p.id === armedPort.portId,
    );
    const targetPortDef = target?.pedal?.ports.find((p) => p.id === portId);
    if (!armedPortDef || !targetPortDef) {
      setArmedPort(null);
      return;
    }
    const armedIsOutput = isOutputRole(armedPortDef.role);
    const targetIsOutput = isOutputRole(targetPortDef.role);
    const swap = !armedIsOutput && targetIsOutput;
    const fromPlacedId = swap ? placedId : armedPort.placedId;
    const fromPortId = swap ? portId : armedPort.portId;
    const toPlacedId = swap ? armedPort.placedId : placedId;
    const toPortId = swap ? armedPort.portId : portId;

    void addConnection({
      rigId: rig.id,
      fromNodeKind: 'pedal',
      fromNodeId: fromPlacedId,
      fromPortId: fromPortId,
      toNodeKind: 'pedal',
      toNodeId: toPlacedId,
      toPortId: toPortId,
    });
    setArmedPort(null);
  };

  const handleCanvasBackgroundClick = () => {
    if (chainMode && armedPort) setArmedPort(null);
  };

  const handleCableTap = (connectionId: string) => {
    void removeConnection(rig.id, connectionId);
  };

  const handleEndpointTap = (endpointId: string) => {
    if (!armedPort) return;
    const ep = endpoints.find((e) => e.id === endpointId);
    if (!ep) return;
    const armed = placed.find((p) => p.id === armedPort.placedId);
    const armedPortDef = armed
      ? pedalsById
          .get(armed.pedalId)
          ?.ports.find((p) => p.id === armedPort.portId)
      : null;
    if (!armedPortDef) {
      setArmedPort(null);
      return;
    }
    const armedIsOutput = isOutputRole(armedPortDef.role);
    const endpointIsSource = ep.kind === 'guitar' || ep.kind === 'amp_fx_send';
    // Endpoint is "from" if it's a source; otherwise the pedal port is the source.
    const fromIsEndpoint = endpointIsSource;
    void addConnection({
      rigId: rig.id,
      fromNodeKind: fromIsEndpoint ? 'external' : 'pedal',
      fromNodeId: fromIsEndpoint ? ep.id : armedPort.placedId,
      fromPortId: fromIsEndpoint ? null : armedPort.portId,
      toNodeKind: fromIsEndpoint ? 'pedal' : 'external',
      toNodeId: fromIsEndpoint ? armedPort.placedId : ep.id,
      toPortId: fromIsEndpoint ? armedPort.portId : null,
    });
    // Avoid the "unused" warning when armedIsOutput is later relevant. The
    // direction is currently determined by endpoint kind alone, so we
    // intentionally ignore the port role here.
    void armedIsOutput;
    setArmedPort(null);
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
    const footprint = placedFootprint(targetPedal, nextRotation);
    if (footprint.widthIn > rig.widthIn || footprint.depthIn > rig.depthIn) {
      // Rotated pedal would exceed the board; refuse + surface a hint
      // rather than jumping the pedal back to (0, 0) and visibly clipping.
      setNotice(
        `${targetPedal.brand} ${targetPedal.name} won't fit rotated — board is too narrow.`,
      );
      closeActions();
      return;
    }
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
      {notice ? (
        <div className={styles.notice} role="status">
          {notice}
        </div>
      ) : null}
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
        armedPort={armedPort}
        unconnectedRequired={unconnectedRequired}
        onPortTap={handlePortTap}
        onCableTap={handleCableTap}
        onEndpointTap={handleEndpointTap}
        onBackgroundTap={handleCanvasBackgroundClick}
      >
        <div className={styles.fabTopLeft}>
          <button
            type="button"
            className={styles.fab}
            aria-label="Back to rigs"
            onClick={onBack}
          >
            <i className="ti ti-chevron-left" aria-hidden />
          </button>
        </div>
        <div className={styles.fabTopRight}>
          <button
            type="button"
            className={styles.fab}
            aria-label="Rig settings"
            onClick={() => setSettingsOpen(true)}
          >
            <i className="ti ti-settings" aria-hidden />
          </button>
        </div>
        <div className={styles.fabBottomRight}>
          <button
            type="button"
            className={`${styles.fab} ${styles.fabChain} ${
              chainMode ? styles.fabActive : ''
            }`}
            aria-label={chainMode ? 'Hide signal chain' : 'Show signal chain'}
            aria-pressed={chainMode}
            onClick={() => setChainMode((v) => !v)}
          >
            <i className="ti ti-route" aria-hidden />
          </button>
          <button
            type="button"
            className={`${styles.fab} ${styles.fabAddPedal}`}
            aria-label="Add pedal"
            onClick={() => setLibraryOpen(true)}
          >
            <i className="ti ti-plus" aria-hidden />
          </button>
        </div>
      </CanvasArea>

      {chainMode && unconnectedRequired.size > 0 ? (
        <div className={styles.chainStatusPill} role="status">
          <i className="ti ti-alert-triangle" aria-hidden />
          {unconnectedRequired.size} routing issue
          {unconnectedRequired.size === 1 ? '' : 's'}
        </div>
      ) : null}

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
        placedCount={placed.length}
        onClose={() => setSettingsOpen(false)}
        onRename={(name) => renameRig(rig.id, name)}
        onChangeBoard={async (w, d, style) => {
          await updateBoard(rig.id, w, d, style);
          await clampToRigBounds(
            { id: rig.id, widthIn: w, depthIn: d },
            pedalsById,
          );
        }}
        onDelete={async () => {
          await deleteRig(rig.id);
          setSettingsOpen(false);
          onBack();
        }}
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
  armedPort: { placedId: string; portId: string } | null;
  unconnectedRequired: Set<string>;
  onPortTap: (placedId: string, portId: string) => void;
  onCableTap: (connectionId: string) => void;
  onEndpointTap: (endpointId: string) => void;
  onBackgroundTap: () => void;
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
  armedPort,
  unconnectedRequired,
  onPortTap,
  onCableTap,
  onEndpointTap,
  onBackgroundTap,
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
      // Reserve vertical room for the endpoint chip strip above the board so
      // chips don't get clipped by the canvas-area's overflow. Horizontal
      // padding stays modest — chips wrap into clusters at the corners.
      const padding = 24;
      const endpointBudget = 44;
      const availW = el.clientWidth - padding * 2;
      const availH = el.clientHeight - padding * 2 - endpointBudget;
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
      onClick={(e) => {
        // Background click cancels an armed port in chain mode.
        if (e.target === e.currentTarget) onBackgroundTap();
      }}
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
          armedPort={armedPort}
          unconnectedRequired={unconnectedRequired}
          onPortTap={onPortTap}
          onCableTap={onCableTap}
          onEndpointTap={onEndpointTap}
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
