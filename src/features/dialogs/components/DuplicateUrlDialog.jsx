import { Modal } from '../../../components/Modal.jsx';

/**
 * @typedef {object} DuplicateUrlDialogProps
 * @property {{url: string, duplicates: {collectionId: string, collectionName: string}[]}} request
 * @property {(result: boolean) => void} onSettle Resolves the promise the intake flow awaits
 */

/**
 * Confirmation shown before a tab whose URL already lives somewhere else is added, replacing the
 * legacy `#duplicateUrlDialog` and its listener bookkeeping. The `Modal` primitive supplies
 * Escape, the overlay and the close button, all of which count as Cancel, so the awaiting promise
 * always settles.
 *
 * @param {DuplicateUrlDialogProps} props
 * @returns {import('react').ReactElement}
 */
export function DuplicateUrlDialog({ request, onSettle }) {
  const { url, duplicates } = request;
  const displayUrl = url.length > 60 ? `${url.slice(0, 60)}…` : url;

  return (
    <Modal
      title="Duplicate URL Found"
      icon="fa-exclamation-triangle"
      className="duplicate-dialog"
      bodyClassName="duplicate-dialog-body"
      footerClassName="duplicate-dialog-footer"
      onClose={() => onSettle(false)}
      footer={
        <>
          <button type="button" className="btn-outline" onClick={() => onSettle(false)}>
            Cancel
          </button>
          <button type="button" className="btn-secondary" onClick={() => onSettle(true)}>
            <i className="fas fa-plus" /> Add Anyway
          </button>
        </>
      }
    >
      <div className="duplicate-message">
        This URL already exists in{' '}
        {duplicates.length === 1 ? 'another collection' : 'other collections'}:<br />
        <strong>{displayUrl}</strong>
      </div>
      <div className="duplicate-collection-list">
        {duplicates.map((duplicate) => (
          <div
            className="duplicate-collection-item"
            key={`${duplicate.collectionId}-${duplicate.collectionName}`}
          >
            <i className="fas fa-folder" />
            <span className="dup-collection-name" title={duplicate.collectionName}>
              {duplicate.collectionName}
            </span>
          </div>
        ))}
      </div>
    </Modal>
  );
}
