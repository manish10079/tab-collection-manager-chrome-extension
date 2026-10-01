import { describe, expect, it } from 'vitest';
import { EMPTY_STATE } from '../schema.js';
import { normalizeOpenedState } from '../openedState.js';

/** @param {object[]} [collections] @param {Record<string, unknown>} [settings] */
function draft(collections = [], settings = {}) {
  return structuredClone({
    ...EMPTY_STATE,
    ready: true,
    collections,
    settings: { ...EMPTY_STATE.settings, ...settings },
  });
}

describe('normalizeOpenedState', () => {
  it('collapses every collection and reports the change', () => {
    const state = draft([
      { id: 'a', name: 'A', tabs: [], isExpanded: true },
      { id: 'b', name: 'B', tabs: [], isExpanded: false },
    ]);

    expect(normalizeOpenedState(state)).toBe(true);
    expect(state.collections.every((collection) => collection.isExpanded === false)).toBe(true);
  });

  it('is idempotent, so the caller can skip the write the second time', () => {
    const state = draft([{ id: 'a', name: 'A', tabs: [], createdAt: 10_000, isExpanded: true }]);

    expect(normalizeOpenedState(state)).toBe(true);
    expect(normalizeOpenedState(state)).toBe(false);
  });

  it('backfills addedAt a second apart from the collection createdAt', () => {
    const state = draft([
      {
        id: 'a',
        name: 'A',
        createdAt: 10_000,
        tabs: [
          { id: 't1', url: 'https://a.test' },
          { id: 't2', url: 'https://b.test' },
        ],
      },
    ]);

    normalizeOpenedState(state);

    expect(state.collections[0].tabs.map((tab) => tab.addedAt)).toEqual([10_000, 11_000]);
  });

  it('leaves a tab that already has addedAt alone', () => {
    const state = draft([
      {
        id: 'a',
        name: 'A',
        createdAt: 10_000,
        tabs: [{ id: 't1', url: 'https://a.test', addedAt: 42 }],
      },
    ]);

    expect(normalizeOpenedState(state)).toBe(false);
    expect(state.collections[0].tabs[0].addedAt).toBe(42);
  });

  it('drops an auto-save id whose collection is gone', () => {
    const state = draft([{ id: 'a', name: 'A', tabs: [] }], { autoSaveCollectionId: 'missing' });

    expect(normalizeOpenedState(state)).toBe(true);
    expect(state.settings.autoSaveCollectionId).toBeNull();
  });

  it('keeps an auto-save id that still resolves', () => {
    const state = draft([{ id: 'a', name: 'A', tabs: [] }], { autoSaveCollectionId: 'a' });

    expect(normalizeOpenedState(state)).toBe(false);
    expect(state.settings.autoSaveCollectionId).toBe('a');
  });
});
