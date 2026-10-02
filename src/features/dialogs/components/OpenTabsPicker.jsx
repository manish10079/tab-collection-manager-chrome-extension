import { useState } from 'react';
import { EXTENSION_ID } from '../../../shared/extension-id.js';
import { resolveFaviconUrl, truncateUrl } from '../../../lib/url.js';
import { useOpenTabs } from '../hooks/useOpenTabs.js';

/**
 * @typedef {object} OpenTabsPickerProps
 * @property {string} collectionId
 * @property {import('../hooks/useTabIntake.js').TabIntake} intake
 * @property {() => void} onClose
 */

/**
 * The "Multi-Select" half of the add-tabs modal, replacing the `#openTabTemplate` clones: the
 * current window's tabs render straight from `useOpenTabs`, and selection is a set of tab ids
 * rather than markup the legacy code had to read back out of `data-` attributes.
 *
 * @param {OpenTabsPickerProps} props
 * @returns {import('react').ReactElement}
 */
export function OpenTabsPicker({ collectionId, intake, onClose }) {
  const { tabs, groupsMeta, loading } = useOpenTabs(true);
  const [selectedIds, setSelectedIds] = useState(/** @type {Set<unknown>} */ (new Set()));
  const [busy, setBusy] = useState(false);

  const allSelected = tabs.length > 0 && selectedIds.size === tabs.length;

  function toggleTab(id) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelectedIds(allSelected ? new Set() : new Set(tabs.map((tab) => tab.id)));
  }

  async function handleAddSelected() {
    if (busy || selectedIds.size === 0) return;
    // Keep the legacy payload shape: title/url/groupId only, so a pinned browser tab does not
    // arrive as a pinned saved tab.
    const selected = tabs
      .filter((tab) => selectedIds.has(tab.id))
      .map((tab) => ({ title: tab.title, url: tab.url, groupId: tab.groupId }));

    setBusy(true);
    try {
      await intake.addSelectedTabs(collectionId, selected, groupsMeta);
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="tab-form multi-form">
      <div className="dl-select-all-row">
        <label className="checkbox-label" htmlFor="selectAllTabs">
          <input id="selectAllTabs" type="checkbox" checked={allSelected} onChange={toggleAll} />
          <span>Select All Tabs</span>
        </label>
      </div>
      <div className="dl-open-tabs-list">
        {loading ? <p className="open-tabs-empty">Loading open tabs…</p> : null}
        {!loading && tabs.length === 0 ? (
          <p className="open-tabs-empty">No other tabs are open in this window.</p>
        ) : null}
        {tabs.map((tab) => {
          const displayTitle = String(tab.title ?? '').trim() || 'Untitled';
          return (
            <div className="dl-open-tab-item" key={tab.id}>
              <label className="checkbox-label" htmlFor={`open-tab-${tab.id}`}>
                <input
                  id={`open-tab-${tab.id}`}
                  type="checkbox"
                  className="tab-checkbox"
                  aria-label={displayTitle}
                  checked={selectedIds.has(tab.id)}
                  onChange={() => toggleTab(tab.id)}
                />
                <div className="dl-open-tab-favicon-container">
                  <img
                    className="dl-open-tab-favicon"
                    src={resolveFaviconUrl(tab.url, EXTENSION_ID)}
                    alt=""
                  />
                </div>
                <div className="dl-open-tab-details">
                  <span className="tab-title">{displayTitle}</span>
                  <span className="tab-url" title={tab.url}>
                    {truncateUrl(tab.url)}
                  </span>
                </div>
              </label>
            </div>
          );
        })}
      </div>
      <div className="footer-btn-container">
        <button
          type="button"
          className="btn-secondary"
          disabled={busy || selectedIds.size === 0}
          onClick={handleAddSelected}
        >
          <i className="fas fa-check" /> Add Selected
        </button>
        <button type="button" className="btn-outline" onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  );
}
