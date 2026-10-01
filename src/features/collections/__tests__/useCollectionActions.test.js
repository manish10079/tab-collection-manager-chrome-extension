import { describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { installChromeMock } from '../../../../tests/mocks/chrome.js';
import { hydrate } from '../../../store/store.js';
import { LIMITS } from '../../../shared/constants.js';
import { useCollectionActions } from '../hooks/useCollectionActions.js';

/**
 * The drag actions against the real store and write queue. These cover the parts a component
 * test cannot: the mutation actually reaching storage, and a refused move surfacing as a
 * toast rather than the legacy `alert()` that used to block the side panel.
 */

/** @param {string} id */
function makeTab(id) {
  return { id, title: id.toUpperCase(), url: `https://${id}.test`, pinned: false };
}

/** @param {Record<string, unknown>} initial */
function setup(initial) {
  const { store } = installChromeMock(initial);
  const legacy = { toast: vi.fn() };
  const { result } = renderHook(() => useCollectionActions(legacy));
  return { store, legacy, actions: result.current };
}

describe('useCollectionActions drag actions', () => {
  it('moves a tab into another collection through the write queue', async () => {
    const { store, legacy, actions } = setup({
      collections: [
        { id: 'a', name: 'A', tabs: [makeTab('t1')] },
        { id: 'b', name: 'B', tabs: [makeTab('t2')] },
      ],
    });
    await hydrate();

    const result = await actions.moveTab('t1', 'a', 'b');

    expect(result.moved).toBe(true);
    expect(store.collections[0].tabs).toEqual([]);
    expect(store.collections[1].tabs.map((tab) => tab.id)).toEqual(['t2', 't1']);
    expect(legacy.toast).not.toHaveBeenCalled();
  });

  it('toasts the tab-cap refusal and leaves the tab in place', async () => {
    const full = Array.from({ length: LIMITS.MAX_TABS_PER_COLLECTION }, (_, index) =>
      makeTab(`b${index}`)
    );
    const { store, legacy, actions } = setup({
      collections: [
        { id: 'a', name: 'A', tabs: [makeTab('t1')] },
        { id: 'b', name: 'B', tabs: full },
      ],
    });
    await hydrate();
    const alertSpy = vi.spyOn(window, 'alert');

    const result = await actions.moveTab('t1', 'a', 'b');

    expect(result.moved).toBe(false);
    expect(legacy.toast).toHaveBeenCalledTimes(1);
    expect(legacy.toast.mock.calls[0][0]).toContain(String(LIMITS.MAX_TABS_PER_COLLECTION));
    expect(alertSpy).not.toHaveBeenCalled();
    expect(store.collections[0].tabs.map((tab) => tab.id)).toEqual(['t1']);
    alertSpy.mockRestore();
  });

  it('refuses a move inside one collection without bothering the user', async () => {
    const { store, legacy, actions } = setup({
      collections: [{ id: 'a', name: 'A', tabs: [makeTab('t1'), makeTab('t2')] }],
    });
    await hydrate();

    const result = await actions.moveTab('t1', 'a', 'a');

    expect(result.moved).toBe(false);
    expect(legacy.toast).not.toHaveBeenCalled();
    expect(store.collections[0].tabs.map((tab) => tab.id)).toEqual(['t1', 't2']);
  });

  it('reorders collections and forces the custom sort mode', async () => {
    const { store, actions } = setup({
      collections: [
        { id: 'a', name: 'A', tabs: [] },
        { id: 'b', name: 'B', tabs: [] },
      ],
      collectionSortType: 'titleAsc',
    });
    await hydrate();

    await actions.moveCollection('b', 'a');

    expect(store.collections.map((collection) => collection.id)).toEqual(['b', 'a']);
    expect(store.collectionSortType).toBe('custom');
  });
});
