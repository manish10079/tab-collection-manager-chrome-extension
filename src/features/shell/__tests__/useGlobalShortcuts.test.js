import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useGlobalShortcuts } from '../hooks/useGlobalShortcuts.js';

/**
 * The global key handler is the one piece of the shell that reacts to raw browser events, so it is
 * tested by dispatching real `keydown` events at the document (and at a focused field, for the
 * typing guard) rather than by calling a handler directly.
 */

/** @returns {import('../hooks/useShellController.js').ShellController} */
function makeController() {
  return {
    slide: null,
    query: '',
    createName: '',
    toggleSearch: vi.fn(),
    closeSearch: vi.fn(),
    toggleCreate: vi.fn(),
    closeCreate: vi.fn(),
    setQuery: vi.fn(),
    setCreateName: vi.fn(),
    submitCreate: vi.fn(),
    toggleLayout: vi.fn(),
    setCollectionSort: vi.fn(),
    exportAll: vi.fn(),
    importAll: vi.fn(),
    restoreBackup: vi.fn(),
    expandAll: vi.fn(),
    expandCurrentSession: vi.fn(),
    jumpToCollection: vi.fn(),
    openCollection: vi.fn(),
    closeOverlays: vi.fn(),
    closePanel: vi.fn(),
  };
}

function setup() {
  const controller = makeController();
  const onOpenShortcuts = vi.fn();
  const view = renderHook(() => useGlobalShortcuts({ controller, onOpenShortcuts }));
  return { ...view, controller, onOpenShortcuts };
}

/** @param {KeyboardEventInit & {key: string}} init */
function press(init) {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  document.dispatchEvent(event);
  return event;
}

/** A visible dialog overlay, as the Modal primitive portals it. */
function mountOverlay({ hidden = false } = {}) {
  const overlay = document.createElement('div');
  overlay.className = 'dl-modal-overlay';
  if (hidden) overlay.style.display = 'none';
  document.body.appendChild(overlay);
  return overlay;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('useGlobalShortcuts modifier combos', () => {
  it('toggles search and create with Ctrl or Cmd', () => {
    const { controller } = setup();

    press({ key: 'f', ctrlKey: true });
    press({ key: 'F', metaKey: true });
    press({ key: 'n', ctrlKey: true });

    expect(controller.toggleSearch).toHaveBeenCalledTimes(2);
    expect(controller.toggleCreate).toHaveBeenCalledTimes(1);
  });

  it('prevents the browser default for the combos it handles', () => {
    setup();

    expect(press({ key: 'f', ctrlKey: true }).defaultPrevented).toBe(true);
    expect(press({ key: 'n', ctrlKey: true }).defaultPrevented).toBe(true);
    expect(press({ key: 'd', ctrlKey: true }).defaultPrevented).toBe(true);
  });

  it('separates expand-all from expand Current Session', () => {
    const { controller } = setup();

    press({ key: 'e', ctrlKey: true });
    expect(controller.expandAll).toHaveBeenCalledTimes(1);
    expect(controller.expandCurrentSession).not.toHaveBeenCalled();

    press({ key: 'E', ctrlKey: true, shiftKey: true });
    expect(controller.expandCurrentSession).toHaveBeenCalledTimes(1);
    expect(controller.expandAll).toHaveBeenCalledTimes(1);
  });

  it('toggles the layout with Ctrl+D', () => {
    const { controller } = setup();

    press({ key: 'd', ctrlKey: true });

    expect(controller.toggleLayout).toHaveBeenCalledTimes(1);
  });

  it('ignores a repeated combo so holding the key does not thrash', () => {
    const { controller } = setup();

    press({ key: 'f', ctrlKey: true, repeat: true });

    expect(controller.toggleSearch).not.toHaveBeenCalled();
  });

  it('does not treat a bare letter as a combo key', () => {
    const { controller } = setup();

    press({ key: 'f' });
    press({ key: 'd' });

    expect(controller.toggleSearch).not.toHaveBeenCalled();
    expect(controller.toggleLayout).not.toHaveBeenCalled();
  });
});

describe('useGlobalShortcuts Escape routing', () => {
  it('closes the open slide when no dialog is up', () => {
    const { controller } = setup();

    press({ key: 'Escape' });

    expect(controller.closeOverlays).toHaveBeenCalledTimes(1);
  });

  it('leaves Escape to a visible dialog', () => {
    const { controller } = setup();
    mountOverlay();

    press({ key: 'Escape' });

    expect(controller.closeOverlays).not.toHaveBeenCalled();
  });

  it('still closes the slide when the only overlay is hidden', () => {
    const { controller } = setup();
    mountOverlay({ hidden: true });

    press({ key: 'Escape' });

    expect(controller.closeOverlays).toHaveBeenCalledTimes(1);
  });
});

describe('useGlobalShortcuts plain keys', () => {
  it('opens the shortcuts help with ?', () => {
    const { onOpenShortcuts } = setup();

    press({ key: '?' });

    expect(onOpenShortcuts).toHaveBeenCalledTimes(1);
  });

  it('jumps to the Nth collection for 1-9', () => {
    const { controller } = setup();

    press({ key: '1' });
    press({ key: '9' });

    expect(controller.jumpToCollection).toHaveBeenNthCalledWith(1, 1);
    expect(controller.jumpToCollection).toHaveBeenNthCalledWith(2, 9);
  });

  it('skips the jump while a dialog is up', () => {
    const { controller } = setup();
    mountOverlay();

    press({ key: '3' });

    expect(controller.jumpToCollection).not.toHaveBeenCalled();
  });

  it('closes the panel on x or X', () => {
    const { controller } = setup();

    press({ key: 'x' });
    press({ key: 'X' });

    expect(controller.closePanel).toHaveBeenCalledTimes(2);
  });
});

describe('useGlobalShortcuts typing guard', () => {
  it('ignores plain keys typed into a field but still honours the combos', () => {
    const { controller, onOpenShortcuts } = setup();
    const input = document.createElement('input');
    document.body.appendChild(input);

    input.dispatchEvent(new KeyboardEvent('keydown', { key: '?', bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: '2', bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'x', bubbles: true }));

    expect(onOpenShortcuts).not.toHaveBeenCalled();
    expect(controller.jumpToCollection).not.toHaveBeenCalled();
    expect(controller.closePanel).not.toHaveBeenCalled();

    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true }));
    expect(controller.toggleSearch).toHaveBeenCalledTimes(1);
  });
});

describe('useGlobalShortcuts lifecycle', () => {
  it('stops listening after unmount', () => {
    const { controller, unmount } = setup();
    unmount();

    press({ key: 'x' });

    expect(controller.closePanel).not.toHaveBeenCalled();
  });
});
