import { useEffect, useMemo, useRef, useState } from 'react';
import type { Pedal, Rig } from '../../data/schema';
import { usePedalsStore } from '../../stores/pedalsStore';
import { usePlacedPedalsStore } from '../../stores/placedPedalsStore';
import { useRigsStore } from '../../stores/rigsStore';
import { findExistingRigForImport, importRig } from '../../data/rigImportRepo';
import { parseRigExport, type RigExport } from '../../lib/rigPortability';
import { RigThumb } from '../../canvas/RigThumb';
import { AddPedalWizard } from '../add-pedal/AddPedalWizard';
import { PedalLibrarySheet } from '../rig/PedalLibrarySheet';
import { useSignalChainStore } from '../../stores/signalChainStore';
import { Button, Sheet, SheetItem, TextField } from '../../ui';
import styles from './RigList.module.css';

const EMPTY_PLACED: never[] = [];

interface RigListProps {
  onOpenRig: (rig: Rig) => void;
  onCreateRig: () => void;
}

export function RigList({ onOpenRig, onCreateRig }: RigListProps) {
  const rigs = useRigsStore((s) => s.rigs);
  const status = useRigsStore((s) => s.status);
  const loadRigs = useRigsStore((s) => s.loadRigs);
  const pedals = usePedalsStore((s) => s.pedals);
  const pedalsStatus = usePedalsStore((s) => s.status);
  const loadPedals = usePedalsStore((s) => s.loadPedals);
  const seedSamples = usePedalsStore((s) => s.seedSamples);
  const loadPlacedForRig = usePlacedPedalsStore((s) => s.loadForRig);
  const loadSignalChain = useSignalChainStore((s) => s.loadForRig);

  const [libraryOpen, setLibraryOpen] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [editingPedal, setEditingPedal] = useState<Pedal | null>(null);

  const importInputRef = useRef<HTMLInputElement | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [pendingImport, setPendingImport] = useState<{
    exp: RigExport;
    collisionWith: string | null;
  } | null>(null);

  const handleImportFilePicked = (file: File) => {
    setImportError(null);
    void (async () => {
      try {
        const text = await file.text();
        const exp = parseRigExport(text);
        const existing = await findExistingRigForImport(exp);
        setPendingImport({ exp, collisionWith: existing?.name ?? null });
      } catch (err) {
        setImportError(
          err instanceof Error
            ? `Import failed: ${err.message}`
            : `Import failed: ${String(err)}`,
        );
      }
    })();
  };

  const handleConfirmImport = () => {
    if (!pendingImport) return;
    setImportError(null);
    setImporting(true);
    const { exp } = pendingImport;
    void (async () => {
      try {
        await importRig(exp);
        // Reload everything the just-imported rig touches so the card
        // thumbnail draws correctly and the user can jump straight in.
        await Promise.all([loadPedals(), loadRigs()]);
        await Promise.all([
          loadPlacedForRig(exp.rig.id),
          loadSignalChain(exp.rig.id),
        ]);
        setPendingImport(null);
        setImporting(false);
        onOpenRig({ ...exp.rig });
      } catch (err) {
        setImportError(
          err instanceof Error
            ? `Import failed: ${err.message}`
            : `Import failed: ${String(err)}`,
        );
        setImporting(false);
      }
    })();
  };

  // Need the pedal definitions to render thumbnail rectangles at the right
  // size; load them once when the rig list mounts (idempotent).
  useEffect(() => {
    if (pedalsStatus === 'idle') void loadPedals();
  }, [pedalsStatus, loadPedals]);

  const pedalsById = useMemo(() => {
    const m = new Map<string, Pedal>();
    for (const p of pedals) m.set(p.id, p);
    return m;
  }, [pedals]);

  return (
    <div className={styles.screen}>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <i className="ti ti-circuit-board" aria-hidden />
          <span className={styles.brand}>Rig Planner</span>
        </div>
      </header>
      <main className={styles.body}>
        <h1 className={styles.title}>Your Rigs</h1>
        {status === 'loading' && <p className={styles.empty}>Loading rigs…</p>}
        {status === 'ready' && (
          <ul className={styles.grid}>
            {rigs.map((rig) => (
              <RigCard
                key={rig.id}
                rig={rig}
                pedalsById={pedalsById}
                onOpen={() => onOpenRig(rig)}
              />
            ))}
            <li>
              <button
                type="button"
                className={styles.newRigCard}
                onClick={onCreateRig}
              >
                <span className={styles.newRigThumb} aria-hidden>
                  <i className="ti ti-plus" />
                </span>
                <div className={styles.newRigMeta}>
                  <div className={styles.newRigName}>
                    {rigs.length === 0 ? 'Create your first rig' : 'New rig'}
                  </div>
                  <div className={styles.newRigSub}>
                    Pick a board, name it, place pedals
                  </div>
                </div>
              </button>
            </li>
          </ul>
        )}
        {status === 'ready' ? (
          <div className={styles.footerActions}>
            <button
              type="button"
              className={styles.collectionLink}
              onClick={() => setLibraryOpen(true)}
            >
              <i className="ti ti-list-details" aria-hidden /> Your pedal
              collection ({pedals.length})
            </button>
            <button
              type="button"
              className={styles.collectionLink}
              onClick={() => importInputRef.current?.click()}
            >
              <i className="ti ti-upload" aria-hidden /> Import rig
            </button>
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
        ) : null}
        {importError ? (
          <p className={styles.importError} role="alert">
            {importError}
          </p>
        ) : null}
      </main>

      <Sheet
        open={pendingImport !== null}
        onClose={() => {
          if (importing) return;
          setPendingImport(null);
          setImportError(null);
        }}
        title="Import Rig?"
      >
        <div className={styles.dialogBody}>
          {pendingImport ? (
            <>
              <p className={styles.muted}>
                Import <strong>{pendingImport.exp.rig.name}</strong>?
              </p>
              <p className={styles.muted}>
                {pendingImport.exp.placedPedals.length} placed pedal
                {pendingImport.exp.placedPedals.length === 1 ? '' : 's'},{' '}
                {pendingImport.exp.connections.length} connection
                {pendingImport.exp.connections.length === 1 ? '' : 's'},
                exported {pendingImport.exp.exportedAt.slice(0, 10)}.
              </p>
              {pendingImport.collisionWith !== null ? (
                <p className={styles.importWarn}>
                  <i className="ti ti-alert-triangle" aria-hidden /> A rig with
                  this ID already exists as{' '}
                  <strong>{pendingImport.collisionWith}</strong>. Importing will
                  overwrite it — its placements, connections, and endpoints will
                  be replaced.
                </p>
              ) : null}
              {importError ? (
                <p className={styles.importError}>{importError}</p>
              ) : null}
              <div className={styles.dialogActions}>
                <Button
                  variant="ghost"
                  onClick={() => {
                    setPendingImport(null);
                    setImportError(null);
                  }}
                  disabled={importing}
                >
                  Cancel
                </Button>
                <Button onClick={handleConfirmImport} disabled={importing}>
                  {importing
                    ? 'Importing…'
                    : pendingImport.collisionWith !== null
                      ? 'Overwrite'
                      : 'Import'}
                </Button>
              </div>
            </>
          ) : null}
        </div>
      </Sheet>

      <PedalLibrarySheet
        open={libraryOpen}
        pedals={pedals}
        mode="manage"
        onClose={() => setLibraryOpen(false)}
        onAddPedal={() => {
          // No active rig from this entry point — taps open the actions
          // sheet via `mode="manage"` rather than calling onAddPedal.
        }}
        onStartNewPedal={() => {
          setLibraryOpen(false);
          setWizardOpen(true);
        }}
        onStartEditPedal={(pedal) => {
          setLibraryOpen(false);
          setEditingPedal(pedal);
        }}
        onSeed={async () => {
          await seedSamples();
        }}
      />

      {wizardOpen || editingPedal ? (
        <AddPedalWizard
          {...(editingPedal ? { initialPedal: editingPedal } : {})}
          onCancel={() => {
            setWizardOpen(false);
            setEditingPedal(null);
            setLibraryOpen(true);
          }}
          onCreated={() => {
            setWizardOpen(false);
            setEditingPedal(null);
            // Pop back into the collection sheet so the user can see the
            // pedal they just added (or edited) land in the list.
            setLibraryOpen(true);
          }}
        />
      ) : null}
    </div>
  );
}

