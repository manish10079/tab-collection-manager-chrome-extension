import { useEffect, useRef, useState } from 'react';
import { formatTabCount } from '../../../lib/format.js';
import { useDismissable } from '../../../app/hooks/useDismissable.js';
import { useDropZone } from '../hooks/useDropZone.js';
import { CollectionCard } from './CollectionCard.jsx';

/**
 * @typedef {object} FolderSectionProps
 * @property {import('../../../store/schema.js').Folder} folder
 * @property {import('../../../store/schema.js').Collection[]} collections The folder's collections
 * @property {import('../../../store/schema.js').Folder[]} folders         Every folder, for the cards' move menu
 * @property {boolean} isGrid
 * @property {string|null} autoSaveCollectionId
 * @property {import('../hooks/useCollectionActions.js').CollectionActions} actions
 * @property {boolean} [selectionMode]  Show the bulk-delete checkbox
 * @property {boolean} [isSelected]     Whether this folder itself is selected
 * @property {Set<string>} [selectedCollectionIds] The nested cards' selection, so a collection
 *   inside a folder can be checked on its own rather than only through its folder
 * @property {(kind: 'folder'|'collection', id: string) => void} [onToggleSelect]
 */

/**
 * One folder: its header (expand, name, counts, menu) and the collections inside it. Reuses the
 * legacy class names for the shared controls (`.icon-btn`, `.expand-btn`, the dropdown) so the
 * migrated stylesheet still styles them; the folder-specific rules live in `shell.css`.
 *
 * The whole section is a drop target: dropping a collection on it moves that collection in.
 *
 * @param {FolderSectionProps} props
 * @returns {import('react').ReactElement}
 */
export function FolderSection({
  folder,
  collections,
  folders,
  isGrid,
  autoSaveCollectionId,
  actions,
  selectionMode = false,
  isSelected = false,
  selectedCollectionIds,
  onToggleSelect,
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  /** Draft name while editing; null means "not editing". */
  const [draftName, setDraftName] = useState(null);
  const nameRef = useRef(/** @type {HTMLInputElement|null} */ (null));
  const menuRef = useDismissable(menuOpen, () => setMenuOpen(false));

  const isEditingName = draftName !== null;
  const name = draftName ?? folder.name;
  const tabCount = collections.reduce(
    (total, collection) => total + (collection.tabs ? collection.tabs.length : 0),
    0
  );

  useEffect(() => {
    if (isEditingName && nameRef.current) {
      nameRef.current.focus();
      nameRef.current.select();
    }
  }, [isEditingName]);

  const { isDragOver, dropProps } = useDropZone({
    accepts: (item) => item.type === 'collection' && item.id !== folder.id,
    onDrop: (item) => actions.moveCollectionToFolder(item.id, folder.id),
  });

  function toggleExpanded() {
    actions.setFolderExpanded(folder.id, !folder.isExpanded);
  }

  function handleHeaderClick(event) {
    if (event.target.tagName === 'INPUT') return;
    if (event.target.closest('.collection-actions')) return;
    toggleExpanded();
  }

  function commitName() {
    const next = (draftName ?? '').trim();
    setDraftName(null);
    if (!next || next === folder.name) return;
    actions.renameFolder(folder.id, next);
  }

  function handleNameKeyDown(event) {
    if (event.key === 'Enter') {
      commitName();
      event.currentTarget.blur();
    } else if (event.key === 'Escape') {
      setDraftName(null);
      event.currentTarget.blur();
    }
  }

  /** Pick a menu entry: run it and close the menu. */
  const choose = (action) => () => {
    setMenuOpen(false);
    action();
  };

  const classNames = ['folder'];
  if (isDragOver) classNames.push('ut-drag-over');
  if (isSelected) classNames.push('ut-selected');

  return (
    <div className={classNames.join(' ')} data-folder-id={folder.id} {...dropProps}>
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
      <div className="folder-header" onClick={handleHeaderClick}>
        <div className="folder-left-section">
          {selectionMode ? (
            <label className="select-checkbox" title={`Select ${folder.name}`}>
              <input
                type="checkbox"
                checked={isSelected}
                aria-label={`Select ${folder.name}`}
                onChange={() => onToggleSelect?.('folder', folder.id)}
              />
            </label>
          ) : null}
          <button
            type="button"
            className={`expand-btn${folder.isExpanded ? ' ut-rotated' : ''}`}
            aria-expanded={!!folder.isExpanded}
            aria-label={folder.isExpanded ? 'Collapse folder' : 'Expand folder'}
            onClick={(event) => {
              event.stopPropagation();
              toggleExpanded();
            }}
          >
            <i className="fas fa-chevron-right" />
          </button>
          <i
            className={`fas ${folder.isExpanded ? 'fa-folder-open' : 'fa-folder'} folder-icon`}
            aria-hidden="true"
          />
          <input
            ref={nameRef}
            type="text"
            className="collection-name folder-name"
            value={name}
            maxLength={100}
            readOnly={!isEditingName}
            title="Folder name"
            aria-label="Folder name"
            onChange={(event) => setDraftName(event.target.value)}
            onKeyDown={handleNameKeyDown}
            onBlur={commitName}
          />
        </div>

        <div className="folder-right-section">
          <div className="collection-actions" ref={menuRef}>
            <button
              type="button"
              className="icon-btn folder-menu-btn"
              title="Folder options"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((open) => !open)}
            >
              <i className="fas fa-ellipsis-v" />
            </button>

            <div className={`collection-dropdown-menu${menuOpen ? '' : ' ut-hidden'}`}>
              <button
                type="button"
                className="dropdown-option edit-folder-btn"
                title="Edit folder name"
                onClick={choose(() => setDraftName(folder.name))}
              >
                <i className="fas fa-pen" /> Edit folder name
              </button>
              <button
                type="button"
                className="dropdown-option delete-folder-btn"
                title="Delete folder and the collections inside it"
                onClick={choose(() => actions.deleteFolder(folder.id))}
              >
                <i className="fas fa-trash" /> Remove folder
              </button>
            </div>
          </div>
        </div>
      </div>

      {folder.isExpanded ? (
        <div className="folder-body">
          {collections.length === 0 ? (
            <p className="folder-empty">Empty folder — drag collections here.</p>
          ) : (
            <>
              {/* The counts live in the body so the header stays a single row; a collapsed folder
                  hides them along with its contents. */}
              <p className="folder-summary">
                <span>
                  {collections.length} {collections.length === 1 ? 'collection' : 'collections'}
                </span>
                <span className="meta-dot">•</span>
                <span>{formatTabCount(tabCount)}</span>
              </p>
              {collections.map((collection) => (
                <CollectionCard
                  key={collection.id}
                  collection={collection}
                  folders={folders}
                  isGrid={isGrid}
                  isAutoSaveTarget={collection.id === autoSaveCollectionId}
                  actions={actions}
                  selectionMode={selectionMode}
                  isSelected={selectedCollectionIds?.has(collection.id) ?? false}
                  onToggleSelect={onToggleSelect}
                />
              ))}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
