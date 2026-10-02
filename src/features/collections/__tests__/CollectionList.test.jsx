import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { installChromeMock } from '../../../../tests/mocks/chrome.js';
import { hydrate } from '../../../store/store.js';
import { CollectionList } from '../components/CollectionList.jsx';

/**
 * The folder view against the real store: root collections stay direct children of the list, a
 * folder's collections nest inside its body, and the two drag gestures (into a folder, back to the
 * root) resolve to the right action. `moveCollectionToFolder` is a spy, so the assertion is the
 * gesture's intent, not the store write.
 */

/** Every action the list and its cards may call; only the drag ones matter here. */
function makeActions() {
  return {
    setExpanded: vi.fn(),
    setTabSortType: vi.fn(),
    pinCollection: vi.fn(),
    pinTab: vi.fn(),
    renameCollection: vi.fn(),
    deleteCollection: vi.fn(),
    openAllTabs: vi.fn(),
    addTabs: vi.fn(),
    importTabs: vi.fn(),
    exportCollection: vi.fn(),
    copyCollectionLinks: vi.fn(),
    removeTab: vi.fn(),
    renameTab: vi.fn(),
    openTab: vi.fn(),
    copyTabUrl: vi.fn(),
    toast: vi.fn(),
    moveCollection: vi.fn(),
    reorderTabs: vi.fn(),
    moveTab: vi.fn(),
    moveTabToPosition: vi.fn(),
    setFolderExpanded: vi.fn(),
    renameFolder: vi.fn(),
    deleteFolder: vi.fn(),
    moveCollectionToFolder: vi.fn(),
  };
}

/** @param {Record<string, unknown>} storage */
async function renderList(storage) {
  installChromeMock(storage);
  await hydrate();
  const actions = makeActions();
  const view = render(<CollectionList actions={actions} />);
  return { actions, ...view };
}

const NESTED_STORAGE = {
  collections: [
    { id: 'root1', name: 'Root One', tabs: [] },
    { id: 'nested1', name: 'Nested One', tabs: [], folderId: 'f1' },
  ],
  folders: [{ id: 'f1', name: 'Work', isExpanded: true }],
};

/** Arm the handle and start the drag, the way the user begins a gesture. @param {HTMLElement} card */
function startDrag(card) {
  fireEvent.pointerDown(card.querySelector('.drag-handle'));
  fireEvent.dragStart(card);
}

describe('CollectionList folders', () => {
  it('keeps root collections as direct children and nests a folder’s collections', async () => {
    const { container } = await renderList(NESTED_STORAGE);

    const rootCards = container.querySelectorAll(':scope > .collection');
    expect(rootCards).toHaveLength(1);
    expect(rootCards[0].dataset.id).toBe('root1');

    const nested = container.querySelector('.folder[data-folder-id="f1"] .folder-body .collection');
    expect(nested.dataset.id).toBe('nested1');
    // The nested card is not also a direct child of the list.
    expect(container.querySelector(':scope > .collection[data-id="nested1"]')).toBeNull();
  });

  it('shows the empty state only when both collections and folders are empty', async () => {
    const { container } = await renderList({ collections: [], folders: [] });
    expect(screen.getByText('No collections yet')).toBeTruthy();

    container.remove();

    const withFolder = await renderList({ collections: [], folders: [{ id: 'f1', name: 'Work' }] });
    expect(screen.queryByText('No collections yet')).toBeNull();
    expect(withFolder.container.querySelector('.folder[data-folder-id="f1"]')).toBeTruthy();
  });

  it('moves a collection into a folder when it is dropped on the folder section', async () => {
    const { container, actions } = await renderList({
      collections: [{ id: 'root1', name: 'Root One', tabs: [] }],
      folders: [{ id: 'f1', name: 'Work', isExpanded: true }],
    });

    startDrag(container.querySelector('.collection[data-id="root1"]'));
    const folder = container.querySelector('.folder[data-folder-id="f1"]');
    fireEvent.dragOver(folder);
    fireEvent.drop(folder);

    expect(actions.moveCollectionToFolder).toHaveBeenCalledWith('root1', 'f1');
  });

  it('reveals the root drop zone only while a nested collection is dragged', async () => {
    const { container } = await renderList(NESTED_STORAGE);
    expect(container.querySelector('.folder-root-dropzone')).toBeNull();

    startDrag(container.querySelector('.collection[data-id="nested1"]'));

    expect(container.querySelector('.folder-root-dropzone')).toBeTruthy();
  });

  it('moves a nested collection back to the root when it is dropped on the root zone', async () => {
    const { container, actions } = await renderList(NESTED_STORAGE);

    startDrag(container.querySelector('.collection[data-id="nested1"]'));
    const zone = container.querySelector('.folder-root-dropzone');
    fireEvent.dragOver(zone);
    fireEvent.drop(zone);

    expect(actions.moveCollectionToFolder).toHaveBeenCalledWith('nested1', null);
  });
});
