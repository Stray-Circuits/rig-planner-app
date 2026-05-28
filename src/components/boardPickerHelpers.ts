import { useState } from 'react';
import { BOARD_PRESETS } from '../data/boardPresets';
import type { BoardStyle } from '../data/schema';

export const CUSTOM_SELECTION = 'custom' as const;
export type BoardSelection = string;

export interface BoardChoice {
  widthIn: number;
  depthIn: number;
  style: BoardStyle;
  /** Preset id when one is chosen, or the literal "custom". */
  source: BoardSelection;
}

export interface BoardPickerState {
  selection: BoardSelection | null;
  customW: string;
  customD: string;
  customStyle: BoardStyle;
}

/**
 * Resolve the user's current picker selection into a concrete BoardChoice,
 * or null if the choice is incomplete (custom dims missing/invalid).
 */
export function resolveBoardChoice(
  state: BoardPickerState,
): BoardChoice | null {
  const { selection, customW, customD, customStyle } = state;
  if (!selection) return null;
  if (selection === CUSTOM_SELECTION) {
    const w = Number(customW);
    const d = Number(customD);
    if (!Number.isFinite(w) || w <= 0) return null;
    if (!Number.isFinite(d) || d <= 0) return null;
    return { widthIn: w, depthIn: d, style: customStyle, source: 'custom' };
  }
  const preset = BOARD_PRESETS.find((p) => p.id === selection);
  if (!preset) return null;
  return {
    widthIn: preset.widthIn,
    depthIn: preset.depthIn,
    style: preset.style,
    source: preset.id,
  };
}

/**
 * Pre-fill a picker from an existing rig. Prefers the rig's stored presetId
 * (authoritative), then falls back to fuzzy-matching dims+style against a
 * preset, then to "custom" with the rig's current values. The fuzzy match
 * is what lets pre-presetId rigs (created before the column existed) still
 * land on the right preset card.
 */
export function initialPickerStateFor(rig: {
  widthIn: number;
  depthIn: number;
  style: BoardStyle;
  presetId?: string | null;
}): BoardPickerState {
  if (rig.presetId) {
    const byId = BOARD_PRESETS.find((p) => p.id === rig.presetId);
    if (byId) {
      return {
        selection: byId.id,
        customW: '',
        customD: '',
        customStyle: rig.style,
      };
    }
  }
  const matched = BOARD_PRESETS.find(
    (p) =>
      Math.abs(p.widthIn - rig.widthIn) < 0.01 &&
      Math.abs(p.depthIn - rig.depthIn) < 0.01 &&
      p.style === rig.style,
  );
  if (matched) {
    return {
      selection: matched.id,
      customW: '',
      customD: '',
      customStyle: rig.style,
    };
  }
  return {
    selection: CUSTOM_SELECTION,
    customW: String(rig.widthIn),
    customD: String(rig.depthIn),
    customStyle: rig.style,
  };
}

/**
 * Hook variant — owns picker state for callers that don't want to manage it.
 * Returns props ready to spread into <BoardPicker> plus the resolved choice.
 */
export function useBoardPicker(initial?: BoardPickerState) {
  const [selection, setSelection] = useState<BoardSelection | null>(
    initial?.selection ?? null,
  );
  const [customW, setCustomW] = useState(initial?.customW ?? '');
  const [customD, setCustomD] = useState(initial?.customD ?? '');
  const [customStyle, setCustomStyle] = useState<BoardStyle>(
    initial?.customStyle ?? 'plain',
  );
  return {
    props: {
      selection,
      customW,
      customD,
      customStyle,
      onSelect: setSelection,
      onCustomW: setCustomW,
      onCustomD: setCustomD,
      onCustomStyle: setCustomStyle,
    },
    choice: resolveBoardChoice({ selection, customW, customD, customStyle }),
  };
}
