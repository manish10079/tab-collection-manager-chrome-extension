import { useEffect, useRef, useState } from 'react';
import { CURRENT_SESSION_ID } from '../../../shared/storage-keys.js';
import { resolveFaviconUrl, toOpenableUrl, truncateUrl } from '../../../lib/url.js';
import { resolveTabGroupBadge } from '../../../lib/tabGroups.js';
import { useExtensionId } from '../hooks/useExtensionId.js';
import { useDismissable } from '../hooks/useDismissable.js';

/**
 * @typedef {object} TabRowProps
 * @property {import('../../../store/schema.js').TabItem} tab
 * @property {number} number              1-based position shown in the row
 * @property {import('../../../store/schema.js').Collection} collection  Owner, for group meta
 * @property {import('../hooks/useCollectionActions.js').CollectionActions} actions
 */

/** @param {TabRowProps} props */
export function TabRow({ tab, number, collection, actions }) {
  const extensionId = useExtensionId();
  const isCurrentSession = collection.id === CURRENT_SESSION_ID;
  const [menuOpen, setMenuOpen] = useState(false);
  /** Draft title while the user is editing; null means "not editing". */
  const [draftTitle, setDraftTitle] = useState(null);
  const inputRef = useRef(/** @type {HTMLInputElement|null} */ (null));
  const menuRef = useDismissable(menuOpen, () => setMenuOpen(false));

  const isEditing = draftTitle !== null;
  const title = draftTitle ?? tab.title;

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const badge = resolveTabGroupBadge(tab, collection);

  function commitTitle() {
    const next = (draftTitle ?? '').trim();
    setDraftTitle(null);
    if (!next || next === tab.title) return;
    actions.renameTab(collection.id, tab.id, next);
  }

  function handleTitleKeyDown(event) {
    if (event.key === 'Enter') {
      commitTitle();
      event.currentTarget.blur();
    } else if (event.key === 'Escape') {
      setDraftTitle(null);
      event.currentTarget.blur();
    }
  }

  function handleTitleClick() {
    if (!isEditing) actions.openTab(toOpenableUrl(tab.url), { active: true });
  }

  /** Pick a menu entry: run it and close the menu. */
  const choose = (action) => () => {
    setMenuOpen(false);
    action();
  };

  return (
    <div className={`tab-item${tab.pinned ? ' pinned' : ''}`} data-id={tab.id} draggable="false">
      <div className="tab-drag-handle drag-handle" title="Drag to reorder tab">
        <i className="fas fa-grip-vertical" />
      </div>
      <span className="tab-number">{number}</span>

      <div className="tab-icon">
        {/* Pointer convenience — the tab menu's "Open tab" button is the keyboard path. */}
        {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions */}
        <img
          className="tab-favicon-img"
          src={resolveFaviconUrl(tab.url, extensionId)}
          alt=""
          onClick={() => actions.openTab(toOpenableUrl(tab.url), { active: true })}
          onError={(event) => {
            event.currentTarget.src = 'icons/icon16.png';
          }}
        />
      </div>

      <div className={`tab-group-badge${badge.visible ? '' : ' hidden'}`} title={badge.title}>
        <span className="tab-group-dot" style={{ background: badge.color }} />
        <span className={`tab-group-name${badge.label ? '' : ' hidden'}`}>{badge.label}</span>
      </div>

      <div className="tab-content">
        <input
          ref={inputRef}
          type="text"
          className="tab-title"
          value={title}
          placeholder="Untitled"
          readOnly={!isEditing}
          onChange={(event) => setDraftTitle(event.target.value)}
          onKeyDown={handleTitleKeyDown}
          onBlur={commitTitle}
          onClick={handleTitleClick}
        />
        {/* Pointer convenience — the tab menu's "Copy link" entry is the keyboard path. */}
        {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
        <div className="tab-url" title={tab.url} onClick={() => actions.copyTabUrl(tab.url)}>
          {truncateUrl(tab.url)}
        </div>
      </div>

      <div className="tab-menu-container" ref={menuRef}>
        {isCurrentSession ? null : (
          <button
            type="button"
            className={`icon-btn pin-tab-btn${tab.pinned ? ' pinned' : ''}`}
            title={tab.pinned ? 'Unpin Tab' : 'Pin Tab'}
            aria-pressed={!!tab.pinned}
            onClick={() => actions.pinTab(collection.id, tab.id)}
          >
            <i className="fas fa-thumbtack" />
          </button>
        )}

        <button
          type="button"
          className="icon-btn tab-menu-btn"
          title="Tab options"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((open) => !open)}
        >
          <i className="fas fa-ellipsis-v" />
        </button>

        <div className={`tab-dropdown-menu${menuOpen ? '' : ' hidden'}`}>
          <button
            type="button"
            className="dropdown-option edit-tab-btn"
            title="Edit tab title"
            onClick={choose(() => setDraftTitle(tab.title))}
          >
            <i className="fas fa-edit" /> Edit tab title
          </button>
          <button
            type="button"
            className="dropdown-option open-tab-btn"
            title="Open tab in background"
            onClick={choose(() => actions.openTab(toOpenableUrl(tab.url), { active: false }))}
          >
            <i className="fas fa-external-link-alt" /> Open tab
          </button>
          <button
            type="button"
            className="dropdown-option copy-tab-link-btn"
            title="Copy tab link"
            onClick={choose(() => actions.copyTabUrl(tab.url))}
          >
            <i className="fas fa-link" /> Copy link
          </button>
          <button
            type="button"
            className="dropdown-option remove-tab-btn"
            title="Remove tab"
            onClick={choose(() => actions.removeTab(collection.id, tab.id))}
          >
            <i className="fas fa-trash" /> Remove tab
          </button>
        </div>
      </div>
    </div>
  );
}
