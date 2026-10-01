import { Modal } from '../../../components/Modal.jsx';
import { TabPanel } from './TabPanel.jsx';

/**
 * @typedef {object} GridCollectionModalProps
 * @property {import('../../../store/schema.js').Collection} collection
 * @property {import('../../../features/collections/hooks/useCollectionActions.js').CollectionActions} actions
 */

/**
 * Grid view has no room for an inline tab list, so an expanded collection opens this overlay
 * instead. It replaces the legacy `#viewCollectionModal`, which moved a rendered `.collection-tabs`
 * node between the card and the modal — the one DOM mutation React cannot survive, and the reason
 * this modal is now React-owned. Closing it collapses the collection, which is the single source of
 * truth for whether it is open.
 *
 * @param {GridCollectionModalProps} props
 * @returns {import('react').ReactElement}
 */
export function GridCollectionModal({ collection, actions }) {
  const close = () => actions.setExpanded(collection.id, false);

  return (
    <Modal
      title={collection.name}
      icon="fa-folder-open"
      className="view-collection-modal"
      onClose={close}
    >
      <TabPanel collection={collection} actions={actions} forceExpanded />
    </Modal>
  );
}
