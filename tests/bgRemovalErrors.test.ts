import { afterEach, describe, expect, it } from 'vitest';
import { describeImageError, isMeteredConnection } from '../src/lib/bgRemoval';

describe('describeImageError', () => {
  it('maps AbortError to a short Canceled message', () => {
    const err = new DOMException('user canceled', 'AbortError');
    expect(describeImageError(err)).toBe('Canceled.');
  });

  it('maps createImageBitmap decode errors to a HEIC-aware hint', () => {
    const err = new Error(
      'createImageBitmap: The source image could not be decoded.',
    );
    expect(describeImageError(err)).toMatch(/HEIC/);
    expect(describeImageError(err)).toMatch(/JPEG or PNG/);
  });

  it('matches Safari-style "type not supported" decode errors', () => {
    const err = new Error('The image source is not supported');
    expect(describeImageError(err)).toMatch(/HEIC/);
  });

  it('passes other errors through verbatim', () => {
    expect(describeImageError(new Error('toBlob returned null'))).toBe(
      'toBlob returned null',
    );
  });

  it('coerces non-Error throwns to strings', () => {
    expect(describeImageError('something broke')).toBe('something broke');
  });
});

describe('isMeteredConnection', () => {
  const navAny = navigator as unknown as {
    connection?: { type?: string; effectiveType?: string; saveData?: boolean };
  };

  afterEach(() => {
    delete navAny.connection;
  });

  it('returns false when navigator.connection is unavailable', () => {
    delete navAny.connection;
    expect(isMeteredConnection()).toBe(false);
  });

  it('returns true when saveData is on', () => {
    navAny.connection = { saveData: true };
    expect(isMeteredConnection()).toBe(true);
  });

  it('returns true on cellular type', () => {
    navAny.connection = { type: 'cellular' };
    expect(isMeteredConnection()).toBe(true);
  });

  it('returns false on wifi', () => {
    navAny.connection = { type: 'wifi', saveData: false };
    expect(isMeteredConnection()).toBe(false);
  });
});
