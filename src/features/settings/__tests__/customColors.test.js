import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, LIMITS } from '../../../shared/constants.js';
import { addCustomColor, removeCustomColor } from '../lib/customColors.js';

/** @param {Record<string, unknown>} [extra] */
function draft(extra = {}) {
  return {
    collections: [
      { id: 'a', color: 'custom-1' },
      { id: 'b', color: 'red' },
    ],
    folders: [{ id: 'f1', color: 'custom-1' }],
    settings: {
      ...DEFAULT_SETTINGS,
      customColors: [{ id: 'custom-1', name: 'Sunset', value: '#ff8800' }],
    },
    ...extra,
  };
}

describe('addCustomColor', () => {
  it('appends a well-formed entry, normalizing the hex and trimming the name', () => {
    const state = draft();

    expect(addCustomColor(state, '  Ocean ', '#00FF88', 'custom-2')).toBe('added');
    expect(state.settings.customColors).toEqual([
      { id: 'custom-1', name: 'Sunset', value: '#ff8800' },
      { id: 'custom-2', name: 'Ocean', value: '#00ff88' },
    ]);
  });

  it('reports each refusal and changes nothing', () => {
    const state = draft();

    expect(addCustomColor(state, '', '#000000', 'x')).toBe('empty');
    expect(addCustomColor(state, 'x'.repeat(41), '#000000', 'x')).toBe('too-long');
    expect(addCustomColor(state, 'Bad', 'nope', 'x')).toBe('invalid');
    expect(addCustomColor(state, 'Red', '#000000', 'x')).toBe('duplicate');
    expect(state.settings.customColors).toHaveLength(1);
  });

  it('enforces the custom-colour cap', () => {
    const full = Array.from({ length: LIMITS.MAX_CUSTOM_COLORS }, (_, i) => ({
      id: `c${i}`,
      name: `C${i}`,
      value: '#000000',
    }));
    const state = draft({ settings: { ...DEFAULT_SETTINGS, customColors: full } });

    expect(addCustomColor(state, 'One more', '#ffffff', 'x')).toBe('too-many');
    expect(state.settings.customColors).toHaveLength(LIMITS.MAX_CUSTOM_COLORS);
  });
});

describe('removeCustomColor', () => {
  it('drops the colour and unlabels every item that used it', () => {
    const state = draft();

    expect(removeCustomColor(state, 'custom-1')).toBe(true);
    expect(state.settings.customColors).toEqual([]);
    expect(state.collections[0].color).toBeNull();
    expect(state.collections[1].color).toBe('red');
    expect(state.folders[0].color).toBeNull();
  });

  it('does nothing for an unknown id', () => {
    const state = draft();

    expect(removeCustomColor(state, 'ghost')).toBe(false);
    expect(state.settings.customColors).toHaveLength(1);
  });
});
