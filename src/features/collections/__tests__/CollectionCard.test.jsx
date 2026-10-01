import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CollectionCard } from '../components/CollectionCard.jsx';
import { CURRENT_SESSION_ID } from '../../../shared/storage-keys.js';

/** @param {Partial<import('../../../store/schema.js').Collection>} [overrides] */
function makeCollection(overrides = {}) {
  return {
    id: 'c1',
    name: 'Research',
    tabs: [
      { id: 't1', title: 'Alpha', url: 'https://alpha.test', pinned: false },
      { id: 't2', title: 'Beta', url: 'https://beta.test', pinned: false },
    ],
    updatedAt: Date.now(),
    isExpanded: false,
    ...overrides,
  };
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
  };
}

function renderCard(collection, extra = {}) {
  const actions = makeActions();
  const view = render(
    <CollectionCard
      collection={collection}
      isAutoSaveTarget={false}
      isGrid={false}
      actions={actions}
      {...extra}
    />
  );
  return { actions, ...view };
}

describe('CollectionCard', () => {
  it('renders the name, tab count and relative time', () => {
    renderCard(makeCollection());

    expect(screen.getByDisplayValue('Research')).toBeTruthy();
    expect(screen.getByText('2 tabs')).toBeTruthy();
    expect(screen.getByText('just now')).toBeTruthy();
  });

  it('asks the store to expand when the header or chevron is used', async () => {
    const user = userEvent.setup();
    const { actions } = renderCard(makeCollection());

    await user.click(screen.getByRole('button', { name: /expand collection/i }));
    expect(actions.setExpanded).toHaveBeenCalledWith('c1', true);
    expect(actions.setExpanded).toHaveBeenCalledTimes(1);
  });

  it('renders the tab panel collapsed until the collection is expanded', () => {
    const collapsed = renderCard(makeCollection());
    expect(collapsed.container.querySelector('.collection-tabs')?.className).toBe(
      'collection-tabs'
    );
    collapsed.unmount();

    const expanded = renderCard(makeCollection({ isExpanded: true }));
    expect(expanded.container.querySelector('.collection-tabs')?.className).toBe(
      'collection-tabs expanded'
    );
  });

  it('filters its tabs from the per-collection search box', async () => {
    const user = userEvent.setup();
    renderCard(makeCollection({ isExpanded: true }));

    expect(screen.getByDisplayValue('Alpha')).toBeTruthy();
    expect(screen.getByDisplayValue('Beta')).toBeTruthy();

    await user.type(screen.getByPlaceholderText('Search tabs…'), 'alpha');
    expect(screen.getByDisplayValue('Alpha')).toBeTruthy();
    expect(screen.queryByDisplayValue('Beta')).toBeNull();
  });

  it('hides destructive actions for the Current Session collection', () => {
    renderCard(makeCollection({ id: CURRENT_SESSION_ID, name: 'Current Session' }));

    expect(screen.queryByTitle('Pin Collection')).toBeNull();
    expect(screen.queryByTitle('Delete collection')).toBeNull();
    expect(screen.getByDisplayValue('Current Session').readOnly).toBe(true);
  });

  it('wires the pin button and the collection menu to the injected actions', async () => {
    const user = userEvent.setup();
    const { actions } = renderCard(makeCollection());

    await user.click(screen.getByTitle('Pin Collection'));
    expect(actions.pinCollection).toHaveBeenCalledWith('c1');

    await user.click(screen.getByTitle('Collection options'));
    await user.click(screen.getByTitle('Open all tabs'));
    expect(actions.openAllTabs).toHaveBeenCalledWith('c1');
  });
});
