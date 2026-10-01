import { describe, expect, it } from 'vitest';
import { formatTabCount, formatTime } from '../format.js';

describe('formatTime', () => {
  it('labels recent, past and future timestamps', () => {
    const now = Date.now();
    expect(formatTime(now)).toBe('just now');
    expect(formatTime(now - 5 * 60 * 1000)).toBe('5m ago');
    expect(formatTime(now - 3 * 60 * 60 * 1000)).toBe('3h ago');
    expect(formatTime(now - 2 * 24 * 60 * 60 * 1000)).toBe('2d ago');
    // Half-offsets keep the assertion clear of the rounding boundary, since `formatTime`
    // reads the clock a moment after this test captured `now`.
    expect(formatTime(now + 7.5 * 60 * 1000)).toBe('in 7m');
    expect(formatTime(now + 2.5 * 60 * 60 * 1000)).toBe('in 2h');
  });

  it('treats a missing timestamp as "just now"', () => {
    expect(formatTime(undefined)).toBe('just now');
  });
});

describe('formatTabCount', () => {
  it('pluralises only for counts other than one', () => {
    expect(formatTabCount(0)).toBe('0 tabs');
    expect(formatTabCount(1)).toBe('1 tab');
    expect(formatTabCount(12)).toBe('12 tabs');
  });
});
