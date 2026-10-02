import { useEffect, useRef, useState } from 'react';
import { CURRENT_SESSION_ID } from '../../../shared/storage-keys.js';
import { formatTabCount, formatTime } from '../../../lib/format.js';
import { useDismissable } from '../../../app/hooks/useDismissable.js';
import { useDraggable } from '../hooks/useDraggable.js';
import { useDropZone } from '../hooks/useDropZone.js';
import { TabPanel } from './TabPanel.jsx';

/**
 * @typedef {object} CollectionCardProps
 * @property {import('../../../store/schema.js').Collection} collection
 * @property {boolean} isAutoSaveTarget
 * @property {boolean} isGrid           Grid view moves the tab panel into a modal
 * @property {import('../../../store/schema.js').Folder[]} [folders] Every folder, for the move menu
 * @property {import('../hooks/useCollectionActions.js').CollectionActions} actions
 * @property {boolean} [selectionMode]  Show the bulk-delete checkbox
 * @property {boolean} [isSelected]
 * @property {(kind: 'folder'|'collection', id: string) => void} [onToggleSelect]
 */

/**
 * One collection row: header (drag handle, expand, name, meta, actions) plus, in list view,
 * its tab panel. Replaces the legacy `renderCollection` template clone.
 *
 * @param {CollectionCardProps} props
 * @returns {import('react').ReactElement}
 */
