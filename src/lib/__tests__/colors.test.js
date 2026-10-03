import { describe, expect, it } from 'vitest';
import { LIMITS } from '../../shared/constants.js';
import {
  BUILT_IN_COLORS,
  NO_COLOR,
  allColors,
  clearColorEverywhere,
  colorKey,
  colorName,
  findColor,
  isAssignableColor,
  isBuiltInColor,
  normalizeCustomColors,
  normalizeHex,
  swatchValue,
  validateCustomColor,
} from '../colors.js';

const CUSTOM = [{ id: 'custom-1', name: 'Sunset', value: '#ff8800' }];

describe('built-in palette', () => {
  it('offers exactly ten fixed colours, each with a token and a unique id', () => {
    expect(BUILT_IN_COLORS).toHaveLength(10);
    expect(new Set(BUILT_IN_COLORS.map((color) => color.id)).size).toBe(10);
    for (const color of BUILT_IN_COLORS) {
      expect(color.token).toMatch(/^--swatch-/);
    }
  });

  it('puts the custom colours after the built-ins', () => {
    expect(allColors(CUSTOM).map((color) => color.id)).toEqual([
      ...BUILT_IN_COLORS.map((color) => color.id),
      'custom-1',
    ]);
  });
});

describe('normalizeHex', () => {
  it('accepts a six-digit hex and lower-cases it', () => {
    expect(normalizeHex('  #AABBCC ')).toBe('#aabbcc');
  });

  it('rejects anything else', () => {
    expect(normalizeHex('#abc')).toBe('');
    expect(normalizeHex('red')).toBe('');
    expect(normalizeHex(undefined)).toBe('');
  });
});

describe('normalizeCustomColors', () => {
  it('keeps well-formed entries and drops the rest', () => {
    expect(
      normalizeCustomColors([
        { id: 'a', name: ' Sunset ', value: '#FF8800' },
        { id: '', name: 'No id', value: '#123456' },
        { id: 'b', name: '', value: '#123456' },
        { id: 'c', name: 'Bad value', value: 'nope' },
        'not an object',
        ['nope'],
      ])
    ).toEqual([{ id: 'a', name: 'Sunset', value: '#ff8800' }]);
  });

  it('reads a non-array as an empty palette', () => {
    expect(normalizeCustomColors(undefined)).toEqual([]);
    expect(normalizeCustomColors('nope')).toEqual([]);
  });
});

describe('colour lookup', () => {
  it('finds a built-in, a custom colour and a colour that is gone', () => {
    expect(findColor('red', CUSTOM)?.name).toBe('Red');
    expect(findColor('custom-1', CUSTOM)?.name).toBe('Sunset');
    expect(findColor('missing', CUSTOM)).toBeNull();
  });

  it('treats null and the filter key as "no colour"', () => {
    expect(findColor(null, CUSTOM)).toBeNull();
    expect(findColor(NO_COLOR, CUSTOM)).toBeNull();
    expect(colorName(null, CUSTOM)).toBe('No color');
  });

  it('paints a built-in from its token and a custom colour from its hex', () => {
    expect(swatchValue('red', CUSTOM)).toBe('var(--swatch-red)');
    expect(swatchValue('custom-1', CUSTOM)).toBe('#ff8800');
    // An id that no longer resolves falls back to the neutral swatch.
    expect(swatchValue('missing', CUSTOM)).toBe('var(--swatch-neutral)');
  });
});

describe('isAssignableColor', () => {
  it('allows nothing, the built-ins and live custom colours', () => {
    expect(isAssignableColor(null, CUSTOM)).toBe(true);
    expect(isAssignableColor(NO_COLOR, CUSTOM)).toBe(true);
    expect(isBuiltInColor('teal')).toBe(true);
    expect(isAssignableColor('teal', CUSTOM)).toBe(true);
    expect(isAssignableColor('custom-1', CUSTOM)).toBe(true);
  });

  it('refuses an unknown or removed id', () => {
    expect(isAssignableColor('ghost', CUSTOM)).toBe(false);
    expect(isAssignableColor('custom-1', [])).toBe(false);
  });
});

describe('validateCustomColor', () => {
  it('accepts a fresh name and colour', () => {
    expect(validateCustomColor([], 'Ocean', '#0088ff')).toBe('ok');
  });

  it('reports each refusal', () => {
    expect(validateCustomColor([], '', '#0088ff')).toBe('empty');
    expect(validateCustomColor([], 'x'.repeat(41), '#0088ff')).toBe('too-long');
    expect(validateCustomColor([], 'Ocean', 'nope')).toBe('invalid');
    expect(validateCustomColor([], 'red', '#0088ff')).toBe('duplicate');
    expect(validateCustomColor(CUSTOM, 'sunset', '#0088ff')).toBe('duplicate');
    expect(
      validateCustomColor(
        Array.from({ length: LIMITS.MAX_CUSTOM_COLORS }, (_, i) => ({
          id: `c${i}`,
          name: `C${i}`,
        })),
        'One more',
        '#0088ff'
      )
    ).toBe('too-many');
  });
});

describe('clearColorEverywhere', () => {
  it('unlabels every collection and folder carrying the removed colour', () => {
    const draft = {
      collections: [
        { id: 'a', color: 'custom-1' },
        { id: 'b', color: 'red' },
      ],
      folders: [
        { id: 'f1', color: 'custom-1' },
        { id: 'f2', color: null },
      ],
    };

    expect(clearColorEverywhere(draft, 'custom-1')).toBe(2);
    expect(draft.collections[0].color).toBeNull();
    expect(draft.collections[1].color).toBe('red');
    expect(draft.folders[0].color).toBeNull();
  });
});

describe('colorKey', () => {
  it('reports the colour or the unlabelled key', () => {
    expect(colorKey({ color: 'red' })).toBe('red');
    expect(colorKey({ color: null })).toBe(NO_COLOR);
    expect(colorKey({})).toBe(NO_COLOR);
  });
});
