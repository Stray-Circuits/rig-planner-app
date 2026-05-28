import { describe, expect, it } from 'vitest';
import {
  CUSTOM_SELECTION,
  initialPickerStateFor,
} from '../src/components/boardPickerHelpers';

describe('initialPickerStateFor', () => {
  it('prefers an exact presetId match when one is set', () => {
    const state = initialPickerStateFor({
      // dims intentionally do NOT match the preset — confirms we use presetId, not dims.
      widthIn: 99,
      depthIn: 99,
      style: 'rail',
      presetId: 'pedaltrain-classic-pro',
    });
    expect(state.selection).toBe('pedaltrain-classic-pro');
  });

  it('falls back to fuzzy match by dims+style when presetId is null', () => {
    const state = initialPickerStateFor({
      widthIn: 32,
      depthIn: 16,
      style: 'rail',
      presetId: null,
    });
    expect(state.selection).toBe('pedaltrain-classic-pro');
  });

  it('falls back to custom when nothing matches', () => {
    const state = initialPickerStateFor({
      widthIn: 99,
      depthIn: 99,
      style: 'rail',
      presetId: null,
    });
    expect(state.selection).toBe(CUSTOM_SELECTION);
    expect(state.customW).toBe('99');
    expect(state.customD).toBe('99');
  });

  it('falls back to fuzzy match if the stored presetId is unknown', () => {
    // e.g. an export from a future version with a preset we no longer recognize
    const state = initialPickerStateFor({
      widthIn: 32,
      depthIn: 16,
      style: 'rail',
      presetId: 'pedaltrain-this-does-not-exist',
    });
    expect(state.selection).toBe('pedaltrain-classic-pro');
  });
});
