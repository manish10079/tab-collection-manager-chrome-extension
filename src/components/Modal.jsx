import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { getPortalRoot } from './portalRoot.js';

/**
 * @typedef {object} ModalProps
 * @property {import('react').ReactNode} title    Shown in the header and used as the dialog label.
 *   A node, not just a string, so a dialog can carry a subtitle line (session details).
 * @property {string} [icon]                      Font Awesome class for the header icon
 * @property {() => void} onClose                 Called by Escape, the close button and the overlay
 * @property {import('react').ReactNode} children Modal body
 * @property {string} [className]                 Extra class on `.modal` (size variants)
 * @property {string} [bodyClassName]             Extra class on `.modal-body`
 * @property {import('react').ReactNode} [footer] Rendered in a `.modal-footer` below the body
 * @property {string} [footerClassName]           Extra class on `.modal-footer`
 * @property {number} [zIndex]                    Stacking override for a modal opened over another
 * @property {(event: MouseEvent) => void} [onOverlayClick] Replaces the default overlay close
 */

/**
 * Only the topmost dialog reacts to Escape or traps Tab, so a modal opened on top of another does
 * not close both at once. The stack is module-level because stacking spans modal instances.
 *
 * @type {HTMLElement[]}
 */
const openDialogs = [];

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

/**
 * The modal primitive: overlay, labelled dialog, focus into the dialog on open and back to the
 * trigger on close, Escape to close, Tab cycling inside. It renders into the shared portal root
 * and reuses the legacy `.modal-*` classes, so `popup.css` stays the only stylesheet
 * (ADR-0005).
 *
 * @param {ModalProps} props
 * @returns {import('react').ReactElement}
 */
export function Modal({
  title,
  icon,
  onClose,
  children,
  className = '',
  bodyClassName = '',
  footer,
  footerClassName = '',
  zIndex,
  onOverlayClick,
}) {
  const titleId = useId();
  const dialogRef = useRef(/** @type {HTMLDivElement|null} */ (null));
  const restoreFocusRef = useRef(/** @type {HTMLElement|null} */ (null));

  // Keyboard handling is bound once per modal; the stack check keeps it to the topmost dialog.
  useEffect(() => {
    const dialog = dialogRef.current;
    restoreFocusRef.current = /** @type {HTMLElement|null} */ (document.activeElement);
    openDialogs.push(dialog);
    dialog?.focus();

    function handleKeyDown(event) {
      if (openDialogs[openDialogs.length - 1] !== dialog) return;

      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
        return;
      }

      if (event.key !== 'Tab' || !dialog) return;

      // `querySelectorAll` already skips disabled controls; the dialog's own content is never
      // display:none, so no visibility filter is needed (and `offsetParent` is unreliable here).
      const focusable = [...dialog.querySelectorAll(FOCUSABLE_SELECTOR)];
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;

      if (event.shiftKey && (active === first || active === dialog)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      const index = openDialogs.indexOf(dialog);
      if (index !== -1) openDialogs.splice(index, 1);
      // Return focus where the user left it, unless that element is gone (e.g. a re-render).
      if (restoreFocusRef.current?.isConnected) restoreFocusRef.current.focus();
    };
  }, [onClose]);

  function handleOverlayClick(event) {
    if (onOverlayClick) {
      onOverlayClick(event);
      return;
    }
    // Only a click on the overlay itself closes — a drag that ends inside the dialog must not.
    if (event.target === event.currentTarget) onClose();
  }

  return createPortal(
    // Click-to-dismiss convenience — Escape and the header's close button are the keyboard paths.
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
    <div
      className="modal-overlay"
      style={zIndex === undefined ? undefined : { zIndex }}
      onClick={handleOverlayClick}
    >
      <div
        ref={dialogRef}
        className={`modal ${className}`.trim()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <div className="modal-header">
          <h3 id={titleId}>
            {icon ? <i className={`fas ${icon}`} /> : null} {title}
          </h3>
          <button
            type="button"
            className="close-modal"
            title="Close"
            aria-label="Close dialog"
            onClick={onClose}
          >
            &times;
          </button>
        </div>
        <div className={`modal-body ${bodyClassName}`.trim()}>{children}</div>
        {footer ? <div className={`modal-footer ${footerClassName}`.trim()}>{footer}</div> : null}
      </div>
    </div>,
    getPortalRoot()
  );
}
