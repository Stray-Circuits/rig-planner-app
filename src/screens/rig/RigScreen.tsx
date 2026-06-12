import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import type { Pedal, PlacedPedal, Port, Rig } from '../../data/schema';
import { BoardCanvas, type BoardCanvasHandle } from '../../canvas/BoardCanvas';
import { useViewport } from '../../canvas/useViewport';
import {
  centeredOnRig,
  clampToBoard,
  placedFootprint,
} from '../../lib/geometry';
import {
  computeUnconnectedRequiredPorts,
  connectionCompatibility,
  isOutputRole,
  maxCablesForConnector,
} from '../../lib/signalChainWarnings';
import { isEndpointSource } from '../../lib/externalIo';
import {
  type CustomFloor,
  customFloorBackgroundStyle,
  type FloorStyle,
  readCustomFloor,
  readFloorStyle,
  writeCustomFloor,
  writeFloorStyle,
} from '../../lib/floorStyle';
import type { Connection, ExternalEndpoint } from '../../data/schema';
import { usePedalsStore } from '../../stores/pedalsStore';
import { usePlacedPedalsStore } from '../../stores/placedPedalsStore';
import { useRigsStore } from '../../stores/rigsStore';
import { useSignalChainStore } from '../../stores/signalChainStore';
import { Sheet, SheetItem, SpinnerOverlay } from '../../ui';
import { AddPedalWizard } from '../add-pedal/AddPedalWizard';
import { PedalLibrarySheet } from './PedalLibrarySheet';
import { PortPickerSheet, type ArmedSource } from './PortPickerSheet';
import {
  EndpointActionsSheet,
  type EndpointCable,
} from './EndpointActionsSheet';
import { SettingsSheet } from './SettingsSheet';
import styles from './RigScreen.module.css';

// Stable reference so the selector below doesn't return a fresh `[]` on
// every render and re-trigger the component infinitely.
const EMPTY_PLACED: PlacedPedal[] = [];
const EMPTY_CONNECTIONS: Connection[] = [];
const EMPTY_ENDPOINTS: ExternalEndpoint[] = [];

/**
 * Chain-mode "armed" source — the first thing the user tapped, waiting
 * for a second tap to complete a connection. Can be either a pedal port
 * or an external endpoint chip; both are valid starting points.
 */
type Armed =
  | { kind: 'port'; placedId: string; portId: string }
  | { kind: 'endpoint'; endpointId: string };

interface RigScreenProps {
  rig: Rig;
  onBack: () => void;
}

