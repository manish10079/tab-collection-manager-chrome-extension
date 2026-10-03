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

/** @param {Record<string, unknown>} storage @param {Record<string, unknown>} [overrides] */
async function renderList(storage, overrides = {}) {
  installChromeMock(storage);
  await hydrate();
  const actions = makeActions();
  const view = render(<CollectionList actions={actions} {...overrides} />);
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
  fireEvent.pointerDown(card.querySelector('.cc-drag-handle'));
  fireEvent.dragStart(card);
}

describe('CollectionList folders', () => {
  it('keeps root collections as direct children and nests a folder’s collections', async () => {
    const { container } = await renderList(NESTED_STORAGE);

    const rootCards = container.querySelectorAll(':scope > .cc-collection');
    expect(rootCards).toHaveLength(1);
    expect(rootCards[0].dataset.id).toBe('root1');

    const nested = container.querySelector(
      '.cc-folder[data-folder-id="f1"] .cc-folder-body .cc-collection'
    );
    expect(nested.dataset.id).toBe('nested1');
    // The nested card is not also a direct child of the list.
    expect(container.querySelector(':scope > .cc-collection[data-id="nested1"]')).toBeNull();

    // Two stacked sections: Folders first, then Collections, each with a live count.
    const foldersHeading = container.querySelector('.folders-heading');
    const collectionsHeading = container.querySelector('.collections-heading');
    expect(foldersHeading.querySelector('.section-heading-label').textContent).toBe('Folders');
    expect(collectionsHeading.querySelector('.section-heading-label').textContent).toBe(
      'Collections'
    );
    expect(foldersHeading.querySelector('.cc-section-count').textContent).toBe('1');
    expect(collectionsHeading.querySelector('.cc-section-count').textContent).toBe('1');
    expect(
      foldersHeading.compareDocumentPosition(collectionsHeading) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    // The root collection renders inside (after) the Collections heading.
    expect(
      collectionsHeading.compareDocumentPosition(rootCards[0]) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it('folds a whole section away from its heading and back', async () => {
    const { container } = await renderList(NESTED_STORAGE);

    const toggle = container.querySelector('.folders-heading .cc-section-toggle');
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(container.querySelector('.cc-folder')).toBeTruthy();

    fireEvent.click(toggle);

    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(container.querySelector('.cc-folder')).toBeNull();
    // The heading and its live count stay in place…
    expect(container.querySelector('.folders-heading .cc-section-count').textContent).toBe('1');
    // …and the other section is untouched.
    expect(container.querySelector(':scope > .cc-collection')).toBeTruthy();

    fireEvent.click(toggle);
    expect(container.querySelector('.cc-folder')).toBeTruthy();
  });

  it('counts the folders and the root collections in each heading', async () => {
    const { container } = await renderList({
      collections: [
        { id: 'root1', name: 'Root', tabs: [] },
        { id: 'nested1', name: 'Nested', tabs: [], folderId: 'f1' },
        { id: 'nested2', name: 'Nested 2', tabs: [], folderId: 'f2' },
      ],
      folders: [
        { id: 'f1', name: 'One', isExpanded: true },
        { id: 'f2', name: 'Two', isExpanded: true },
      ],
    });

    expect(container.querySelector('.folders-heading .cc-section-count').textContent).toBe('2');
    // Only the root-level collection counts; the two nested ones do not.
    expect(container.querySelector('.collections-heading .cc-section-count').textContent).toBe('1');
  });

  it('shows no section headings until there is a folder', async () => {
    const { container } = await renderList({
      collections: [{ id: 'a', name: 'Only', tabs: [] }],
      folders: [],
    });

    expect(container.querySelector('.cc-section-heading')).toBeNull();
    // The root collection is still a direct child of the list.
    expect(container.querySelector(':scope > .cc-collection[data-id="a"]')).toBeTruthy();
  });

  it('shows the empty state only when both collections and folders are empty', async () => {
    const { container } = await renderList({ collections: [], folders: [] });
    expect(screen.getByText('No collections yet')).toBeTruthy();

    container.remove();

    const withFolder = await renderList({ collections: [], folders: [{ id: 'f1', name: 'Work' }] });
    expect(screen.queryByText('No collections yet')).toBeNull();
    expect(withFolder.container.querySelector('.cc-folder[data-folder-id="f1"]')).toBeTruthy();
  });

  it('moves a collection into a folder when it is dropped on the folder section', async () => {
    const { container, actions } = await renderList({
      collections: [{ id: 'root1', name: 'Root One', tabs: [] }],
      folders: [{ id: 'f1', name: 'Work', isExpanded: true }],
    });

    startDrag(container.querySelector('.cc-collection[data-id="root1"]'));
    const folder = container.querySelector('.cc-folder[data-folder-id="f1"]');
    fireEvent.dragOver(folder);
    fireEvent.drop(folder);

    expect(actions.moveCollectionToFolder).toHaveBeenCalledWith('root1', 'f1');
  });

  it('reveals the root drop zone only while a nested collection is dragged', async () => {
    const { container } = await renderList(NESTED_STORAGE);
    expect(container.querySelector('.cc-folder-root-dropzone')).toBeNull();

    startDrag(container.querySelector('.cc-collection[data-id="nested1"]'));

    expect(container.querySelector('.cc-folder-root-dropzone')).toBeTruthy();
  });

  it('moves a nested collection back to the root when it is dropped on the root zone', async () => {
    const { container, actions } = await renderList(NESTED_STORAGE);

    startDrag(container.querySelector('.cc-collection[data-id="nested1"]'));
    const zone = container.querySelector('.cc-folder-root-dropzone');
    fireEvent.dragOver(zone);
    fireEvent.drop(zone);

    expect(actions.moveCollectionToFolder).toHaveBeenCalledWith('nested1', null);
  });
});

/**
 * Colour filtering: only the matching labels are shown, and a matching collection whose folder is
 * not itself selected is promoted to the root rather than hidden.
 */
describe('CollectionList color filter', () => {
  const COLOR_STORAGE = {
    collections: [
      { id: 'a', name: 'Blue root', tabs: [], color: 'blue' },
      { id: 'b', name: 'Red root', tabs: [], color: 'red' },
      { id: 'c', name: 'Nested blue', tabs: [], folderId: 'f1', color: 'blue' },
    ],
    folders: [{ id: 'f1', name: 'Work', isExpanded: true }],
  };

  it('shows only the matching colours and promotes a match out of an unlabelled folder', async () => {
    const { container } = await renderList(COLOR_STORAGE, { colorFilter: new Set(['blue']) });
    const rootIds = [...container.querySelectorAll(':scope > .cc-collection')].map(
      (element) => element.dataset.id
    );

    expect(rootIds).toEqual(['a', 'c']);
    expect(container.querySelector('.cc-collection[data-id="b"]')).toBeNull();
    expect(container.querySelector('.cc-collection[data-id="a"] .cc-color-dot')).toBeTruthy();
  });

  it('shows a no-matches message when nothing carries the colour', async () => {
    const { container } = await renderList(COLOR_STORAGE, { colorFilter: new Set(['purple']) });

    expect(container.textContent).toContain('No folders or collections match this color');
  });
});

/**
 * Colour grouping (the Color sort mode): one section per colour label, every member of a colour in
 * the same section, in palette order with the unlabelled items last.
 */
describe('CollectionList color grouping', () => {
  it('renders one heading per colour, with a swatch and its members together', async () => {
    const { container } = await renderList({
      collectionSortType: 'color',
      collections: [
        { id: 'a', name: 'Blue root', tabs: [], color: 'blue' },
        { id: 'b', name: 'Red root', tabs: [], color: 'red' },
        { id: 'c', name: 'Nested red', tabs: [], folderId: 'f1', color: 'red' },
      ],
      folders: [{ id: 'f1', name: 'Unlabelled folder', isExpanded: true }],
    });

    const headings = [...container.querySelectorAll('.cc-section-heading.color-heading')];
    // Red comes before blue in the palette, and the unlabelled folder last.
    expect(headings.map((heading) => heading.dataset.color)).toEqual(['red', 'blue', 'none']);
    expect(
      headings.map((heading) => heading.querySelector('.section-heading-label').textContent)
    ).toEqual(['Red', 'Blue', 'No color']);
    expect(headings[0].querySelector('.cc-section-swatch')).toBeTruthy();

    // Every member is a direct child of the list (the promoted nested red collection included),
    // grouped under its colour's heading.
    const directIds = [...container.querySelectorAll(':scope > .cc-collection')].map(
      (element) => element.dataset.id
    );
    expect(directIds).toEqual(expect.arrayContaining(['a', 'b', 'c']));
  });

  it('keeps a matching collection nested inside a folder that shares its colour', async () => {
    const { container } = await renderList({
      collectionSortType: 'color',
      collections: [{ id: 'x', name: 'Nested blue', tabs: [], folderId: 'f1', color: 'blue' }],
      folders: [{ id: 'f1', name: 'Blue folder', isExpanded: true, color: 'blue' }],
    });

    const heading = container.querySelector('.color-heading[data-color="blue"]');
    expect(heading).toBeTruthy();
    expect(
      container.querySelector('.cc-folder[data-folder-id="f1"] .cc-folder-body .cc-collection')
        .dataset.id
    ).toBe('x');
  });

  it('shows the no-matches message when the colour filter leaves no cluster', async () => {
    const { container } = await renderList(
      {
        collectionSortType: 'color',
        collections: [{ id: 'a', name: 'Blue', tabs: [], color: 'blue' }],
        folders: [],
      },
      { colorFilter: new Set(['purple']) }
    );

    expect(container.textContent).toContain('No folders or collections match this color');
  });
});

/**
 * Bulk selection: the checkboxes only exist in selection mode, and each one reports its kind and
 * id so the caller can keep one selection across folders and collections.
 */
describe('CollectionList bulk selection', () => {
  it('hides the checkboxes until selection mode is on', async () => {
    const { container } = await renderList(NESTED_STORAGE);

    expect(container.querySelector('.cc-select-checkbox')).toBeNull();
  });

  it('marks the selected folder and collection and reports every toggle', async () => {
    const onToggleSelect = vi.fn();
    const { container } = await renderList(NESTED_STORAGE, {
      selectionMode: true,
      selectedFolderIds: new Set(['f1']),
      selectedCollectionIds: new Set(),
      onToggleSelect,
    });

    const folder = container.querySelector('.cc-folder[data-folder-id="f1"]');
    const rootCard = container.querySelector('.cc-collection[data-id="root1"]');
    expect(folder.querySelector('.cc-select-checkbox input')).toBeTruthy();
    expect(rootCard.querySelector('.cc-select-checkbox input')).toBeTruthy();
    expect(folder.classList.contains('ut-selected')).toBe(true);
    expect(rootCard.classList.contains('ut-selected')).toBe(false);

    fireEvent.click(rootCard.querySelector('.cc-select-checkbox input'));
    expect(onToggleSelect).toHaveBeenCalledWith('collection', 'root1');

    fireEvent.click(folder.querySelector('.cc-select-checkbox input'));
    expect(onToggleSelect).toHaveBeenCalledWith('folder', 'f1');
  });

  it('lets a collection inside a folder be selected on its own', async () => {
    const onToggleSelect = vi.fn();
    const { container } = await renderList(NESTED_STORAGE, {
      selectionMode: true,
      selectedFolderIds: new Set(),
      selectedCollectionIds: new Set(['nested1']),
      onToggleSelect,
    });

    const nestedBox = container.querySelector(
      '.cc-folder[data-folder-id="f1"] .cc-folder-body .cc-collection[data-id="nested1"] .cc-select-checkbox input'
    );
    expect(nestedBox).toBeTruthy();
    expect(nestedBox.checked).toBe(true);

    fireEvent.click(nestedBox);
    expect(onToggleSelect).toHaveBeenCalledWith('collection', 'nested1');
  });
});
