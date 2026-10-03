import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../../../shared/constants.js';
import {
  addAndAssignColor,
  canAssignColor,
  setCollectionColor,
  setFolderColor,
} from '../lib/colorDraft.js';

/** @param {Record<string, unknown>} [extra] */
function draft(extra = {}) {
  return {
    collections: [
      { id: 'a', name: 'A', tabs: [], color: null },
      { id: 'b', name: 'B', tabs: [], color: 'red' },
    ],
    folders: [
      { id: 'f1', name: 'Work', color: null },
      { id: 'f2', name: 'Home', color: 'blue' },
    ],
    settings: { ...DEFAULT_SETTINGS, customColors: [{ id: 'custom-1', name: 'Sunset' }] },
    ...extra,
  };
}

describe('setCollectionColor', () => {
  it('assigns a built-in colour and stamps updatedAt', () => {
    const state = draft();

    expect(setCollectionColor(state, 'a', 'blue')).toBe(true);
    expect(state.collections[0].color).toBe('blue');
    expect(state.collections[0].updatedAt).toBeGreaterThan(0);
  });

  it('allows several collections to share one colour', () => {
    const state = draft();

    setCollectionColor(state, 'a', 'blue');
    setCollectionColor(state, 'b', 'blue');

    expect(state.collections.map((collection) => collection.color)).toEqual(['blue', 'blue']);
  });

  it('clears the label with null and treats a repeat as a no-op', () => {
    const state = draft();

    expect(setCollectionColor(state, 'b', null)).toBe(true);
    expect(state.collections[1].color).toBeNull();
    expect(setCollectionColor(state, 'b', null)).toBe(false);
  });

  it('refuses an id that is not in the palette', () => {
    const state = draft();

    expect(setCollectionColor(state, 'a', 'ghost')).toBe(false);
    expect(state.collections[0].color).toBeNull();
  });

  it('accepts a live custom colour and ignores a missing collection', () => {
    const state = draft();

    expect(setCollectionColor(state, 'a', 'custom-1')).toBe(true);
    expect(setCollectionColor(state, 'missing', 'red')).toBe(false);
  });
});

describe('setFolderColor', () => {
  it('assigns, shares and clears a folder colour', () => {
    const state = draft();

    expect(setFolderColor(state, 'f1', 'blue')).toBe(true);
    expect(state.folders[0].color).toBe('blue');
    expect(state.folders[1].color).toBe('blue');
    expect(setFolderColor(state, 'f2', null)).toBe(true);
    expect(state.folders[1].color).toBeNull();
  });

  it('ignores an unknown folder and an unknown colour', () => {
    const state = draft();

    expect(setFolderColor(state, 'ghost', 'red')).toBe(false);
    expect(setFolderColor(state, 'f1', 'ghost')).toBe(false);
    expect(state.folders[0].color).toBeNull();
  });
});

describe('addAndAssignColor', () => {
  it('adds the colour to the palette and labels the collection with it', () => {
    const state = draft();

    expect(
      addAndAssignColor(state, { kind: 'collection', id: 'a' }, 'Ocean', '#00FF88', 'c2')
    ).toBe('added');
    expect(state.settings.customColors).toContainEqual({
      id: 'c2',
      name: 'Ocean',
      value: '#00ff88',
    });
    expect(state.collections[0].color).toBe('c2');
    expect(state.collections[0].updatedAt).toBeGreaterThan(0);
  });

  it('labels a folder the same way', () => {
    const state = draft();

    expect(addAndAssignColor(state, { kind: 'folder', id: 'f1' }, 'Ocean', '#0088ff', 'c2')).toBe(
      'added'
    );
    expect(state.folders[0].color).toBe('c2');
  });

  it('reports a refusal and adds nothing', () => {
    const state = draft();

    expect(
      addAndAssignColor(state, { kind: 'collection', id: 'a' }, 'Sunset', '#0088ff', 'c2')
    ).toBe('duplicate');
    expect(state.settings.customColors).toHaveLength(1);
    expect(state.collections[0].color).toBeNull();
  });
});

describe('canAssignColor', () => {
  it('allows nothing, built-ins and live customs only', () => {
    const state = draft();

    expect(canAssignColor(state, null)).toBe(true);
    expect(canAssignColor(state, 'green')).toBe(true);
    expect(canAssignColor(state, 'custom-1')).toBe(true);
    expect(canAssignColor(state, 'custom-2')).toBe(false);
  });
});
