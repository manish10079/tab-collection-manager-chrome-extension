import { useEffect, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { getPortalRoot } from '../../components/portalRoot.js';
import { getToasts, subscribeToasts } from './toastStore.js';

/**
 * @typedef {object} ToastProviderProps
 * @property {import('react').ReactNode} children
 */

/**
 * One toast. It owns the show/hide animation timing so the store stays a plain queue and the
 * provider has nothing to schedule: `show` is applied a tick after mount so the CSS transition
 * runs, `hide` starts the exit animation, and the store drops the entry `HIDE_MS` later.
 *
 * @param {{toast: import('./toastStore.js').ToastEntry}} props
 * @returns {import('react').ReactElement}
 */
function Toast({ toast }) {
  const [phase, setPhase] = useState('');

  useEffect(() => {
    const showTimer = setTimeout(() => setPhase('show'), 10);
    const hideTimer = setTimeout(() => setPhase('hide'), toast.duration);
    return () => {
      clearTimeout(showTimer);
      clearTimeout(hideTimer);
    };
  }, [toast.duration]);

  return (
    <div className={`toast ${phase}`.trim()}>
      <i className="fas fa-check-circle" /> {toast.message}
    </div>
  );
}

/**
 * Renders the toast queue into the body-level portal root, the same one the dialogs use: the
 * panel's layout lives inside a scroll container, and `.toast-container` is `position: fixed` so
 * it must not be nested under it.
 *
 * @param {ToastProviderProps} props
 * @returns {import('react').ReactElement}
 */
export function ToastProvider({ children }) {
  const toasts = useSyncExternalStore(subscribeToasts, getToasts, getToasts);

  return (
    <>
      {children}
      {createPortal(
        <div className="toast-container">
          {toasts.map((toast) => (
            <Toast key={toast.id} toast={toast} />
          ))}
        </div>,
        getPortalRoot()
      )}
    </>
  );
}
