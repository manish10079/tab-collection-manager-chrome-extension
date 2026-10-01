import { useEffect, useState } from 'react';

/**
 * @typedef {object} LimitInputProps
 * @property {string} id
 * @property {string} label               Accessible name for the input
 * @property {number} value               Stored value
 * @property {number} min
 * @property {number} max
 * @property {boolean} disabled
 * @property {(raw: string) => Promise<number>} onCommit Called with the typed value; returns the
 *   clamped value that was stored, which becomes the field's new content
 */

/**
 * The `max` number input of a limit row.
 *
 * It keeps a local draft so the field stays editable while typing — clamping on every keystroke
 * would rewrite "12" to "1" before the second digit lands — and commits on blur or Enter, the
 * moment the legacy input's `change` event fired.
 *
 * @param {LimitInputProps} props
 * @returns {import('react').ReactElement}
 */
export function LimitInput({ id, label, value, min, max, disabled, onCommit }) {
  const [draft, setDraft] = useState(String(value));

  // Follow the stored value when it changes elsewhere (another panel, a migration).
  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  async function commit() {
    const stored = await onCommit(draft);
    setDraft(String(stored));
  }

  return (
    <div className={`limit-input-group${disabled ? ' disabled' : ''}`}>
      <input
        type="number"
        id={id}
        className="limit-input"
        aria-label={label}
        min={min}
        max={max}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
        }}
      />
      <span className="limit-label">max</span>
    </div>
  );
}