interface RigCardProps {
  rig: Rig;
  pedalsById: Map<string, Pedal>;
  onOpen: () => void;
}

function RigCard({ rig, pedalsById, onOpen }: RigCardProps) {
  const [actionsOpen, setActionsOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(rig.name);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const renameRig = useRigsStore((s) => s.renameRig);
  const duplicateRig = useRigsStore((s) => s.duplicateRig);
  const deleteRig = useRigsStore((s) => s.deleteRig);

  const placed = usePlacedPedalsStore((s) => s.byRig[rig.id] ?? EMPTY_PLACED);
  const loadForRig = usePlacedPedalsStore((s) => s.loadForRig);

  // Pull this rig's placements so the thumbnail can render them. The store
  // dedupes; no harm if multiple cards load the same rig in parallel.
  useEffect(() => {
    void loadForRig(rig.id);
  }, [rig.id, loadForRig]);

  let holdTimer: ReturnType<typeof setTimeout> | null = null;

  function startHold() {
    holdTimer = setTimeout(() => {
      setActionsOpen(true);
      holdTimer = null;
    }, 450);
  }

  function clearHold() {
    if (holdTimer) {
      clearTimeout(holdTimer);
      holdTimer = null;
    }
  }

  function handleRenameSubmit() {
    const v = renameValue.trim();
    if (!v) return;
    void renameRig(rig.id, v).then(() => setRenaming(false));
  }

  function handleDuplicate() {
    setActionsOpen(false);
    void duplicateRig(rig.id);
  }

  function handleDelete() {
    setConfirmDelete(false);
    void deleteRig(rig.id);
  }

  return (
    <li>
      <button
        type="button"
        className={styles.card}
        onClick={onOpen}
        onContextMenu={(e) => {
          e.preventDefault();
          setActionsOpen(true);
        }}
        onMouseDown={startHold}
        onMouseUp={clearHold}
        onMouseLeave={clearHold}
        onTouchStart={startHold}
        onTouchEnd={clearHold}
        onTouchCancel={clearHold}
      >
        <div className={styles.thumbWrap}>
          <RigThumb
            rig={rig}
            placed={placed}
            pedalsById={pedalsById}
            width={140}
            height={Math.max(40, Math.round((rig.depthIn / rig.widthIn) * 140))}
            title={`${rig.name} thumbnail`}
          />
        </div>
        <div className={styles.meta}>
          <div className={styles.name}>{rig.name}</div>
          <div className={styles.dims}>
            {rig.widthIn}&quot; × {rig.depthIn}&quot;
          </div>
        </div>
        <span
          className={styles.moreBtn}
          role="button"
          aria-label="Rig actions"
          onClick={(e) => {
            e.stopPropagation();
            setActionsOpen(true);
          }}
        >
          <i className="ti ti-dots" aria-hidden />
        </span>
      </button>

      <Sheet
        open={actionsOpen}
        onClose={() => setActionsOpen(false)}
        title={rig.name}
      >
        <SheetItem
          icon={<i className="ti ti-pencil" aria-hidden />}
          label="Rename"
          onClick={() => {
            setActionsOpen(false);
            setRenameValue(rig.name);
            setRenaming(true);
          }}
        />
        <SheetItem
          icon={<i className="ti ti-copy" aria-hidden />}
          label="Duplicate"
          onClick={handleDuplicate}
        />
        <SheetItem
          icon={<i className="ti ti-trash" aria-hidden />}
          label="Delete"
          destructive
          onClick={() => {
            setActionsOpen(false);
            setConfirmDelete(true);
          }}
        />
      </Sheet>

      <Sheet
        open={renaming}
        onClose={() => setRenaming(false)}
        title="Rename Rig"
      >
        <div className={styles.dialogBody}>
          <TextField
            inputSize="md"
            value={renameValue}
            autoFocus
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleRenameSubmit();
            }}
          />
          <div className={styles.dialogActions}>
            <Button variant="ghost" onClick={() => setRenaming(false)}>
              Cancel
            </Button>
            <Button disabled={!renameValue.trim()} onClick={handleRenameSubmit}>
              Save
            </Button>
          </div>
        </div>
      </Sheet>

      <Sheet
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="Delete Rig?"
      >
        <div className={styles.dialogBody}>
          <p className={styles.muted}>
            Permanently delete &ldquo;{rig.name}&rdquo;? This cannot be undone.
          </p>
          <div className={styles.dialogActions}>
            <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={handleDelete}>
              Delete
            </Button>
          </div>
        </div>
      </Sheet>
    </li>
  );
}
