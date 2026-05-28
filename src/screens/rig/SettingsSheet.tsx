import { useEffect, useRef, useState } from 'react';
import type {
  BoardStyle,
  ExternalEndpoint,
  ExternalEndpointKind,
  Rig,
} from '../../data/schema';
import { findExistingRigForImport, importRig } from '../../data/rigImportRepo';
import { BoardThumb } from '../../canvas/BoardThumb';
import { BoardPicker } from '../../components/BoardPicker';
import {
  initialPickerStateFor,
  resolveBoardChoice,
  type BoardSelection,
} from '../../components/boardPickerHelpers';
import { FLOOR_STYLES, type FloorStyle } from '../../lib/floorStyle';
import { parseRigExport, type RigExport } from '../../lib/rigPortability';
import { Button, Sheet, TextField } from '../../ui';
import styles from './SettingsSheet.module.css';

interface SettingsSheetProps {
  open: boolean;
  rig: Rig;
  placedCount: number;
  floorStyle: FloorStyle;
  endpoints: ExternalEndpoint[];
  onClose: () => void;
  onRename: (name: string) => Promise<void>;
  onChangeBoard: (
    widthIn: number,
    depthIn: number,
    style: BoardStyle,
  ) => Promise<void>;
  onChangeFloor: (style: FloorStyle) => void;
  onAddEndpoint: (kind: ExternalEndpointKind, label: string) => Promise<void>;
  onRemoveEndpoint: (endpointId: string) => Promise<void>;
  onDelete: () => Promise<void>;
  /** Build the export JSON and hand it back. The sheet triggers the download. */
  onExport: () => Promise<{ filename: string; json: string }>;
  /**
   * Reload stores + (if needed) navigate after a successful import.
   */
  onImported: (rigId: string) => void | Promise<void>;
}

const ENDPOINT_KIND_LABELS: Record<ExternalEndpointKind, string> = {
  guitar: 'Instrument',
  amp_in: 'Amp input',
  amp_fx_send: 'FX send',
  amp_fx_return: 'FX return',
  custom: 'Custom',
};

/**
 * Settings sheet for the active rig.
 *
 * Two views:
 *   1. "main"  — name input + a board summary card with a "Change" button.
 *   2. "board" — full BoardPicker (preset cards + custom) for swapping the
 *                board atomically.
 * Apply commits any pending changes (name and/or board) together.
 */
