import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { DragAndDropProvider } from '../hooks/DragAndDropContext.jsx';
import { CollectionCard } from '../components/CollectionCard.jsx';

/**
 * Drag-and-drop routing as the user performs it: pointer-down arms the handle, the drag
 * starts on the row or card, and the drop lands on another target. Nothing here calls the
 * mutators — the assertion is which action the gesture resolves to, which is exactly the
 * wiring the deleted legacy handlers used to carry.
 */

/** @param {Partial<import('../../../store/schema.js').Collection>} [overrides] */
function makeCollection(overrides = {}) {
  return {
    id: 'c1',
    name: 'Research',
    tabs: [],
    updatedAt: Date.now(),
    isExpanded: true,
    ...overrides,
  };
}

/** @param {string} id */
function makeTab(id) {
  return { id, title: id.toUpperCase(), url: `https://${id}.test`, pinned: false };
}

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
  };
}

/** @param {Array<Partial<import('../../../store/schema.js').Collection>>} collections */
function renderCards(collections) {
  const actions = makeActions();
  const view = render(
    <DragAndDropProvider>
      {collections.map((collection) => (
        <CollectionCard
          key={collection.id}
          collection={makeCollection(collection)}
          isAutoSaveTarget={false}
          isGrid={false}
          actions={actions}
        />
      ))}
    </DragAndDropProvider>
  );
  return { actions, ...view };
}

/** The `.collection` element owning a collection-name input. @param {string} name */
function cardOf(name) {
  return /** @type {HTMLElement} */ (screen.getByDisplayValue(name).closest('.collection'));
}

/** The `.tab-item` element owning a tab-title input. @param {string} title */
function rowOf(title) {
  return /** @type {HTMLElement} */ (screen.getByDisplayValue(title).closest('.tab-item'));
}

/**
 * Reproduce the full gesture: arm the handle, drag, hover the target, drop.
 *
 * @param {HTMLElement} source Row or card being dragged
 * @param {HTMLElement} target Row or card receiving the drop
 */
function dragOnto(source, target) {
  const handle = source.querySelector('.drag-handle');
  fireEvent.pointerDown(handle);
  fireEvent.dragStart(source);
  fireEvent.dragOver(target);
  fireEvent.drop(target);
}

describe('collection drag and drop', () => {
  it('reorders the collections when a card is dropped on another card', () => {
    const { actions } = renderCards([
      { id: 'c1', name: 'Research' },
      { id: 'c2', name: 'Reading' },
    ]);

    dragOnto(cardOf('Research'), cardOf('Reading'));

    expect(actions.moveCollection).toHaveBeenCalledWith('c1', 'c2');
  });

  it('ignores a card dropped on itself', () => {
    const { actions } = renderCards([{ id: 'c1', name: 'Research' }]);

    dragOnto(cardOf('Research'), cardOf('Research'));

    expect(actions.moveCollection).not.toHaveBeenCalled();
  });

  it('takes a tab from another collection dropped anywhere on the card', () => {
    const { actions } = renderCards([
      { id: 'c1', name: 'Research', tabs: [makeTab('t1')] },
      { id: 'c2', name: 'Reading', tabs: [makeTab('t2')] },
    ]);

    dragOnto(rowOf('T1'), cardOf('Reading'));

    expect(actions.moveTab).toHaveBeenCalledWith('t1', 'c1', 'c2');
    expect(actions.reorderTabs).not.toHaveBeenCalled();
  });

  it('refuses a tab dropped back on its own card', () => {
    const { actions } = renderCards([
      { id: 'c1', name: 'Research', tabs: [makeTab('t1'), makeTab('t2')] },
    ]);

    const card = cardOf('Research');
    dragOnto(rowOf('T1'), card);

    expect(actions.moveTab).not.toHaveBeenCalled();
    expect(card.className).not.toContain('ut-drag-over');
  });

  it('marks the dragged card and the hovered target', () => {
    renderCards([
      { id: 'c1', name: 'Research' },
      { id: 'c2', name: 'Reading' },
    ]);

    const source = cardOf('Research');
    const target = cardOf('Reading');
    fireEvent.pointerDown(source.querySelector('.drag-handle'));
    fireEvent.dragStart(source);
    fireEvent.dragOver(target);

    expect(source.className).toContain('ut-dragging');
    expect(target.className).toContain('ut-drag-over');
  });
});

describe('tab drag and drop', () => {
  it('reorders tabs inside one collection when a row is dropped on another row', () => {
    const { actions } = renderCards([
      { id: 'c1', name: 'Research', tabs: [makeTab('t1'), makeTab('t2')] },
    ]);

    dragOnto(rowOf('T2'), rowOf('T1'));

    expect(actions.reorderTabs).toHaveBeenCalledWith('c1', 't2', 't1');
    expect(actions.moveTabToPosition).not.toHaveBeenCalled();
  });

  it('inserts a tab at the dropped row position when the row belongs to another collection', () => {
    const { actions } = renderCards([
      { id: 'c1', name: 'Research', tabs: [makeTab('t1')] },
      { id: 'c2', name: 'Reading', tabs: [makeTab('t2')] },
    ]);

    dragOnto(rowOf('T1'), rowOf('T2'));

    expect(actions.moveTabToPosition).toHaveBeenCalledWith('t1', 'c1', 'c2', 't2');
    expect(actions.moveTab).not.toHaveBeenCalled();
  });

  it('ignores a row dropped on itself', () => {
    const { actions } = renderCards([
      { id: 'c1', name: 'Research', tabs: [makeTab('t1'), makeTab('t2')] },
    ]);

    dragOnto(rowOf('T1'), rowOf('T1'));

    expect(actions.reorderTabs).not.toHaveBeenCalled();
    expect(actions.moveTabToPosition).not.toHaveBeenCalled();
  });
});
