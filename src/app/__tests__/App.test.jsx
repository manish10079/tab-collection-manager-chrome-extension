import { describe, expect, it } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { App } from '../App.jsx';
import { publishLegacyHandle } from '../legacy-handle.js';
import { hydrate, mutate } from '../../store/store.js';
import { installChromeMock } from '../../../tests/mocks/chrome.js';
import { CURRENT_SESSION_ID, STORAGE_KEYS } from '../../shared/storage-keys.js';

/** A fresh mount point that mimics the legacy `#collectionsContainer`. */
function mountPoint() {
  document.body.innerHTML = '<div class="collections-container" id="collectionsContainer"></div>';
  return document.getElementById('collectionsContainer');
}

const COLLECTIONS = [
  { id: 'c1', name: 'Research', tabs: [], updatedAt: Date.now() },
  {
    id: CURRENT_SESSION_ID,
    name: 'Current Session',
    tabs: [{ id: 't1', title: 'Open', url: 'https://a.test' }],
  },
];

async function renderApp(storage = {}, { ready = true } = {}) {
  installChromeMock(storage);
  if (ready) await hydrate();
  const mount = mountPoint();
  // `mount` stands in for the real `#collectionsContainer`; RTL renders the tree into its own
  // element, so class assertions must target `mount`.
  return { mount, ...render(<App mountPoint={mount} />) };
}

describe('App', () => {
  it('renders collections from storage with Current Session first', async () => {
    await renderApp({ [STORAGE_KEYS.collections]: COLLECTIONS });

    const cards = document.querySelectorAll('.collection');
    expect(cards).toHaveLength(2);
    expect(cards[0].dataset.id).toBe(CURRENT_SESSION_ID);
    expect(cards[1].dataset.id).toBe('c1');
    expect(screen.getByDisplayValue('Research')).toBeTruthy();
  });

  it('shows the empty state when there is nothing to list', async () => {
    await renderApp({ [STORAGE_KEYS.collections]: [] });

    expect(screen.getByText('No collections yet')).toBeTruthy();
  });

  it('applies the layout and sort classes the legacy stylesheet expects', async () => {
    const { mount } = await renderApp({
      [STORAGE_KEYS.collections]: COLLECTIONS,
      [STORAGE_KEYS.layoutViewMode]: 'grid',
      [STORAGE_KEYS.collectionSortType]: 'nameAsc',
    });

    expect(mount.classList.contains('grid-view')).toBe(true);
    expect(mount.classList.contains('sort-active')).toBe(true);
  });

  it('opens the grid-view modal for the expanded collection', async () => {
    await renderApp({
      [STORAGE_KEYS.collections]: COLLECTIONS.map((collection) =>
        collection.id === 'c1' ? { ...collection, isExpanded: true } : collection
      ),
      [STORAGE_KEYS.layoutViewMode]: 'grid',
    });

    expect(document.querySelector('.modal-overlay .view-collection-modal')).toBeTruthy();
    // In grid view the card itself renders no tab panel.
    expect(document.querySelector('.collection[data-id="c1"] .collection-tabs')).toBeNull();
  });

  it('applies the persisted theme to the document', async () => {
    await renderApp({ [STORAGE_KEYS.theme]: 'light' });

    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('opens the settings modal when the legacy handle asks', async () => {
    publishLegacyHandle();
    await renderApp({});
    expect(screen.queryByRole('dialog')).toBeNull();

    await act(async () => {
      globalThis.__tcmReact.openSettings();
    });

    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByText(/Settings/)).toBeTruthy();
  });

  it('re-renders from the store after a mutation', async () => {
    await renderApp({ [STORAGE_KEYS.collections]: COLLECTIONS });

    await act(async () => {
      await mutate((draft) => {
        draft.collections = draft.collections.map((collection) =>
          collection.id === 'c1' ? { ...collection, name: 'Renamed' } : collection
        );
      });
    });

    expect(document.querySelector('.collection[data-id="c1"] input').value).toBe('Renamed');
  });
});
