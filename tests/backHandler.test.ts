import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __resetBackHandlersForTests,
  pushBackHandler,
} from '../src/lib/backHandler';

function firePopState() {
  window.dispatchEvent(new PopStateEvent('popstate'));
}

describe('backHandler', () => {
  beforeEach(() => {
    __resetBackHandlersForTests();
  });
  afterEach(() => {
    __resetBackHandlersForTests();
  });

  it('routes a back press to the most recently registered handler (LIFO)', () => {
    const a = vi.fn(() => true);
    const b = vi.fn(() => true);
    pushBackHandler(a);
    pushBackHandler(b);
    firePopState();
    expect(b).toHaveBeenCalledOnce();
    expect(a).not.toHaveBeenCalled();
  });

  it('falls through to the next handler when the topmost returns false', () => {
    const a = vi.fn(() => true);
    const b = vi.fn(() => false);
    pushBackHandler(a);
    pushBackHandler(b);
    firePopState();
    expect(b).toHaveBeenCalledOnce();
    expect(a).toHaveBeenCalledOnce();
  });

  it('unregister removes the handler from the stack', () => {
    const a = vi.fn(() => true);
    const unregister = pushBackHandler(a);
    unregister();
    firePopState();
    expect(a).not.toHaveBeenCalled();
  });

  it('does nothing when no handler consumes the back', () => {
    const a = vi.fn(() => false);
    pushBackHandler(a);
    expect(() => firePopState()).not.toThrow();
    expect(a).toHaveBeenCalledOnce();
  });
});
