import { afterEach, describe, expect, it, vi } from 'vitest';
import { dismissToast, getToasts, pushToast, resetToasts, subscribeToasts } from '../toastStore.js';

afterEach(() => {
  resetToasts();
});

describe('toastStore', () => {
  it('queues a toast and notifies subscribers', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToasts(listener);

    pushToast('Saved');
    pushToast('Again');

    expect(getToasts().map((toast) => toast.message)).toEqual(['Saved', 'Again']);
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    pushToast('Ignored');
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('ignores an empty message', () => {
    pushToast('');
    expect(getToasts()).toEqual([]);
  });

  it('drops a toast when it is dismissed', () => {
    pushToast('Saved');
    const [entry] = getToasts();

    dismissToast(entry.id);

    expect(getToasts()).toEqual([]);
  });

  it('dismisses itself after the visible window plus the hide animation', () => {
    vi.useFakeTimers();
    try {
      pushToast('Saved', 1000);
      expect(getToasts()).toHaveLength(1);

      vi.advanceTimersByTime(1399);
      expect(getToasts()).toHaveLength(1);

      vi.advanceTimersByTime(1);
      expect(getToasts()).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('cancels pending dismissals when reset', () => {
    vi.useFakeTimers();
    try {
      pushToast('Saved');
      resetToasts();

      vi.advanceTimersByTime(5000);
      expect(getToasts()).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });
});
