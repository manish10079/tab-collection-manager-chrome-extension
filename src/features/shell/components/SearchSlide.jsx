import { useEffect, useRef } from 'react';

/**
 * @typedef {object} SearchSlideProps
 * @property {string} query
 * @property {(value: string) => void} onQueryChange
 * @property {() => void} onClose
 */

/**
 * The global search input that replaces the default actions bar while it is open. Escape closes it
 * (the global handler would too, but stopping here keeps the caret from stealing the keystroke from
 * a dialog).
 *
 * @param {SearchSlideProps} props
 * @returns {import('react').ReactElement}
 */
export function SearchSlide({ query, onQueryChange, onClose }) {
  const inputRef = useRef(/** @type {HTMLInputElement|null} */ (null));

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <div className="input-slide-container">
      <div className="input-wrapper search-wrapper">
        <input
          ref={inputRef}
          type="text"
          value={query}
          placeholder="Search collections or tabs…"
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => onQueryChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.stopPropagation();
              onClose();
            }
          }}
        />
        <button
          type="button"
          className="icon-btn input-action-btn"
          title="Clear & Close"
          onClick={onClose}
        >
          <i className="fas fa-times" />
        </button>
      </div>
    </div>
  );
}
