import { useEffect } from 'react';
import { TabPanel } from './TabPanel.jsx';

/**
 * @typedef {object} GridCollectionModalProps
 * @property {import('../../../store/schema.js').Collection} collection
 * @property {import('../../../features/collections/hooks/useCollectionActions.js').CollectionActions} actions
 */

/**
 * Grid view has no room for an inline tab list, so an expanded collection opens this overlay
 * instead. It replaces the legacy `#viewCollectionModal`, which moved a rendered
 * `.collection-tabs` node between the card and the modal — the one DOM mutation React cannot
 * survive, and the reason this modal is now React-owned. Closing it collapses the collection,
 * which is the single source of truth for whether it is open.
 *
 * @param {GridCollectionModalProps} props
 * @returns {import('react').ReactElement}
 */
export function GridCollectionModal({ collection, actions }) {
  const collectionId = collection.id;

  useEffect(() => {
    const close = () => actions.setExpanded(collectionId, false);
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') close();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [collectionId, actions]);

  const close = () => actions.setExpanded(collectionId, false);

  return (
    /* Backdrop click close is a pointer convenience — Escape and the close button are the
       keyboard paths (both handled below / on the header button). */
    /* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */
    <div
      className="modal-overlay"
      onClick={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div className="modal view-collection-modal">
        <div className="modal-header">
          <h3>
            <i className="fas fa-folder-open" /> {collection.name}
          </h3>
          <button type="button" className="close-modal" onClick={close}>
            &times;
          </button>
        </div>
        <div className="modal-body">
          <TabPanel collection={collection} actions={actions} forceExpanded />
        </div>
      </div>
    </div>
  );
}
