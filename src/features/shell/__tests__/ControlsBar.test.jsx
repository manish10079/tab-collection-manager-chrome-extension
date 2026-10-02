import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ControlsBar } from '../components/ControlsBar.jsx';

/** @param {Partial<import('../hooks/useShellController.js').ShellController>} [overrides] */
function makeController(overrides = {}) {
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
    ...overrides,
  };
}

const BACKUP = { collectionId: 'a', name: 'Alpha', tabs: [{ id: 't1' }, { id: 't2' }] };

/** @param {object} [props] */
function renderBar(props = {}) {
  const controller = props.controller ?? makeController();
  const onOpenHistory = props.onOpenHistory ?? vi.fn();
  const view = render(
    <ControlsBar
      controller={controller}
      collectionSortType={props.collectionSortType ?? 'custom'}
      isGrid={props.isGrid ?? false}
      backup={props.backup ?? null}
      onOpenHistory={onOpenHistory}
    />
  );
  return { ...view, controller, onOpenHistory };
}

describe('ControlsBar', () => {
  it('shows the default actions row when no slide is open', () => {
    renderBar();

    expect(document.getElementById('actionsBarDefault').classList.contains('ut-hidden')).toBe(
      false
    );
    expect(document.getElementById('toggleSearchBtn')).toBeTruthy();
    expect(document.getElementById('historyBtn')).toBeTruthy();
  });

  it('labels every default control, so the two-row bar stays readable', () => {
    renderBar({ backup: BACKUP });

    // The bar lays out as two rows of five in CSS, which jsdom cannot measure; the labels are the
    // part a unit test can pin down, and the E2E walk proves the buttons still work.
    const labels = [...document.querySelectorAll('#actionsBarDefault .sh-action-label')].map(
      (node) => node.textContent
    );

    expect(labels).toEqual([
      'Search',
      'New',
      'Folder',
      'Select',
      'Import',
      'Export',
      'Grid',
      'Restore',
      'Sort',
      'History',
    ]);
  });

  it('toggles search and create from the default row', () => {
    const { controller } = renderBar();

    fireEvent.click(document.getElementById('toggleSearchBtn'));
    fireEvent.click(document.getElementById('toggleCreateBtn'));

    expect(controller.toggleSearch).toHaveBeenCalledTimes(1);
    expect(controller.toggleCreate).toHaveBeenCalledTimes(1);
  });

  it('opens the session history dialog', () => {
    const { onOpenHistory } = renderBar();

    fireEvent.click(document.getElementById('historyBtn'));

    expect(onOpenHistory).toHaveBeenCalledTimes(1);
  });

  it('hides the default row and shows the search input while searching', () => {
    const setQuery = vi.fn();
    renderBar({ controller: makeController({ slide: 'search', query: 'doc', setQuery }) });

    expect(document.getElementById('actionsBarDefault').classList.contains('ut-hidden')).toBe(true);
    const input = screen.getByPlaceholderText('Search collections or tabs…');
    expect(input.value).toBe('doc');

    fireEvent.change(input, { target: { value: 'docs' } });
    expect(setQuery).toHaveBeenCalledWith('docs');
  });

  it('closes the search slide from its clear button', () => {
    const closeSearch = vi.fn();
    renderBar({ controller: makeController({ slide: 'search', closeSearch }) });

    fireEvent.click(screen.getByTitle('Clear & Close'));

    expect(closeSearch).toHaveBeenCalledTimes(1);
  });

  it('submits the create slide on Enter and on the check button', () => {
    const submitCreate = vi.fn();
    renderBar({ controller: makeController({ slide: 'create', submitCreate }) });

    fireEvent.keyDown(screen.getByPlaceholderText('New collection name'), { key: 'Enter' });
    fireEvent.click(screen.getByTitle('Create'));

    expect(submitCreate).toHaveBeenCalledTimes(2);
  });

  it('reflects and toggles the layout mode', () => {
    const toggleLayout = vi.fn();
    const { unmount } = renderBar({ isGrid: false, controller: makeController({ toggleLayout }) });

    expect(document.getElementById('toggleLayoutBtn').title).toBe('Switch to Grid View');
    fireEvent.click(document.getElementById('toggleLayoutBtn'));
    expect(toggleLayout).toHaveBeenCalledTimes(1);
    unmount();

    renderBar({ isGrid: true });
    expect(document.getElementById('toggleLayoutBtn').title).toBe('Switch to List View');
  });

  it('hides the restore button until a backup exists', () => {
    const { unmount } = renderBar({ backup: null });
    expect(document.getElementById('restoreBackupBtn').classList.contains('ut-hidden')).toBe(true);
    unmount();

    const restoreBackup = vi.fn();
    renderBar({ backup: BACKUP, controller: makeController({ restoreBackup }) });
    const button = document.getElementById('restoreBackupBtn');

    expect(button.classList.contains('ut-hidden')).toBe(false);
    expect(button.title).toContain('2 tabs');
    fireEvent.click(button);
    expect(restoreBackup).toHaveBeenCalledTimes(1);
  });

  it('selects a collection sort mode from the dropdown', () => {
    const setCollectionSort = vi.fn();
    renderBar({ controller: makeController({ setCollectionSort }) });

    fireEvent.click(document.getElementById('collectionSortBtn'));
    fireEvent.click(screen.getByRole('menuitem', { name: /Name \(A-Z\)/ }));

    expect(setCollectionSort).toHaveBeenCalledWith('nameAsc');
  });

  it('moves focus into a slide and back to the toggle that opened it', () => {
    const props = {
      controller: makeController(),
      collectionSortType: 'custom',
      isGrid: false,
      backup: null,
      onOpenHistory: vi.fn(),
    };
    const view = render(<ControlsBar {...props} />);
    const toggle = document.getElementById('toggleSearchBtn');
    toggle.focus();
    expect(document.activeElement).toBe(toggle);

    view.rerender(<ControlsBar {...props} controller={makeController({ slide: 'search' })} />);
    expect(document.activeElement).toBe(screen.getByPlaceholderText('Search collections or tabs…'));

    view.rerender(<ControlsBar {...props} />);
    expect(document.activeElement).toBe(toggle);
  });

  it('gives every icon-only control an accessible name', () => {
    renderBar();

    expect(screen.getByRole('button', { name: 'Search collections or tabs' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Create new collection' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Import all collections' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Export all collections' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Session history' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sort collections' })).toBeTruthy();
  });
});
