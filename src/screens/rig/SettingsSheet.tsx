import { useEffect, useState } from 'react';
import type { BoardStyle, Rig } from '../../data/schema';
import { BoardThumb } from '../../canvas/BoardThumb';
import { BoardPicker } from '../../components/BoardPicker';
import {
  initialPickerStateFor,
  resolveBoardChoice,
  type BoardSelection,
} from '../../components/boardPickerHelpers';
import { Button, Sheet, TextField } from '../../ui';
import styles from './SettingsSheet.module.css';

interface SettingsSheetProps {
  open: boolean;
  rig: Rig;
  onClose: () => void;
  onRename: (name: string) => Promise<void>;
  onChangeBoard: (
    widthIn: number,
    depthIn: number,
    style: BoardStyle,
  ) => Promise<void>;
}

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
  onClose,
  onRename,
  onChangeBoard,
}: SettingsSheetProps) {
  const [view, setView] = useState<'main' | 'board'>('main');
  const [name, setName] = useState(rig.name);
  const [pickerState, setPickerState] = useState(() =>
    initialPickerStateFor(rig),
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setView('main');
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

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={view === 'main' ? 'Rig settings' : 'Change board'}
    >
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

          {error ? <p className={styles.error}>{error}</p> : null}

          <div className={styles.actions}>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={handleApply} disabled={saving}>
              {saving ? 'Saving…' : 'Apply'}
            </Button>
          </div>
        </div>
      ) : (
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
      )}
    </Sheet>
  );
}
