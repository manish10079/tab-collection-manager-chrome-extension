import { useEffect, useRef } from 'react';

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
          onClick={onSubmit}
        >
          <i className="fas fa-check" />
        </button>
        <button
          type="button"
          className="icon-btn input-action-btn cancel-btn"
          title="Cancel"
          onClick={onCancel}
        >
          <i className="fas fa-times" />
        </button>
      </div>
    </div>
  );
}
