import { useEffect, useMemo, useState } from 'react';
import type { Pedal, Rig } from '../../data/schema';
import { usePedalsStore } from '../../stores/pedalsStore';
import { usePlacedPedalsStore } from '../../stores/placedPedalsStore';
import { useRigsStore } from '../../stores/rigsStore';
import { RigThumb } from '../../canvas/RigThumb';
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
  const pedals = usePedalsStore((s) => s.pedals);
  const pedalsStatus = usePedalsStore((s) => s.status);
  const loadPedals = usePedalsStore((s) => s.loadPedals);

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
        <div className={styles.titleRow}>
          <h1 className={styles.title}>Your rigs</h1>
          <Button size="sm" onClick={onCreateRig}>
            <i className="ti ti-plus" aria-hidden /> New rig
          </Button>
        </div>
        {status === 'loading' && <p className={styles.empty}>Loading rigs…</p>}
        {status === 'ready' && rigs.length === 0 && (
          <div className={styles.empty}>
            <p>No rigs yet.</p>
            <Button onClick={onCreateRig}>Create your first rig</Button>
          </div>
        )}
        {rigs.length > 0 && (
          <ul className={styles.grid}>
            {rigs.map((rig) => (
              <RigCard
                key={rig.id}
                rig={rig}
                pedalsById={pedalsById}
                onOpen={() => onOpenRig(rig)}
              />
            ))}
          </ul>
        )}
      </main>
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
        title="Rename rig"
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
        title="Delete rig?"
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