export function RigScreen({ rig, onBack }: RigScreenProps) {
  const pedals = usePedalsStore((s) => s.pedals);
  const pedalsStatus = usePedalsStore((s) => s.status);
  const pedalImagesReady = usePedalsStore((s) => s.imagesReady);
  const loadPedals = usePedalsStore((s) => s.loadPedals);

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
  const updateJackSize = useRigsStore((s) => s.updateJackSize);
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
  const [customFloor, setCustomFloor] = useState<CustomFloor>(() =>
    readCustomFloor(),
  );
  const changeFloor = (next: FloorStyle) => {
    setFloorStyle(next);
    writeFloorStyle(next);
  };
  const changeCustomFloor = (next: CustomFloor) => {
    setCustomFloor(next);
    writeCustomFloor(next);
  };

  const [actionsFor, setActionsFor] = useState<string | null>(null);
  // Pedal whose port picker is currently open in chain mode.
  const [pickerFor, setPickerFor] = useState<string | null>(null);
  // Endpoint chip whose actions sheet (disconnect + arm) is open.
  const [endpointActionsFor, setEndpointActionsFor] = useState<string | null>(
    null,
  );
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
  // Where to return when the edit wizard closes. Editing from the
  // library sheet should pop back into the library; editing from the
  // canvas hold-menu should land back on the canvas.
  const [editReturnTo, setEditReturnTo] = useState<'library' | 'canvas'>(
    'library',
  );
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [chainMode, setChainMode] = useState(false);
  const [armed, setArmed] = useState<Armed | null>(null);
  // Legacy aliases — `armedPort` is the pedal-port view, used by the
  // picker subtitle, port-dot highlight, and the older arm/unarm
  // callsites. `setArmedPort` is the same shape so existing setters
  // don't have to know about the endpoint variant.
  const armedPort = armed?.kind === 'port' ? armed : null;
  const armedEndpointId = armed?.kind === 'endpoint' ? armed.endpointId : null;
  const setArmedPort = (next: { placedId: string; portId: string } | null) => {
    setArmed(next === null ? null : { kind: 'port', ...next });
  };

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

  // Number of cables touching each "${placedId}:${portId}". Drives the
  // picker's "connected" hint, the disconnect count, and the saturation
  // gate in tryConnectPorts (TRS holds two; everything else holds one).
  const cableCountByPort = useMemo(() => {
    const out = new Map<string, number>();
    const bump = (key: string) => out.set(key, (out.get(key) ?? 0) + 1);
    for (const c of connections) {
      if (c.fromNodeKind === 'pedal' && c.fromPortId)
        bump(`${c.fromNodeId}:${c.fromPortId}`);
      if (c.toNodeKind === 'pedal' && c.toPortId)
        bump(`${c.toNodeId}:${c.toPortId}`);
    }
    return out;
  }, [connections]);

  const handleAddPedal = (pedal: Pedal) => {
    const { xIn, yIn } = centeredOnRig(pedal, rig);
    void addPedalToRig(rig.id, pedal.id, xIn, yIn);
    setLibraryOpen(false);
  };

  // Reset armed port when leaving chain mode. Tracked during render via
  // the prev-prop pattern so the cleared state is in the same commit as
  // the chainMode change (no one-frame flash of a stale armed port).
  const [prevChainMode, setPrevChainMode] = useState(chainMode);
  if (chainMode !== prevChainMode) {
    setPrevChainMode(chainMode);
    if (!chainMode) setArmed(null);
  }

  // Returns a user-facing notice if the port is already at its cable
  // cap, or null if it has room. Per-connector caps live in
  // maxCablesForConnector — TRS carries two signals so two connection
  // records can share one port.
  const portFullReason = (
    port: Port,
    placedId: string,
    portId: string,
  ): string | null => {
    const max = maxCablesForConnector(port.connector);
    const have = cableCountByPort.get(`${placedId}:${portId}`) ?? 0;
    if (have < max) return null;
    return `${port.label} is already full (${max} cable${max === 1 ? '' : 's'} max).`;
  };

  /**
   * Validate a pair of pedal ports and (if compatible) persist a cable.
   * Driven by the port-picker sheet's two-tap flow. Returns true if a
   * connection was created so callers can clear any state (e.g. armed
   * port) on success.
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
    const aFull = portFullReason(aPort, aPlacedId, aPortId);
    if (aFull) {
      setNotice(aFull);
      return false;
    }
    const bFull = portFullReason(bPort, bPlacedId, bPortId);
    if (bFull) {
      setNotice(bFull);
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

  // Reports whether adding one more cable to (placedId, portId) would
  // saturate it. Drives the "stay armed for the next cable" decision so
  // a stereo TRS can be wired to two destinations without re-tapping the
  // source pedal between cables.
  const sourcePortFullAfterAdd = (
    placedId: string,
    portId: string,
  ): boolean => {
    const owner = placed.find((p) => p.id === placedId);
    const port = owner
      ? pedalsById.get(owner.pedalId)?.ports.find((p) => p.id === portId)
      : null;
    if (!port) return true;
    const max = maxCablesForConnector(port.connector);
    const have = cableCountByPort.get(`${placedId}:${portId}`) ?? 0;
    return have + 1 >= max;
  };

  const handlePortTap = (placedId: string, portId: string) => {
    if (!armed) {
      setArmedPort({ placedId, portId });
      return;
    }
    if (armed.kind === 'endpoint') {
      // Endpoint was armed first; complete the connection through this
      // pedal port. Direction + compatibility are validated inside the
      // helper, which sets a notice on failure.
      const ok = tryConnectEndpointToPort(armed.endpointId, placedId, portId);
      setArmed(null);
      void ok;
      return;
    }
    if (armed.placedId === placedId && armed.portId === portId) {
      setArmedPort(null);
      return;
    }
    const ok = tryConnectPorts(armed.placedId, armed.portId, placedId, portId);
    if (!ok) {
      setArmedPort(null);
      return;
    }
    if (sourcePortFullAfterAdd(armed.placedId, armed.portId)) {
      setArmedPort(null);
    }
  };

  const handleCanvasBackgroundClick = () => {
    if (chainMode && armed) setArmed(null);
  };

  const handleDisconnectPort = (placedId: string, portId: string) => {
    // A TRS port may host two cables (splitter). The picker treats them
    // as one tap target — remove every cable touching this port in one go.
    const targets = connections.filter(
      (c) =>
        (c.fromNodeKind === 'pedal' &&
          c.fromNodeId === placedId &&
          c.fromPortId === portId) ||
        (c.toNodeKind === 'pedal' &&
          c.toNodeId === placedId &&
          c.toPortId === portId),
    );
    for (const t of targets) void removeConnection(rig.id, t.id);
  };

  /**
   * Validate and persist a connection between an external endpoint and
   * a pedal port. Shared by the two entry points: tap pedal-port then
   * endpoint chip, and tap endpoint chip then pedal-port. Returns true
   * on success so callers can decide whether to clear / preserve arm
   * state for chained operations.
   */
  const tryConnectEndpointToPort = (
    endpointId: string,
    placedId: string,
    portId: string,
  ): boolean => {
    const ep = endpoints.find((e) => e.id === endpointId);
    if (!ep) return false;
    const owner = placed.find((p) => p.id === placedId);
    const portDef = owner
      ? pedalsById.get(owner.pedalId)?.ports.find((p) => p.id === portId)
      : null;
    if (!portDef) return false;
    // External endpoints (guitar / amp jacks) are all audio. A
    // MIDI/control pedal port routing to one is meaningless — block +
    // warn. 'custom' endpoints have no declared family so they pass.
    if (ep.kind !== 'custom') {
      const compat = connectionCompatibility(portDef.signalType, 'instrument');
      if (!compat.ok) {
        setNotice(compat.reason);
        return false;
      }
    }
    const portFull = portFullReason(portDef, placedId, portId);
    if (portFull) {
      setNotice(portFull);
      return false;
    }
    const endpointIsSource = isEndpointSource(ep.kind);
    // Reject backwards cables (two sources, or two sinks). The picker
    // sheet already disables the matching rows for the endpoint-first
    // flow, but tapping a chip directly while a port is armed skips
    // that filter — we have to enforce direction here too.
    const portIsOutput = isOutputRole(portDef.role);
    if (portIsOutput === endpointIsSource) {
      setNotice(
        endpointIsSource
          ? `${portDef.label} is an output — pick an input to connect from ${ep.label}`
          : `${portDef.label} is an input — pick an output to connect to ${ep.label}`,
      );
      return false;
    }
    void addConnection({
      rigId: rig.id,
      fromNodeKind: endpointIsSource ? 'external' : 'pedal',
      fromNodeId: endpointIsSource ? ep.id : placedId,
      fromPortId: endpointIsSource ? null : portId,
      toNodeKind: endpointIsSource ? 'pedal' : 'external',
      toNodeId: endpointIsSource ? placedId : ep.id,
      toPortId: endpointIsSource ? portId : null,
    });
    return true;
  };

  const handleEndpointTap = (endpointId: string) => {
    // First tap with nothing armed:
    //   - If this endpoint already has 1+ cables, open the actions sheet
    //     so the user can disconnect them — same affordance as tapping a
    //     pedal opens its port picker, which shows disconnect rows for
    //     saturated ports. The sheet also exposes a "start a new
    //     connection" action that arms the endpoint.
    //   - If it has no cables yet, arm it immediately. (No useful actions
    //     to surface in the sheet otherwise.)
    if (!armed) {
      const connectedCount = connections.filter(
        (c) =>
          (c.fromNodeKind === 'external' && c.fromNodeId === endpointId) ||
          (c.toNodeKind === 'external' && c.toNodeId === endpointId),
      ).length;
      if (connectedCount > 0) {
        setEndpointActionsFor(endpointId);
      } else {
        setArmed({ kind: 'endpoint', endpointId });
      }
      return;
    }
    // Tap the already-armed endpoint again to cancel.
    if (armed.kind === 'endpoint' && armed.endpointId === endpointId) {
      setArmed(null);
      return;
    }
    // Tap a different endpoint while one is armed → switch arm.
    // Endpoint-to-endpoint connections aren't a thing in this app.
    if (armed.kind === 'endpoint') {
      setArmed({ kind: 'endpoint', endpointId });
      return;
    }
    // Pedal-port armed first → complete via the shared helper. Preserve
    // arm state when the source port still has capacity (TRS splitter).
    const ok = tryConnectEndpointToPort(
      endpointId,
      armed.placedId,
      armed.portId,
    );
    if (!ok) {
      setArmedPort(null);
      return;
    }
    if (sourcePortFullAfterAdd(armed.placedId, armed.portId)) {
      setArmedPort(null);
    }
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

  const handleEdit = () => {
    if (!targetPedal) return;
    setEditReturnTo('canvas');
    setEditingPedal(targetPedal);
    closeActions();
  };

  const handleRemove = () => {
    if (!actionsFor) return;
    void removeAction(actionsFor);
    closeActions();
  };

  const handleShare = () => {
    if (sharing) return;
    setSharing(true);
    void (async () => {
      try {
        const [{ composeRigSnapshot }, { shareOrSaveBinaryFile }] =
          await Promise.all([
            import('../../lib/rigSnapshot'),
            import('../../lib/fileDownload'),
          ]);
        const { blob, mimeType, fileExtension } = await composeRigSnapshot({
          rig,
          placed,
          pedalsById,
          connections,
          endpoints,
          floorStyle,
          customFloor,
          chainMode,
        });
        const stem =
          rig.name
            .trim()
            .replace(/[/\\:*?"<>|]/g, '')
            .replace(/\s+/g, '-')
            .replace(/^-+|-+$/g, '') || 'rig';
        // Include time-of-day (down to ms) in the filename so back-to-back
        // shares of the same rig produce distinct paths. Receiving apps
        // (Messages, Gmail, etc.) cache thumbnails keyed by the
        // FileProvider content URI; reusing `rig-2026-06-12.webp` makes
        // the second share render a stale preview from the first even
        // though the file content is fresh. Use locale-consistent date +
        // time components (don't mix `toISOString` UTC date with
        // `toTimeString` local clock — they disagree near midnight).
        const now = new Date();
        const pad2 = (n: number) => String(n).padStart(2, '0');
        const date = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
        const time = `${pad2(now.getHours())}${pad2(now.getMinutes())}${pad2(now.getSeconds())}${String(now.getMilliseconds()).padStart(3, '0')}`;
        const result = await shareOrSaveBinaryFile({
          suggestedFilename: `${stem}-${date}-${time}.${fileExtension}`,
          blob,
          mimeType,
          shareTitle: rig.name,
          shareText: `${rig.name} — from Rig Planner`,
          filters: [
            {
              name: `${fileExtension.toUpperCase()} image`,
              extensions: [fileExtension],
            },
          ],
        });
        if (!result.cancelled) setNotice('Rig image ready to share.');
      } catch (err) {
        setNotice(
          err instanceof Error
            ? `Share failed: ${err.message}`
            : 'Share failed.',
        );
      } finally {
        setSharing(false);
      }
    })();
  };

  const showLoadingOverlay = pedalsStatus === 'loading' || !pedalImagesReady;

  return (
    <div className={styles.screen}>
      {notice ? (
        <div className={styles.notice} role="status">
          {notice}
        </div>
      ) : null}
      {showLoadingOverlay ? <SpinnerOverlay label="Loading pedals…" /> : null}
      <CanvasArea
        rig={rig}
        placed={placed}
        pedalsById={pedalsById}
        floorStyle={floorStyle}
        customFloor={customFloor}
        onDragMove={dragMove}
        onDragCommit={(id) => {
          void commitMove(id);
        }}
        onRequestActions={setActionsFor}
        chainMode={chainMode}
        connections={connections}
        endpoints={endpoints}
        armedPort={armedPort}
        armedEndpointId={armedEndpointId}
        unconnectedRequired={unconnectedRequired}
        onPedalTap={setPickerFor}
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
            aria-label="Share rig as image"
            onClick={handleShare}
            disabled={sharing}
          >
            <i
              className={sharing ? 'ti ti-loader-2' : 'ti ti-share'}
              aria-hidden
            />
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
          icon={<i className="ti ti-pencil" aria-hidden />}
          label="Edit pedal"
          onClick={handleEdit}
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
        const armedSource: ArmedSource | null = (() => {
          if (!armed) return null;
          if (armed.kind === 'port') {
            const ow = placed.find((p) => p.id === armed.placedId);
            if (!ow) return null;
            const def = pedalsById.get(ow.pedalId);
            if (!def) return null;
            const port = def.ports.find((p) => p.id === armed.portId);
            if (!port) return null;
            return { kind: 'port', placedId: ow.id, pedal: def, port };
          }
          const ep = endpoints.find((e) => e.id === armed.endpointId);
          if (!ep) return null;
          const isSource = ep.kind === 'guitar' || ep.kind === 'amp_fx_send';
          return { kind: 'endpoint', endpoint: ep, isSource };
        })();
        return (
          <PortPickerSheet
            open={pickerFor !== null}
            placed={placedForPicker}
            pedal={pedalForPicker}
            armedSource={armedSource}
            cableCountByPort={cableCountByPort}
            onClose={() => setPickerFor(null)}
            onPickPort={(placedId, portId) => {
              handlePortTap(placedId, portId);
              setPickerFor(null);
            }}
            onDisconnectPort={(placedId, portId) => {
              handleDisconnectPort(placedId, portId);
              setPickerFor(null);
            }}
          />
        );
      })()}

      {(() => {
        const ep = endpointActionsFor
          ? (endpoints.find((e) => e.id === endpointActionsFor) ?? null)
          : null;
        const cables: EndpointCable[] = ep
          ? connections.flatMap((c) => {
              const epIsFrom =
                c.fromNodeKind === 'external' && c.fromNodeId === ep.id;
              const epIsTo =
                c.toNodeKind === 'external' && c.toNodeId === ep.id;
              if (!epIsFrom && !epIsTo) return [];
              const placedId = epIsFrom ? c.toNodeId : c.fromNodeId;
              const portId = epIsFrom ? c.toPortId : c.fromPortId;
              if (!portId) return [];
              const pl = placed.find((p) => p.id === placedId);
              const def = pl ? pedalsById.get(pl.pedalId) : null;
              const port = def?.ports.find((p) => p.id === portId);
              if (!pl || !def || !port) return [];
              return [
                {
                  connectionId: c.id,
                  pedal: def,
                  placed: pl,
                  port,
                },
              ];
            })
          : [];
        const isSource = ep
          ? ep.kind === 'guitar' || ep.kind === 'amp_fx_send'
          : false;
        return (
          <EndpointActionsSheet
            open={ep !== null}
            endpoint={ep}
            isSource={isSource}
            cables={cables}
            onClose={() => setEndpointActionsFor(null)}
            onArm={(endpointId) => {
              setArmed({ kind: 'endpoint', endpointId });
              setEndpointActionsFor(null);
            }}
            onDisconnect={(connectionId) => {
              void removeConnection(rig.id, connectionId);
              setEndpointActionsFor(null);
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
          setEditReturnTo('library');
          setEditingPedal(pedal);
        }}
      />

      <SettingsSheet
        open={settingsOpen}
        rig={rig}
        placedCount={placed.length}
        floorStyle={floorStyle}
        customFloor={customFloor}
        endpoints={endpoints}
        onClose={() => setSettingsOpen(false)}
        onRename={(name) => renameRig(rig.id, name)}
        onChangeFloor={changeFloor}
        onChangeCustomFloor={changeCustomFloor}
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
        onChangeJackSize={(jackSize) => updateJackSize(rig.id, jackSize)}
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
            // Return to wherever the edit was launched from.
            if (editingPedal && editReturnTo === 'library') {
              setLibraryOpen(true);
            }
          }}
          onCreated={(pedal) => {
            if (editingPedal) {
              // Edit flow: no auto-add, the pedal is already placed in
              // some rig(s). Stores reload themselves inside updatePedal.
              setEditingPedal(null);
              if (editReturnTo === 'library') setLibraryOpen(true);
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
  customFloor: CustomFloor;
  onDragMove: (placedId: string, xIn: number, yIn: number) => void;
  onDragCommit: (placedId: string) => void;
  onRequestActions: (placedId: string) => void;
  chainMode: boolean;
  connections: Connection[];
  endpoints: ExternalEndpoint[];
  armedPort: { placedId: string; portId: string } | null;
  armedEndpointId: string | null;
  unconnectedRequired: Set<string>;
  onPedalTap: (placedId: string) => void;
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
  customFloor,
  onDragMove,
  onDragCommit,
  onRequestActions,
  chainMode,
  connections,
  endpoints,
  armedPort,
  armedEndpointId,
  unconnectedRequired,
  onPedalTap,
  onEndpointTap,
  onBackgroundTap,
  children,
}: CanvasAreaProps) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const boardRef = useRef<BoardCanvasHandle | null>(null);
  const [pxPerInch, setPxPerInch] = useState(18);
  const [belowBoardSpacePx, setBelowBoardSpacePx] = useState(92);
  const [chipStripHeight, setChipStripHeight] = useState(0);
  const { viewport, pointerHandlers, attachWheel, reset, setScale } =
    useViewport({
      onPinchStart: () => boardRef.current?.cancelActiveDrag(),
    });

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const fit = () => {
      // Reserve enough space on each side that the board's edges always
      // clear the corner FABs at the default centered/unzoomed view —
      // i.e. the board "dodges" the floating buttons. Bottom FABs are
      // 88px tall, so 92 covers them with a bit of breathing room. When
      // chain mode is on, the chip strip sits above the board and may
      // wrap to multiple rows; use the larger of (FAB reserve, measured
      // strip height + clearance) so chips always fit above the board
      // without overlapping it.
      const fabReserve = 92;
      const chipReserve = chipStripHeight > 0 ? chipStripHeight + 12 : 0;
      const vertReserve = Math.max(fabReserve, chipReserve);
      const sideReserve = 14;
      const availW = el.clientWidth - sideReserve * 2;
      const availH = el.clientHeight - vertReserve * 2;
      if (availW <= 0 || availH <= 0) return;
      const px = Math.min(availW / rig.widthIn, availH / rig.depthIn);
      const clampedPx = Math.max(6, Math.min(80, px));
      setPxPerInch(clampedPx);
      // Actual empty floor below the board at zoom=1. The wrap is
      // flex-centered in canvasArea, so it's (clientHeight - heightPx) / 2.
      // Drives the easter-egg cat's vertical offset (she must sit past
      // this much to stay off-screen at default zoom).
      const heightPx = rig.depthIn * clampedPx;
      setBelowBoardSpacePx(Math.max((el.clientHeight - heightPx) / 2, 0));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [rig.widthIn, rig.depthIn, chipStripHeight]);

  // Track the chain-mode chip strip's height so the canvas reserves
  // enough room above the board to fit it (including any wrapped rows).
  // The strip is rendered by ChainOverlay with a `data-chip-strip`
  // attribute; we query for it inside the wrap and observe its size.
  // Re-attaches when chainMode toggles or the wrap node changes.
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap || !chainMode) {
      setChipStripHeight(0);
      return;
    }
    const findStrip = () =>
      wrap.querySelector<HTMLElement>('[data-chip-strip]');
    const measure = () => {
      const strip = findStrip();
      setChipStripHeight(strip?.offsetHeight ?? 0);
    };
    measure();
    const ro = new ResizeObserver(measure);
    const strip = findStrip();
    if (strip) ro.observe(strip);
    // Watch the wrap for the strip mounting/unmounting as well.
    const mo = new MutationObserver(() => {
      measure();
      const next = findStrip();
      if (next) ro.observe(next);
    });
    mo.observe(wrap, { childList: true, subtree: true });
    return () => {
      ro.disconnect();
      mo.disconnect();
    };
  }, [chainMode]);

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
            : floorStyle === 'sidewalk'
              ? styles.floorSidewalk
              : '';
  const floorInlineStyle: CSSProperties | null =
    floorStyle === 'custom' ? customFloorBackgroundStyle(customFloor) : null;

  return (
    <div
      className={`${styles.canvasArea} ${floorClass}`.trim()}
      {...(floorInlineStyle ? { style: floorInlineStyle } : {})}
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
          ref={boardRef}
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
          armedEndpointId={armedEndpointId}
          unconnectedRequired={unconnectedRequired}
          onPedalTap={onPedalTap}
          onEndpointTap={onEndpointTap}
          bottomReservePx={belowBoardSpacePx}
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
