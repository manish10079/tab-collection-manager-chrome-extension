/**
 * Whether any dialog is on screen.
 *
 * Every dialog is React-owned and portals into `#tcm-modal-root` only while it is open, so this
 * asks the DOM rather than a list of ids. Used to keep the 1-9 jump shortcut from firing under a
 * dialog; the dialog itself closes via the Modal primitive's own Escape handling.
 *
 * @returns {boolean}
 */
export function isAnyModalOpen() {
  return Array.from(document.querySelectorAll('.dl-modal-overlay')).some(
    (overlay) => getComputedStyle(overlay).display !== 'none'
  );
}
