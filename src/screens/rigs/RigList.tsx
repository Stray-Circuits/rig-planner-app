import { useEffect, useMemo, useRef, useState } from 'react';
import type { Pedal, Rig } from '../../data/schema';
import { usePedalsStore } from '../../stores/pedalsStore';
import { usePlacedPedalsStore } from '../../stores/placedPedalsStore';
import { useRigsStore } from '../../stores/rigsStore';
import { findExistingRigForImport, importRig } from '../../data/rigImportRepo';
import { parseRigExport, type RigExport } from '../../lib/rigPortability';
import { openTextFile } from '../../lib/fileDownload';
import { RigThumb } from '../../canvas/RigThumb';
import { AddPedalWizard } from '../add-pedal/AddPedalWizard';
import { PedalLibrarySheet } from '../rig/PedalLibrarySheet';
import { useSignalChainStore } from '../../stores/signalChainStore';
import {
  Button,
  Sheet,
  SheetItem,
  SpinnerOverlay,
  TextField,
  Toast,
} from '../../ui';
import scBadgeUrl from '../../assets/brand/StrayCircuits-icon-only.svg';
import catSilhouetteUrl from '../../assets/brand/cat-silhouette.svg';
import styles from './RigList.module.css';

const EMPTY_PLACED: never[] = [];

interface RigListProps {
  onOpenRig: (rig: Rig) => void;
  onCreateRig: () => void;
  onOpenAbout?: () => void;
}

export function RigList({ onOpenRig, onCreateRig, onOpenAbout }: RigListProps) {
  const rigs = useRigsStore((s) => s.rigs);
  const status = useRigsStore((s) => s.status);
  const loadRigs = useRigsStore((s) => s.loadRigs);
  const pedals = usePedalsStore((s) => s.pedals);
  const pedalsStatus = usePedalsStore((s) => s.status);
  const pedalImagesReady = usePedalsStore((s) => s.imagesReady);
  const loadPedals = usePedalsStore((s) => s.loadPedals);
  const loadPlacedForRig = usePlacedPedalsStore((s) => s.loadForRig);
  const loadSignalChain = useSignalChainStore((s) => s.loadForRig);

  const [libraryOpen, setLibraryOpen] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [editingPedal, setEditingPedal] = useState<Pedal | null>(null);

  const importInputRef = useRef<HTMLInputElement | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  // Cat-silhouette easter egg: count taps within a single visit, fire a
  // toast at 5 / 20 / 100, then reset after the discount fires.
  const catTapsRef = useRef(0);
  const [catToast, setCatToast] = useState<{
    key: number;
    message: string;
    duration: number;
  } | null>(null);

  const handleCatTap = () => {
    catTapsRef.current += 1;
    const n = catTapsRef.current;
    if (n === 5) {
      setCatToast({ key: Date.now(), message: 'mew', duration: 2000 });
    } else if (n === 20) {
      setCatToast({ key: Date.now(), message: 'prrrrrrr', duration: 2500 });
    } else if (n === 100) {
      setCatToast({
        key: Date.now(),
        message: 'Meow! Discount code: allthepets',
        duration: 5000,
      });
      catTapsRef.current = 0;
    }
  };

  const [importing, setImporting] = useState(false);
  const [pendingImport, setPendingImport] = useState<{
    exp: RigExport;
    collisionWith: string | null;
  } | null>(null);

  const handleImportText = async (text: string) => {
    try {
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
  };

  const triggerImport = () => {
    setImportError(null);
    void (async () => {
      try {
        const result = await openTextFile({
          filters: [{ name: 'Rig export', extensions: ['json'] }],
        });
        if (result.kind === 'opened') {
          await handleImportText(result.text);
          return;
        }
        if (result.kind === 'cancelled') return;
        // Browser dev: fall through to the hidden <input type="file">.
        importInputRef.current?.click();
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
          <span className={styles.brand}>Rig Planner</span>
          <img
            className={styles.headerLogo}
            src={scBadgeUrl}
            alt=""
            aria-hidden
            draggable={false}
          />
        </div>
      </header>
      <span
        className={styles.bottomCat}
        aria-hidden
        onClick={handleCatTap}
        style={{
          WebkitMaskImage: `url(${catSilhouetteUrl})`,
          maskImage: `url(${catSilhouetteUrl})`,
        }}
      />
      <main className={styles.body}>
        <h1 className={styles.title}>Your Rigs</h1>
        {status === 'loading' ||
        pedalsStatus === 'loading' ||
        !pedalImagesReady ? (
          <SpinnerOverlay label="Loading your rigs…" />
        ) : null}
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
            <li>
              <button
                type="button"
                className={styles.newRigCard}
                onClick={triggerImport}
              >
                <span
                  className={`${styles.newRigThumb} ${styles.importThumb}`}
                  aria-hidden
                >
                  <i className="ti ti-upload" />
                </span>
                <div className={styles.newRigMeta}>
                  <div className={styles.newRigName}>Import rig</div>
                  <div className={styles.newRigSub}>
                    Load a .rig.json export
                  </div>
                </div>
              </button>
            </li>
          </ul>
        )}
        {status === 'ready' ? (
          <section className={styles.collectionSection}>
            <button
              type="button"
              className={styles.newRigCard}
              onClick={() => setLibraryOpen(true)}
            >
              <span
                className={`${styles.newRigThumb} ${styles.collectionThumb}`}
                aria-hidden
              >
                <i className="ti ti-list-details" />
              </span>
              <div className={styles.newRigMeta}>
                <div className={styles.newRigName}>Your pedal collection</div>
                <div className={styles.newRigSub}>
                  {pedals.length} pedal{pedals.length === 1 ? '' : 's'}
                </div>
              </div>
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
                if (!file) return;
                setImportError(null);
                void (async () => {
                  try {
                    const text = await file.text();
                    await handleImportText(text);
                  } catch (err) {
                    setImportError(
                      err instanceof Error
                        ? `Import failed: ${err.message}`
                        : `Import failed: ${String(err)}`,
                    );
                  }
                })();
              }}
            />
          </section>
        ) : null}
        {importError ? (
          <p className={styles.importError} role="alert">
            {importError}
          </p>
        ) : null}

        {status === 'ready' && onOpenAbout ? (
          <footer className={styles.brandFooter}>
            <button
              type="button"
              className={styles.newRigCard}
              onClick={onOpenAbout}
              aria-label="About Stray Circuits"
            >
              <span
                className={`${styles.newRigThumb} ${styles.aboutThumb}`}
                aria-hidden
              >
                <i className="ti ti-info-circle" />
              </span>
              <div className={styles.newRigMeta}>
                <div className={styles.newRigName}>About Stray Circuits</div>
                <div className={styles.newRigSub}>Links &amp; info →</div>
              </div>
            </button>
          </footer>
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

      {catToast ? (
        <Toast
          key={catToast.key}
          message={catToast.message}
          duration={catToast.duration}
          onDismiss={() => setCatToast(null)}
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

  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function startHold() {
    holdTimer.current = setTimeout(() => {
      setActionsOpen(true);
      holdTimer.current = null;
    }, 450);
  }

  function clearHold() {
    if (holdTimer.current) {
      clearTimeout(holdTimer.current);
      holdTimer.current = null;
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
