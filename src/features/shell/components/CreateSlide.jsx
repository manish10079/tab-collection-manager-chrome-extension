import { useEffect, useRef } from 'react';
import { useRestoreFocus } from '../../../app/hooks/useRestoreFocus.js';

/**
 * @typedef {object} CreateSlideProps
 * @property {string} name
 * @property {(value: string) => void} onNameChange
 * @property {() => void} onSubmit   Enter or the check button
 * @property {() => void} onCancel   Escape or the close button
 */

/**
 * The new-collection input that replaces the default actions bar while it is open. The `maxLength`
 * of 50 matches the legacy field (a collection name is capped at 100, but the input has always
 * stopped at 50).
 *
 * @param {CreateSlideProps} props
 * @returns {import('react').ReactElement}
 */
export function CreateSlide({ name, onNameChange, onSubmit, onCancel }) {
  const inputRef = useRef(/** @type {HTMLInputElement|null} */ (null));

  // Capture the "new collection" toggle before the effect below moves focus into the input.
  useRestoreFocus();

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <div className="input-slide-container">
      <div className="input-wrapper create-wrapper">
        <input
          ref={inputRef}
          type="text"
          value={name}
          maxLength={50}
          aria-label="New collection name"
          placeholder="New collection name"
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => onNameChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              onSubmit();
            } else if (event.key === 'Escape') {
              event.stopPropagation();
              onCancel();
            }
          }}
        />
        <button
          type="button"
          className="icon-btn input-action-btn success-btn"
          title="Create"
          aria-label="Create collection"
          onClick={onSubmit}
        >
          <i className="fas fa-check" aria-hidden="true" />
        </button>
        <button
          type="button"
          className="icon-btn input-action-btn cancel-btn"
          title="Cancel"
          aria-label="Cancel new collection"
          onClick={onCancel}
        >
          <i className="fas fa-times" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
