import { useState } from 'react';
import { Modal } from '../../../components/Modal.jsx';
import { ManualTabForm } from './ManualTabForm.jsx';
import { OpenTabsPicker } from './OpenTabsPicker.jsx';

/**
 * @typedef {object} AddTabsModalProps
 * @property {import('../../../store/schema.js').Collection} collection
 * @property {import('../hooks/useTabIntake.js').TabIntake} intake
 * @property {() => void} onClose
 */

/**
 * The add-tabs modal, replacing `#addTabsModal` and `openAddTabsModal()`/`switchTabMode()`. It is
 * only mounted while a collection is targeted, so the mode switch is local state instead of two
 * forms the legacy code had to show and hide by writing to `style.display`.
 *
 * @param {AddTabsModalProps} props
 * @returns {import('react').ReactElement}
 */
export function AddTabsModal({ collection, intake, onClose }) {
  const [mode, setMode] = useState(/** @type {'manual'|'multi'} */ ('manual'));

  return (
    <Modal title="Add Tabs" icon="fa-plus-circle" onClose={onClose}>
      <div className="tab-mode-selector">
        <button
          type="button"
          className={`mode-btn ${mode === 'manual' ? 'ut-active' : ''}`.trim()}
          onClick={() => setMode('manual')}
        >
          Manual
        </button>
        <button
          type="button"
          className={`mode-btn ${mode === 'multi' ? 'ut-active' : ''}`.trim()}
          onClick={() => setMode('multi')}
        >
          Multi‑Select
        </button>
      </div>

      {mode === 'manual' ? (
        <ManualTabForm collectionId={collection.id} intake={intake} onDone={onClose} />
      ) : (
        <OpenTabsPicker collectionId={collection.id} intake={intake} onClose={onClose} />
      )}
    </Modal>
  );
}
