import { Modal } from '../../../components/Modal.jsx';
import { ShortcutGrid } from '../../../components/ShortcutGrid.jsx';

/**
 * @typedef {object} ShortcutsHelpModalProps
 * @property {() => void} onClose
 */

/**
 * The `?` help overlay, replacing `#shortcutsHelpModal`. It reuses `ShortcutGrid`, the same list
 * the settings modal shows, so the two can no longer drift apart. `zIndex` keeps it above a
 * dialog the user opened it from.
 *
 * @param {ShortcutsHelpModalProps} props
 * @returns {import('react').ReactElement}
 */
export function ShortcutsHelpModal({ onClose }) {
  return (
    <Modal
      title="Keyboard Shortcuts"
      icon="fa-keyboard"
      className="set-shortcuts-help-modal"
      bodyClassName="set-shortcuts-help-body"
      footerClassName="set-shortcuts-help-footer"
      zIndex={3000}
      onClose={onClose}
      footer={
        <span className="set-shortcuts-help-hint">
          <i className="fas fa-lightbulb" /> Tip: press <kbd>?</kbd> anytime to see these shortcuts
        </span>
      }
    >
      <ShortcutGrid />
    </Modal>
  );
}
