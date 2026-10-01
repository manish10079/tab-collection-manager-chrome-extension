import { highlightSegments } from '../lib/globalSearch.js';
import { resolveFaviconUrl, truncateUrl } from '../../../lib/url.js';

/**
 * @typedef {object} GlobalSearchResultsProps
 * @property {import('../lib/globalSearch.js').SearchOutcome} search
 * @property {string} query      Raw query, for the "no results" message
 * @property {string} extensionId
 * @property {(id: string) => void} onOpenCollection
 * @property {(url: string) => void} onOpenTab
 */

/**
 * Render a query's matches in place of the collections list. This replaces the legacy
 * `filterResults()` string builder and its `innerHTML` writes (react-migration-plan.md §8,
 * Phase 5.2): the same sections and classes, but each result is a React element, so user text is
 * escaped by React rather than by hand.
 *
 * @param {GlobalSearchResultsProps} props
 * @returns {import('react').ReactElement|null}
 */
export function GlobalSearchResults({ search, query, extensionId, onOpenCollection, onOpenTab }) {
  if (search.isEmpty) return null;

  const hasResults = search.nameMatches.length > 0 || search.tabMatchGroups.length > 0;

  return (
    <div className="search-results-container" id="searchResultsContainer">
      {hasResults ? (
        <>
          {search.nameMatches.length > 0 ? (
            <div className="search-section">
              <div className="search-section-header">
                <span className="search-section-title">
                  <i className="fas fa-folder" /> Collections
                </span>
                <span className="search-section-count">{search.nameMatches.length}</span>
              </div>
              <div className="search-section-body">
                {search.nameMatches.map((collection) => (
                  <div
                    key={collection.id}
                    className="search-collection-result"
                    data-id={collection.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => onOpenCollection(collection.id)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        onOpenCollection(collection.id);
                      }
                    }}
                  >
                    <div className="search-result-left">
                      <i className="fas fa-folder-open search-result-icon" />
                      <div className="search-result-info">
                        <span className="search-result-name">
                          <Highlight text={collection.name} query={search.query} />
                        </span>
                        <span className="search-result-meta">
                          {collection.tabs.length} tab{collection.tabs.length !== 1 ? 's' : ''}
                        </span>
                      </div>
                    </div>
                    <i className="fas fa-chevron-right search-result-arrow" />
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {search.tabMatchGroups.length > 0 ? (
            <div className="search-section">
              <div className="search-section-header">
                <span className="search-section-title">
                  <i className="fas fa-link" /> Tabs
                </span>
                <span className="search-section-count">{search.totalTabHits}</span>
              </div>
              <div className="search-section-body">
                {search.tabMatchGroups.map(({ collection, hits }) => (
                  <div className="search-tab-group" key={collection.id}>
                    <div className="search-tab-group-label">
                      <i className="fas fa-folder" /> {collection.name}
                    </div>
                    {hits.map((tab) => (
                      <div className="search-tab-result" key={tab.id}>
                        <div className="search-tab-favicon-container">
                          <img
                            className="search-tab-favicon"
                            src={resolveFaviconUrl(tab.url, extensionId)}
                            alt=""
                            onError={(event) => {
                              event.currentTarget.src = 'icons/icon16.png';
                            }}
                          />
                        </div>
                        <div className="search-tab-result-body">
                          <div className="search-tab-result-title">
                            <Highlight text={tab.title || 'Untitled'} query={search.query} />
                          </div>
                          <div className="search-tab-result-url">
                            <Highlight text={truncateUrl(tab.url, 62, '…')} query={search.query} />
                          </div>
                        </div>
                        <button
                          type="button"
                          className="icon-btn search-open-tab-btn"
                          title="Open tab"
                          aria-label="Open tab"
                          onClick={(event) => {
                            event.stopPropagation();
                            onOpenTab(tab.url);
                          }}
                        >
                          <i className="fas fa-external-link-alt" aria-hidden="true" />
                        </button>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </>
      ) : (
        <div className="search-no-results">
          <i className="fas fa-search" />
          No collections or tabs match <strong>&quot;{String(query ?? '').trim()}&quot;</strong>
        </div>
      )}
    </div>
  );
}

/**
 * Render matched runs of text as `<mark class="search-hl">` — the same markup the legacy
 * `highlightMatch` produced, as elements instead of a string.
 *
 * @param {{text: string, query: string}} props
 * @returns {import('react').ReactElement}
 */
function Highlight({ text, query }) {
  const segments = highlightSegments(text, query);
  return (
    <>
      {segments.map((segment, index) =>
        segment.match ? (
          <mark key={index} className="search-hl">
            {segment.text}
          </mark>
        ) : (
          <span key={index}>{segment.text}</span>
        )
      )}
    </>
  );
}
