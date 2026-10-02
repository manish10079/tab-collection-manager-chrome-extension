import { describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { App } from '../App.jsx';
import { hydrate, mutate } from '../../store/store.js';
import { installChromeMock } from '../../../tests/mocks/chrome.js';
import { CURRENT_SESSION_ID, STORAGE_KEYS } from '../../shared/storage-keys.js';

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
  return render(<App />);
}

/** The container React renders the collection list into (and styles as list or grid). */
function collectionsContainer() {
  return document.getElementById('collectionsContainer');
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
    await renderApp({
      [STORAGE_KEYS.collections]: COLLECTIONS,
      [STORAGE_KEYS.layoutViewMode]: 'grid',
      [STORAGE_KEYS.collectionSortType]: 'nameAsc',
    });

    expect(collectionsContainer().classList.contains('ut-grid-view')).toBe(true);
    expect(collectionsContainer().classList.contains('ut-sort-active')).toBe(true);
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

  it('opens the settings modal from the header button', async () => {
    await renderApp({});
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(document.getElementById('settingsBtn'));

    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByText(/Settings/)).toBeTruthy();
  });

  it('renders the header and controls bar from the manifest and settings', async () => {
    await renderApp({ [STORAGE_KEYS.collections]: COLLECTIONS });

    expect(document.getElementById('app-name').textContent).toBe('Tab Collection Manager');
    expect(document.getElementById('toggleSearchBtn')).toBeTruthy();
    expect(document.getElementById('historyBtn')).toBeTruthy();
    // No backup in storage, so the restore button stays hidden.
    expect(document.getElementById('restoreBackupBtn').classList.contains('ut-hidden')).toBe(true);
  });

  it('renders global search results and returns to the list when one is opened', async () => {
    await renderApp({ [STORAGE_KEYS.collections]: COLLECTIONS });

    fireEvent.click(document.getElementById('toggleSearchBtn'));
    fireEvent.change(screen.getByPlaceholderText('Search collections or tabs…'), {
      target: { value: 'research' },
    });

    const result = document.querySelector('.search-collection-result');
    expect(result).toBeTruthy();
    expect(result.textContent).toContain('Research');
    // The list is replaced by the results while a query is active.
    expect(collectionsContainer()).toBeNull();

    await act(async () => {
      fireEvent.click(result);
    });

    // Opening a result clears the query, so the list is back.
    expect(collectionsContainer()).toBeTruthy();
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
