import { describe, expect, it, vi } from 'vitest';
import { colorPickerHandlers } from '../lib/colorPickerHandlers.js';

/** @returns {import('../hooks/useCollectionActions.js').CollectionActions} */
function makeActions() {
  return /** @type {any} */ ({
    setCollectionColor: vi.fn(),
    setFolderColor: vi.fn(),
    labelWithNewColor: vi.fn().mockResolvedValue('added'),
  });
}

describe('colorPickerHandlers', () => {
  it('labels a collection from a swatch and closes the menu', () => {
    const actions = makeActions();
    const close = vi.fn();
    const { onSelect } = colorPickerHandlers(actions, 'collection', 'c1', close);

    onSelect('blue');

    expect(close).toHaveBeenCalledTimes(1);
    expect(actions.setCollectionColor).toHaveBeenCalledWith('c1', 'blue');
    expect(actions.setFolderColor).not.toHaveBeenCalled();
  });

  it('labels a folder from a swatch', () => {
    const actions = makeActions();
    const { onSelect } = colorPickerHandlers(actions, 'folder', 'f1', vi.fn());

    onSelect(null);

    expect(actions.setFolderColor).toHaveBeenCalledWith('f1', null);
    expect(actions.setCollectionColor).not.toHaveBeenCalled();
  });

  it('mints a colour, reports the verdict, and only closes on success', async () => {
    const actions = makeActions();
    const close = vi.fn();
    const { onCreateColor } = colorPickerHandlers(actions, 'collection', 'c1', close);

    await expect(onCreateColor('Ocean', '#7c6fff')).resolves.toBe('added');
    expect(actions.labelWithNewColor).toHaveBeenCalledWith('collection', 'c1', 'Ocean', '#7c6fff');
    expect(close).toHaveBeenCalledTimes(1);

    actions.labelWithNewColor.mockResolvedValue('duplicate');
    await expect(onCreateColor('Red', '#7c6fff')).resolves.toBe('duplicate');
    // A refusal leaves the menu open so the picker can show why.
    expect(close).toHaveBeenCalledTimes(1);
  });
});
