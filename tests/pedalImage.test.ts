import { describe, expect, it } from 'vitest';
import { colorFromImagePath } from '../src/lib/pedalImage';

describe('colorFromImagePath', () => {
  it('extracts the hex from a `color:` prefix', () => {
    expect(colorFromImagePath('color:#C62828')).toBe('#C62828');
  });

  it('returns null for missing or non-color paths', () => {
    expect(colorFromImagePath(null)).toBeNull();
    expect(colorFromImagePath('/some/path.png')).toBeNull();
  });
});