export function CollectionCard({
  collection,
  isAutoSaveTarget,
  isGrid,
  actions,
  folders = [],
  selectionMode = false,
  isSelected = false,
  onToggleSelect,
}) {
  const isCurrentSession = collection.id === CURRENT_SESSION_ID;
  const [menuOpen, setMenuOpen] = useState(false);
  /** Draft name while editing; null means "not editing". */
  const [draftName, setDraftName] = useState(null);
  const nameRef = useRef(/** @type {HTMLInputElement|null} */ (null));
  const menuRef = useDismissable(menuOpen, () => setMenuOpen(false));

  const isEditingName = draftName !== null;
  const name = draftName ?? collection.name;

  useEffect(() => {
    if (isEditingName && nameRef.current) {
      nameRef.current.focus();
      nameRef.current.select();
    }
  }, [isEditingName]);

  // Dragging the card reorders collections; dropping onto it takes a whole collection or a
  // tab from another collection (a tab from this one is reordered between its own rows).
  const { isDragging, dragProps, handleProps } = useDraggable({
    type: 'collection',
    id: collection.id,
  });
  const { isDragOver, dropProps } = useDropZone({
    accepts: (item) =>
      item.type === 'collection'
        ? item.id !== collection.id
        : item.type === 'tab' && item.sourceCollectionId !== collection.id,
    onDrop: (item) => {
      if (item.type === 'collection') actions.moveCollection(item.id, collection.id);
      else actions.moveTab(item.id, item.sourceCollectionId, collection.id);
    },
  });

  const classNames = ['collection'];
  if (isCurrentSession) classNames.push('current-session-collection');
  if (collection.pinned && !isCurrentSession) classNames.push('pinned');
  if (isAutoSaveTarget) classNames.push('auto-save-target');
  if (isDragging) classNames.push('dragging');
  if (isDragOver) classNames.push('drag-over');
  if (isSelected) classNames.push('selected');

  function toggleExpanded() {
    actions.setExpanded(collection.id, !collection.isExpanded);
  }

  function handleHeaderClick(event) {
    if (event.target.tagName === 'INPUT') return;
    if (event.target.closest('.collection-actions')) return;
    toggleExpanded();
  }

  function commitName() {
    const next = (draftName ?? '').trim();
    setDraftName(null);
    if (!next || next === collection.name) return;
    actions.renameCollection(collection.id, next);
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

  return (
    <div className={classNames.join(' ')} data-id={collection.id} {...dragProps} {...dropProps}>
      {/* Clicking anywhere in the header toggles the collection as a pointer convenience —
          the chevron button below is the keyboard-accessible control. */}
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
      <div className="collection-header" onClick={handleHeaderClick}>
        <div className="collection-left-section">
          {selectionMode ? (
            <label className="select-checkbox" title={`Select ${collection.name}`}>
              <input
                type="checkbox"
                checked={isSelected}
                disabled={isCurrentSession}
                aria-label={`Select ${collection.name}`}
                onChange={() => onToggleSelect?.('collection', collection.id)}
              />
            </label>
          ) : null}
          <div
            className="collection-drag-handle drag-handle"
            title="Drag to reorder collection"
            {...handleProps}
          >
            <i className="fas fa-grip-vertical" />
          </div>
          <button
            type="button"
            className={`expand-btn${collection.isExpanded ? ' rotated' : ''}`}
            aria-expanded={!!collection.isExpanded}
            aria-label={collection.isExpanded ? 'Collapse collection' : 'Expand collection'}
            onClick={(event) => {
              event.stopPropagation();
              toggleExpanded();
            }}
          >
            <i className="fas fa-chevron-right" />
          </button>
          <input
            ref={nameRef}
            type="text"
            className="collection-name"
            value={name}
            maxLength={50}
            readOnly={isCurrentSession || !isEditingName}
            title={
              isCurrentSession
                ? 'Current Session collection cannot be renamed or have tabs added'
                : undefined
            }
            onChange={(event) => setDraftName(event.target.value)}
            onKeyDown={handleNameKeyDown}
            onBlur={commitName}
          />
        </div>

        <div className="collection-right-section">
          <div className="collection-meta">
            <span className="tab-count">{formatTabCount(collection.tabs.length)}</span>
            <span className="meta-dot">•</span>
            <span className="updated-time">{formatTime(collection.updatedAt)}</span>
          </div>

          <div className="collection-actions" ref={menuRef}>
            {isCurrentSession ? null : (
              <button
                type="button"
                className={`icon-btn pin-collection-btn${collection.pinned ? ' pinned' : ''}`}
                title={collection.pinned ? 'Unpin Collection' : 'Pin Collection'}
                aria-pressed={!!collection.pinned}
                onClick={() => actions.pinCollection(collection.id)}
              >
                <i className="fas fa-thumbtack" />
              </button>
            )}

            <button
              type="button"
              className="icon-btn collection-menu-btn"
              title="Collection options"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((open) => !open)}
            >
              <i className="fas fa-ellipsis-v" />
            </button>

            <div className={`collection-dropdown-menu${menuOpen ? '' : ' hidden'}`}>
              <button
                type="button"
                className="dropdown-option open-all-tabs-btn"
                title="Open all tabs"
                onClick={choose(() => actions.openAllTabs(collection.id))}
              >
                <i className="fas fa-external-link-square-alt" /> Open all tabs
              </button>
              {isCurrentSession ? null : (
                <button
                  type="button"
                  className="dropdown-option edit-collection-btn"
                  title="Edit collection name"
                  onClick={choose(() => setDraftName(collection.name))}
                >
                  <i className="fas fa-pen" /> Edit collection name
                </button>
              )}
              {isCurrentSession ? null : (
                <button
                  type="button"
                  className="dropdown-option add-tabs-btn"
                  title="Add tabs to the collection"
                  onClick={choose(() => actions.addTabs(collection.id))}
                >
                  <i className="fas fa-plus" /> Add new tab
                </button>
              )}
              {folders.length > 0 && !isCurrentSession ? (
                <>
                  <div className="dropdown-section-label">Move to folder</div>
                  {folders.map((folder) => (
                    <button
                      key={folder.id}
                      type="button"
                      className="dropdown-option move-to-folder-btn"
                      title={`Move to ${folder.name}`}
                      disabled={collection.folderId === folder.id}
                      onClick={choose(() =>
                        actions.moveCollectionToFolder(collection.id, folder.id)
                      )}
                    >
                      <i className="fas fa-folder" /> {folder.name}
                    </button>
                  ))}
                  {collection.folderId ? (
                    <button
                      type="button"
                      className="dropdown-option remove-from-folder-btn"
                      title="Move to the root list"
                      onClick={choose(() => actions.moveCollectionToFolder(collection.id, null))}
                    >
                      <i className="fas fa-folder-minus" /> Remove from folder
                    </button>
                  ) : null}
                </>
              ) : null}
              <button
                type="button"
                className="dropdown-option share-collection-btn"
                title="Share collection"
                onClick={choose(() => actions.copyCollectionLinks(collection))}
              >
                <i className="fas fa-share-alt" /> Share collection
              </button>
              {isCurrentSession ? null : (
                <button
                  type="button"
                  className="dropdown-option delete-collection-btn"
                  title="Delete collection"
                  onClick={choose(() => actions.deleteCollection(collection.id))}
                >
                  <i className="fas fa-trash" /> Remove collection
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {isGrid ? null : <TabPanel collection={collection} actions={actions} />}
    </div>
  );
}