export function SettingsSheet({
  open,
  rig,
  placedCount,
  floorStyle,
  endpoints,
  onClose,
  onRename,
  onChangeBoard,
  onChangeFloor,
  onAddEndpoint,
  onRemoveEndpoint,
  onDelete,
  onExport,
  onImported,
}: SettingsSheetProps) {
  const [newEndpointKind, setNewEndpointKind] =
    useState<ExternalEndpointKind>('custom');
  const [newEndpointLabel, setNewEndpointLabel] = useState('');
  const [showAddEndpoint, setShowAddEndpoint] = useState(false);

  const handleAddEndpoint = () => {
    const label = newEndpointLabel.trim();
    if (!label) return;
    void (async () => {
      await onAddEndpoint(newEndpointKind, label);
      setNewEndpointLabel('');
      setShowAddEndpoint(false);
    })();
  };
  const [view, setView] = useState<
    'main' | 'board' | 'confirmDelete' | 'confirmImport'
  >('main');
  const [deleting, setDeleting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [pendingImport, setPendingImport] = useState<{
    exp: RigExport;
    collisionWith: string | null;
  } | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const [name, setName] = useState(rig.name);
  const [pickerState, setPickerState] = useState(() =>
    initialPickerStateFor(rig),
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setView('main');
    setDeleting(false);
    setExporting(false);
    setImporting(false);
    setPendingImport(null);
    setName(rig.name);
    setPickerState(
      initialPickerStateFor({
        widthIn: rig.widthIn,
        depthIn: rig.depthIn,
        style: rig.style,
      }),
    );
    setError(null);
  }, [open, rig.name, rig.widthIn, rig.depthIn, rig.style]);

  const pickerChoice = resolveBoardChoice(pickerState);
  const boardChanged =
    pickerChoice !== null &&
    (pickerChoice.widthIn !== rig.widthIn ||
      pickerChoice.depthIn !== rig.depthIn ||
      pickerChoice.style !== rig.style);

  const setSelection = (s: BoardSelection) =>
    setPickerState((p) => ({ ...p, selection: s }));
  const setCustomW = (v: string) =>
    setPickerState((p) => ({ ...p, customW: v }));
  const setCustomD = (v: string) =>
    setPickerState((p) => ({ ...p, customD: v }));
  const setCustomStyle = (s: BoardStyle) =>
    setPickerState((p) => ({ ...p, customStyle: s }));

  const handleApply = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Name cannot be empty');
      return;
    }
    if (view === 'board' && !pickerChoice) {
      setError('Pick a board or enter custom dimensions');
      return;
    }
    setError(null);
    void (async () => {
      setSaving(true);
      try {
        if (trimmed !== rig.name) await onRename(trimmed);
        if (boardChanged && pickerChoice) {
          await onChangeBoard(
            pickerChoice.widthIn,
            pickerChoice.depthIn,
            pickerChoice.style,
          );
        }
        onClose();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setSaving(false);
      }
    })();
  };

  const sheetTitle =
    view === 'main'
      ? 'Rig Settings'
      : view === 'board'
        ? 'Change Board'
        : view === 'confirmImport'
          ? 'Import Rig?'
          : 'Delete Rig?';

  const handleConfirmDelete = () => {
    setError(null);
    void (async () => {
      setDeleting(true);
      try {
        await onDelete();
        // Parent is responsible for navigating away; nothing else to do here.
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setDeleting(false);
      }
    })();
  };

  const handleExport = () => {
    setError(null);
    setExporting(true);
    void (async () => {
      try {
        const { filename, json } = await onExport();
        const { saveTextFile } = await import('../../lib/fileDownload');
        await saveTextFile({
          suggestedFilename: filename,
          text: json,
          // Tauri filter extensions are bare suffixes — multi-dot like
          // "rig.json" doesn't match. The full ".rig.json" suffix is
          // preserved via the defaultPath/suggestedFilename.
          filters: [{ name: 'Rig Planner export', extensions: ['json'] }],
        });
      } catch (err) {
        setError(
          err instanceof Error
            ? `Export failed: ${err.message}`
            : `Export failed: ${String(err)}`,
        );
      } finally {
        setExporting(false);
      }
    })();
  };

  const handleImportFilePicked = (file: File) => {
    setError(null);
    void (async () => {
      try {
        const text = await file.text();
        const exp = parseRigExport(text);
        const existing = await findExistingRigForImport(exp);
        setPendingImport({
          exp,
          collisionWith: existing?.name ?? null,
        });
        setView('confirmImport');
      } catch (err) {
        setError(
          err instanceof Error
            ? `Import failed: ${err.message}`
            : `Import failed: ${String(err)}`,
        );
      }
    })();
  };

  const handleConfirmImport = () => {
    if (!pendingImport) return;
    setError(null);
    setImporting(true);
    const { exp } = pendingImport;
    void (async () => {
      try {
        await importRig(exp);
        await onImported(exp.rig.id);
        setPendingImport(null);
        onClose();
      } catch (err) {
        setError(
          err instanceof Error
            ? `Import failed: ${err.message}`
            : `Import failed: ${String(err)}`,
        );
        setImporting(false);
      }
    })();
  };

  return (
    <Sheet open={open} onClose={onClose} title={sheetTitle}>
      {view === 'main' ? (
        <div className={styles.body}>
          <label className={styles.field}>
            <span className={styles.label}>Name</span>
            <TextField
              inputSize="md"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>

          <div className={styles.field}>
            <span className={styles.label}>Board</span>
            <div className={styles.boardSummary}>
              <div className={styles.boardThumb}>
                <BoardThumb
                  style={pickerChoice?.style ?? rig.style}
                  width={56}
                  height={32}
                  scale={0.2}
                />
              </div>
              <div className={styles.boardInfo}>
                <div className={styles.boardName}>
                  {pickerChoice
                    ? `${pickerChoice.widthIn}" × ${pickerChoice.depthIn}"`
                    : `${rig.widthIn}" × ${rig.depthIn}"`}
                </div>
                <div className={styles.boardStyle}>
                  {(pickerChoice?.style ?? rig.style).charAt(0).toUpperCase() +
                    (pickerChoice?.style ?? rig.style).slice(1)}
                  {boardChanged ? (
                    <span className={styles.changedTag}>· unsaved</span>
                  ) : null}
                </div>
              </div>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setView('board')}
              >
                Change
              </Button>
            </div>
          </div>

          <div className={styles.field}>
            <span className={styles.label}>Inputs &amp; Outputs</span>
            <ul className={styles.endpointList}>
              {endpoints.map((ep) => (
                <li key={ep.id} className={styles.endpointRow}>
                  <span className={styles.endpointKind}>
                    {ENDPOINT_KIND_LABELS[ep.kind]}
                  </span>
                  <span className={styles.endpointLabel}>{ep.label}</span>
                  <button
                    type="button"
                    className={styles.endpointRemove}
                    aria-label={`Remove ${ep.label}`}
                    onClick={() => void onRemoveEndpoint(ep.id)}
                  >
                    <i className="ti ti-x" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
            {showAddEndpoint ? (
              <div className={styles.endpointAddRow}>
                <select
                  className={styles.endpointSelect}
                  value={newEndpointKind}
                  onChange={(e) =>
                    setNewEndpointKind(e.target.value as ExternalEndpointKind)
                  }
                >
                  <option value="guitar">Instrument</option>
                  <option value="amp_in">Amp input</option>
                  <option value="amp_fx_send">FX send</option>
                  <option value="amp_fx_return">FX return</option>
                  <option value="custom">Custom</option>
                </select>
                <TextField
                  inputSize="md"
                  placeholder="Label"
                  value={newEndpointLabel}
                  onChange={(e) => setNewEndpointLabel(e.target.value)}
                />
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setShowAddEndpoint(false);
                    setNewEndpointLabel('');
                  }}
                >
                  Cancel
                </Button>
                <Button size="sm" onClick={handleAddEndpoint}>
                  Add
                </Button>
              </div>
            ) : (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setShowAddEndpoint(true)}
              >
                <i className="ti ti-plus" aria-hidden /> Add input or output
              </Button>
            )}
          </div>

          <div className={styles.field}>
            <span className={styles.label}>Floor</span>
            <div className={styles.floorChips} role="radiogroup">
              {FLOOR_STYLES.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  role="radio"
                  aria-checked={floorStyle === f.id}
                  className={`${styles.floorChip} ${styles[`floorSwatch_${f.id}`] ?? ''} ${
                    floorStyle === f.id ? styles.floorChipActive : ''
                  }`}
                  onClick={() => onChangeFloor(f.id)}
                >
                  <span className={styles.floorSwatch} aria-hidden />
                  <span className={styles.floorChipLabel}>{f.label}</span>
                </button>
              ))}
            </div>
          </div>

          <div className={styles.field}>
            <span className={styles.label}>Backup &amp; Share</span>
            <div className={styles.backupRow}>
              <Button
                variant="secondary"
                size="sm"
                onClick={handleExport}
                disabled={exporting}
              >
                <i className="ti ti-download" aria-hidden />{' '}
                {exporting ? 'Exporting…' : 'Export rig'}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => importInputRef.current?.click()}
              >
                <i className="ti ti-upload" aria-hidden /> Import rig
              </Button>
              <input
                ref={importInputRef}
                type="file"
                accept=".json,.rig.json,application/json"
                style={{ display: 'none' }}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  // Reset so the same file can be picked again later.
                  e.target.value = '';
                  if (file) handleImportFilePicked(file);
                }}
              />
            </div>
            <p className={styles.backupHint}>
              Exports a single <code>.rig.json</code> file containing this rig
              and the pedals it places. Importing a file with the same rig ID
              will overwrite this rig.
            </p>
          </div>

          {error ? <p className={styles.error}>{error}</p> : null}

          <div className={styles.actions}>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={handleApply} disabled={saving}>
              {saving ? 'Saving…' : 'Apply'}
            </Button>
          </div>

          <div className={styles.dangerZone}>
            <button
              type="button"
              className={styles.deleteRigBtn}
              onClick={() => setView('confirmDelete')}
            >
              <i className="ti ti-trash" aria-hidden /> Delete Rig
            </button>
          </div>
        </div>
      ) : view === 'board' ? (
        <div className={styles.pickerBody}>
          <BoardPicker
            selection={pickerState.selection}
            customW={pickerState.customW}
            customD={pickerState.customD}
            customStyle={pickerState.customStyle}
            onSelect={setSelection}
            onCustomW={setCustomW}
            onCustomD={setCustomD}
            onCustomStyle={setCustomStyle}
          />
          <div className={styles.actions}>
            <Button variant="ghost" onClick={() => setView('main')}>
              Back
            </Button>
            <Button disabled={!pickerChoice} onClick={() => setView('main')}>
              Use this board
            </Button>
          </div>
        </div>
      ) : view === 'confirmDelete' ? (
        <div className={styles.body}>
          <p className={styles.confirmText}>
            Permanently delete <strong>{rig.name}</strong>?
          </p>
          {placedCount > 0 ? (
            <p className={styles.confirmWarn}>
              <i className="ti ti-alert-triangle" aria-hidden /> This rig has{' '}
              {placedCount} placed pedal
              {placedCount === 1 ? '' : 's'} and their signal-chain connections.
              Those will be removed too. Pedals stay in your collection.
            </p>
          ) : null}
          {error ? <p className={styles.error}>{error}</p> : null}
          <div className={styles.actions}>
            <Button
              variant="ghost"
              onClick={() => setView('main')}
              disabled={deleting}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={handleConfirmDelete}
              disabled={deleting}
            >
              {deleting ? 'Deleting…' : 'Delete Rig'}
            </Button>
          </div>
        </div>
      ) : (
        <div className={styles.body}>
          {pendingImport ? (
            <>
              <p className={styles.confirmText}>
                Import <strong>{pendingImport.exp.rig.name}</strong>?
              </p>
              <p className={styles.backupHint}>
                {pendingImport.exp.placedPedals.length} placed pedal
                {pendingImport.exp.placedPedals.length === 1 ? '' : 's'},{' '}
                {pendingImport.exp.connections.length} connection
                {pendingImport.exp.connections.length === 1 ? '' : 's'},
                exported {pendingImport.exp.exportedAt.slice(0, 10)}.
              </p>
              {pendingImport.collisionWith !== null ? (
                <p className={styles.confirmWarn}>
                  <i className="ti ti-alert-triangle" aria-hidden /> A rig with
                  this ID already exists as{' '}
                  <strong>{pendingImport.collisionWith}</strong>. Importing will
                  overwrite it — its placements, connections, and endpoints will
                  be replaced.
                </p>
              ) : null}
            </>
          ) : null}
          {error ? <p className={styles.error}>{error}</p> : null}
          <div className={styles.actions}>
            <Button
              variant="ghost"
              onClick={() => {
                setPendingImport(null);
                setView('main');
              }}
              disabled={importing}
            >
              Cancel
            </Button>
            <Button onClick={handleConfirmImport} disabled={importing}>
              {importing
                ? 'Importing…'
                : pendingImport?.collisionWith !== null
                  ? 'Overwrite'
                  : 'Import'}
            </Button>
          </div>
        </div>
      )}
    </Sheet>
  );
}
