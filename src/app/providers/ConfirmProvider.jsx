import { useSyncExternalStore } from 'react';
import { Modal } from '../../components/Modal.jsx';
import { getConfirm, settleConfirm, subscribeConfirm } from './confirmStore.js';

/**
 * @typedef {object} ConfirmProviderProps
 * @property {import('react').ReactNode} children
 */

/**
 * The one confirmation dialog. It renders whatever question is pending, and every way out of it —
 * the affirmative button, Cancel, Escape, the close button, the overlay — settles the awaiting
 * promise, so `requestConfirm`'s caller can never be left waiting.
 *
 * The `Modal` primitive supplies the focus handling, the Escape binding and the stacking, so this
 * stays a presentational shell and reuses `src/styles/dialogs.css` like every other dialog.
 *
 * @param {{request: import('./confirmStore.js').ConfirmRequest}} props
 * @returns {import('react').ReactElement}
 */
function ConfirmDialog({ request }) {
  const {
    title = 'Please Confirm',
    message,
    confirmLabel = 'Confirm',
    cancelLabel = 'Cancel',
    danger = false,
    icon,
  } = request.options;

  return (
    <Modal
      title={title}
      icon={icon ?? (danger ? 'fa-triangle-exclamation' : 'fa-circle-question')}
      className="dl-confirm-dialog"
      bodyClassName="dl-confirm-body"
      footerClassName="dl-confirm-footer"
      onClose={() => settleConfirm(false)}
      footer={
        <>
          <button type="button" className="sh-btn-outline" onClick={() => settleConfirm(false)}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className={danger ? 'dl-btn-danger' : 'sh-btn-secondary'}
            onClick={() => settleConfirm(true)}
          >
            {confirmLabel}
          </button>
        </>
      }
    >
      <div className="dl-confirm-message">{message}</div>
    </Modal>
  );
}

/**
 * Mounts the confirm dialog beside the app. Any feature can then `await useConfirm()({...})` without
 * knowing about this component; only the provider is React, and it holds no state — the pending
 * question lives in `confirmStore.js`.
 *
 * @param {ConfirmProviderProps} props
 * @returns {import('react').ReactElement}
 */
export function ConfirmProvider({ children }) {
  const request = useSyncExternalStore(subscribeConfirm, getConfirm, getConfirm);

  return (
    <>
      {children}
      {request ? <ConfirmDialog request={request} /> : null}
    </>
  );
}
