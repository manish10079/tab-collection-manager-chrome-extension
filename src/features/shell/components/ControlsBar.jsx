import { CreateSlide } from './CreateSlide.jsx';
import { SearchSlide } from './SearchSlide.jsx';
import { SortMenu } from './SortMenu.jsx';

/**
 * @typedef {object} ControlsBarProps
 * @property {import('../hooks/useShellController.js').ShellController} controller
 * @property {string} collectionSortType
 * @property {boolean} isGrid
 * @property {import('../../../store/schema.js').SessionBackup|null} backup
 * @property {() => void} onOpenHistory
 * @property {boolean} selectionMode
 * @property {number} selectedCount
 * @property {() => void} onToggleSelectionMode
 * @property {() => void} onDeleteSelected
 * @property {() => void} onCancelSelection
 */

/**
 * The controls bar: the default actions row, the search/create slides and the collections sort menu.
 * Replaces the legacy markup plus the whole `setupEventListeners` section of popup.js
 * (react-migration-plan.md §8, Phase 5.2).
 *
 * @param {ControlsBarProps} props
 * @returns {import('react').ReactElement}
 */
export function ControlsBar({
  controller,
  collectionSortType,
  isGrid,
  backup,
  onOpenHistory,
  selectionMode,
  selectedCount,
  onToggleSelectionMode,
  onDeleteSelected,
  onCancelSelection,
}) {
  const { slide } = controller;
  const hasBackup = Boolean(backup && Array.isArray(backup.tabs) && backup.tabs.length > 0);
  const restoreTitle = hasBackup
    ? `Restore Previous Session\n${backup.tabs.length} ${
        backup.tabs.length === 1 ? 'tab' : 'tabs'
      } — "${backup.name || 'Unknown'}"`
    : 'Restore Previous Session';

  return (
    <div className="controls">
      <div className="compact-controls-row">
        {/* The default row stays mounted and is hidden while a slide is open, so the slide's
            mount/unmount animation matches the legacy show/hide. */}
        <div
          className={`actions-bar-default${slide || selectionMode ? ' hidden' : ''}`}
          id="actionsBarDefault"
        >
          <button
            type="button"
            className="icon-btn"
            id="toggleSearchBtn"
            title="Search Collections or Tabs (Ctrl+F)"
            aria-label="Search collections or tabs"
            onClick={controller.toggleSearch}
          >
            <i className="fas fa-search" aria-hidden="true" />
          </button>
          <button
            type="button"
            className="icon-btn"
            id="toggleCreateBtn"
            title="Create New Collection (Ctrl+N)"
            aria-label="Create new collection"
            onClick={controller.toggleCreate}
          >
            <i className="fas fa-plus" aria-hidden="true" />
          </button>
          <button
            type="button"
            className="icon-btn"
            id="createFolderBtn"
            title="New Folder"
            aria-label="Create new folder"
            onClick={controller.createFolder}
          >
            <i className="fas fa-folder-plus" aria-hidden="true" />
          </button>
          <button
            type="button"
            className="icon-btn"
            id="toggleSelectBtn"
            title="Select folders or collections to delete"
            aria-label="Select items to delete"
            onClick={onToggleSelectionMode}
          >
            <i className="fas fa-check-double" aria-hidden="true" />
          </button>
          <button
            type="button"
            className="icon-btn"
            id="globalImportBtn"
            title="Import All Collections (JSON)"
            aria-label="Import all collections"
            onClick={controller.importAll}
          >
            <i className="fas fa-file-import" aria-hidden="true" />
          </button>
          <button
            type="button"
            className="icon-btn"
            id="globalExportBtn"
            title="Export All Collections (JSON)"
            aria-label="Export all collections"
            onClick={controller.exportAll}
          >
            <i className="fas fa-file-export" aria-hidden="true" />
          </button>
          <button
            type="button"
            className="icon-btn"
            id="toggleLayoutBtn"
            title={isGrid ? 'Switch to List View' : 'Switch to Grid View'}
            aria-label={isGrid ? 'Switch to list view' : 'Switch to grid view'}
            onClick={controller.toggleLayout}
          >
            <i className={isGrid ? 'fas fa-list' : 'fas fa-th-large'} aria-hidden="true" />
          </button>

          {/* Visible only when the worker has recorded a restorable backup. */}
          <button
            type="button"
            className={`icon-btn btn-restore${hasBackup ? '' : ' hidden'}`}
            id="restoreBackupBtn"
            title={restoreTitle}
            aria-label="Restore previous session"
            onClick={controller.restoreBackup}
          >
            <i className="fas fa-undo" aria-hidden="true" />
          </button>

          <SortMenu active={collectionSortType} onSelect={controller.setCollectionSort} />

          <button
            type="button"
            className="icon-btn"
            id="historyBtn"
            title="Session History"
            aria-label="Session history"
            onClick={onOpenHistory}
          >
            <i className="fas fa-history" aria-hidden="true" />
          </button>
        </div>

        {selectionMode ? (
          <div className="selection-bar" id="selectionBar">
            <span className="selection-count">{selectedCount} selected</span>
            <button
              type="button"
              className="selection-delete"
              id="deleteSelectedBtn"
              disabled={selectedCount === 0}
              onClick={onDeleteSelected}
            >
              <i className="fas fa-trash" aria-hidden="true" /> Delete selected
            </button>
            <button
              type="button"
              className="icon-btn"
              id="cancelSelectionBtn"
              title="Cancel selection"
              aria-label="Cancel selection"
              onClick={onCancelSelection}
            >
              <i className="fas fa-times" aria-hidden="true" />
            </button>
          </div>
        ) : null}

        {slide === 'search' ? (
          <SearchSlide
            query={controller.query}
            onQueryChange={controller.setQuery}
            onClose={controller.closeSearch}
          />
        ) : null}

        {slide === 'create' ? (
          <CreateSlide
            name={controller.createName}
            onNameChange={controller.setCreateName}
            onSubmit={controller.submitCreate}
            onCancel={controller.closeCreate}
          />
        ) : null}
      </div>
    </div>
  );
}
