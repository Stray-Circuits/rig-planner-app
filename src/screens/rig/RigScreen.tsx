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
import {
  computeUnconnectedRequiredPorts,
  connectionCompatibility,
} from '../../lib/signalChainWarnings';
import {
  type FloorStyle,
  readFloorStyle,
  writeFloorStyle,
} from '../../lib/floorStyle';
import type { Connection, ExternalEndpoint } from '../../data/schema';
import { usePedalsStore } from '../../stores/pedalsStore';
import { usePlacedPedalsStore } from '../../stores/placedPedalsStore';
import { useRigsStore } from '../../stores/rigsStore';
import { useSignalChainStore } from '../../stores/signalChainStore';
import { Sheet, SheetItem } from '../../ui';
import { AddPedalWizard } from '../add-pedal/AddPedalWizard';
import { PedalLibrarySheet } from './PedalLibrarySheet';
import { PortPickerSheet } from './PortPickerSheet';
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
  const addEndpoint = useSignalChainStore((s) => s.addEndpoint);
  const removeEndpoint = useSignalChainStore((s) => s.removeEndpoint);

  const [floorStyle, setFloorStyle] = useState<FloorStyle>(() =>
    readFloorStyle(),
  );
  const changeFloor = (next: FloorStyle) => {
    setFloorStyle(next);
    writeFloorStyle(next);
  };

  const [actionsFor, setActionsFor] = useState<string | null>(null);
  // Pedal whose port picker is currently open in chain mode.
  const [pickerFor, setPickerFor] = useState<string | null>(null);
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
  const [editingPedal, setEditingPedal] = useState<Pedal | null>(null);
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

  // Set of "${placedId}:${portId}" keys for every port currently
  // touched by at least one cable. Used by the picker to surface a
  // "connected" hint per row.
  const connectedPortKeys = useMemo(() => {
    const out = new Set<string>();
    for (const c of connections) {
      if (c.fromNodeKind === 'pedal' && c.fromPortId)
        out.add(`${c.fromNodeId}:${c.fromPortId}`);
      if (c.toNodeKind === 'pedal' && c.toPortId)
        out.add(`${c.toNodeId}:${c.toPortId}`);
    }
    return out;
  }, [connections]);

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

  /**
   * Validate a pair of pedal ports and (if compatible) persist a cable.
   * Used both by tap-then-tap (handlePortTap) and the new drag-to-connect
   * gesture. Returns true if a connection was created so callers can clear
   * any state (e.g. armed port) on success.
   */
  const tryConnectPorts = (
    aPlacedId: string,
    aPortId: string,
    bPlacedId: string,
    bPortId: string,
  ): boolean => {
    const aOwner = placed.find((p) => p.id === aPlacedId);
    const bOwner = placed.find((p) => p.id === bPlacedId);
    const aPort = aOwner
      ? pedalsById.get(aOwner.pedalId)?.ports.find((p) => p.id === aPortId)
      : null;
    const bPort = bOwner
      ? pedalsById.get(bOwner.pedalId)?.ports.find((p) => p.id === bPortId)
      : null;
    if (!aPort || !bPort) return false;
    const compat = connectionCompatibility(aPort.signalType, bPort.signalType);
    if (!compat.ok) {
      setNotice(compat.reason);
      return false;
    }
    // Outputs become "from", inputs become "to". Swap if needed.
    const aIsOutput = isOutputRole(aPort.role);
    const bIsOutput = isOutputRole(bPort.role);
    const swap = !aIsOutput && bIsOutput;
    void addConnection({
      rigId: rig.id,
      fromNodeKind: 'pedal',
      fromNodeId: swap ? bPlacedId : aPlacedId,
      fromPortId: swap ? bPortId : aPortId,
      toNodeKind: 'pedal',
      toNodeId: swap ? aPlacedId : bPlacedId,
      toPortId: swap ? aPortId : bPortId,
    });
    return true;
  };

  const handlePortTap = (placedId: string, portId: string) => {
    if (!armedPort) {
      setArmedPort({ placedId, portId });
      return;
    }
    if (armedPort.placedId === placedId && armedPort.portId === portId) {
      setArmedPort(null);
      return;
    }
    tryConnectPorts(armedPort.placedId, armedPort.portId, placedId, portId);
    setArmedPort(null);
  };

  const handlePortConnect = (
    fromPlacedId: string,
    fromPortId: string,
    toPlacedId: string,
    toPortId: string,
  ) => {
    if (fromPlacedId === toPlacedId && fromPortId === toPortId) return;
    tryConnectPorts(fromPlacedId, fromPortId, toPlacedId, toPortId);
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
    // External endpoints (guitar / amp jacks) are all audio. A MIDI/control
    // pedal port routing to one is meaningless — block + warn. 'custom'
    // endpoints have no declared family so we let them through.
    if (ep.kind !== 'custom') {
      const compat = connectionCompatibility(
        armedPortDef.signalType,
        'instrument',
      );
      if (!compat.ok) {
        setNotice(compat.reason);
        setArmedPort(null);
        return;
      }
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
        floorStyle={floorStyle}
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
        onPedalTap={setPickerFor}
        onPortConnect={handlePortConnect}
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

      {(() => {
        const placedForPicker = pickerFor
          ? (placed.find((p) => p.id === pickerFor) ?? null)
          : null;
        const pedalForPicker = placedForPicker
          ? (pedalsById.get(placedForPicker.pedalId) ?? null)
          : null;
        const armedDetail = (() => {
          if (!armedPort) return null;
          const ow = placed.find((p) => p.id === armedPort.placedId);
          if (!ow) return null;
          const def = pedalsById.get(ow.pedalId);
          if (!def) return null;
          const port = def.ports.find((p) => p.id === armedPort.portId);
          if (!port) return null;
          return { placedId: ow.id, pedal: def, port };
        })();
        return (
          <PortPickerSheet
            open={pickerFor !== null}
            placed={placedForPicker}
            pedal={pedalForPicker}
            armedFromPort={armedDetail}
            connectedPortIds={connectedPortKeys}
            onClose={() => setPickerFor(null)}
            onPickPort={(placedId, portId) => {
              handlePortTap(placedId, portId);
              setPickerFor(null);
            }}
          />
        );
      })()}

      <PedalLibrarySheet
        open={libraryOpen}
        pedals={pedals}
        onClose={() => setLibraryOpen(false)}
        onAddPedal={handleAddPedal}
        onStartNewPedal={() => {
          setLibraryOpen(false);
          setWizardOpen(true);
        }}
        onStartEditPedal={(pedal) => {
          setLibraryOpen(false);
          setEditingPedal(pedal);
        }}
        onSeed={handleSeed}
      />

      <SettingsSheet
        open={settingsOpen}
        rig={rig}
        placedCount={placed.length}
        floorStyle={floorStyle}
        endpoints={endpoints}
        onClose={() => setSettingsOpen(false)}
        onRename={(name) => renameRig(rig.id, name)}
        onChangeFloor={changeFloor}
        onAddEndpoint={async (kind, label) => {
          await addEndpoint(rig.id, kind, label);
        }}
        onRemoveEndpoint={async (id) => {
          await removeEndpoint(rig.id, id);
        }}
        onChangeBoard={async (w, d, style, presetId) => {
          await updateBoard(rig.id, w, d, style, presetId);
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
        onExport={async () => {
          const { buildRigExport, defaultExportFilename } =
            await import('../../lib/rigPortability');
          const exp = buildRigExport({
            rig,
            pedals,
            placedPedals: placed,
            endpoints,
            connections,
          });
          return {
            filename: defaultExportFilename(rig),
            json: JSON.stringify(exp, null, 2),
          };
        }}
      />

      {wizardOpen || editingPedal ? (
        <AddPedalWizard
          {...(editingPedal ? { initialPedal: editingPedal } : {})}
          onCancel={() => {
            setWizardOpen(false);
            setEditingPedal(null);
            // Reopen the library so the user lands back in context.
            if (editingPedal) setLibraryOpen(true);
          }}
          onCreated={(pedal) => {
            if (editingPedal) {
              // Edit flow: no auto-add, the pedal is already placed in
              // some rig(s). Stores reload themselves inside updatePedal.
              setEditingPedal(null);
              setLibraryOpen(true);
            } else {
              // New pedal lands on the board immediately so the user sees
              // what they just made; they can drag it from there.
              handleAddPedal(pedal);
              setWizardOpen(false);
            }
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
  floorStyle: FloorStyle;
  onDragMove: (placedId: string, xIn: number, yIn: number) => void;
  onDragCommit: (placedId: string) => void;
  onRequestActions: (placedId: string) => void;
  chainMode: boolean;
  connections: Connection[];
  endpoints: ExternalEndpoint[];
  armedPort: { placedId: string; portId: string } | null;
  unconnectedRequired: Set<string>;
  onPortTap: (placedId: string, portId: string) => void;
  onPedalTap: (placedId: string) => void;
  onPortConnect: (
    fromPlacedId: string,
    fromPortId: string,
    toPlacedId: string,
    toPortId: string,
  ) => void;
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
  floorStyle,
  onDragMove,
  onDragCommit,
  onRequestActions,
  chainMode,
  connections,
  endpoints,
  armedPort,
  unconnectedRequired,
  onPortTap,
  onPedalTap,
  onPortConnect,
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
      // Reserve enough space on each side that the board's edges always
      // clear the corner FABs at the default centered/unzoomed view —
      // i.e. the board "dodges" the floating buttons. Flex centering then
      // distributes the reserve symmetrically. Bottom FABs are the tallest
      // (Add/Chain at 64px + 24px inset ≈ 88px), so mirror that vertically.
      // Side reserves stay small — corner FABs already clear horizontally
      // via the vertical reserve.
      const vertReserve = 92;
      const sideReserve = 14;
      const availW = el.clientWidth - sideReserve * 2;
      const availH = el.clientHeight - vertReserve * 2;
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

  const floorClass =
    floorStyle === 'concrete_grey'
      ? styles.floorConcreteGrey
      : floorStyle === 'stage_black'
        ? styles.floorStageBlack
        : floorStyle === 'carpet_beige'
          ? styles.floorCarpetBeige
          : floorStyle === 'wood'
            ? styles.floorWood
            : styles.floorSidewalk;

  return (
    <div
      className={`${styles.canvasArea} ${floorClass}`}
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
          onPedalTap={onPedalTap}
          onPortConnect={onPortConnect}
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
