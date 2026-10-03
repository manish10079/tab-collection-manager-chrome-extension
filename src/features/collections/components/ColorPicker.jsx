import { useState } from 'react';
import { allColors, customColorErrorMessage, swatchValue } from '../../../lib/colors.js';
import { LIMITS } from '../../../shared/constants.js';

/** The colour the inline form starts on, so the well is never empty. */
const DEFAULT_NEW_COLOR = '#7c6fff';

/**
 * @typedef {object} ColorPickerProps
 * @property {string|null} value             The item's current colour id, or null
 * @property {Array<{id: string, name: string, value?: string, token?: string}>} [customColors]
 * @property {(colorId: string|null) => void} onSelect
 * @property {(name: string, value: string) => Promise<string>} [onCreateColor]
 *           Lists a brand-new colour for this item and returns the store's verdict; when omitted the
 *           picker offers no way to create one.
 * @property {string} [label]
 */

/**
 * A row of colour swatches for the collection and folder dropdown menus: the ten built-ins, every
 * custom colour the user has added, and a "none" swatch that clears the label. Choosing one hands
 * the id back to the caller, which owns the store write and closing the menu.
 *
 * When the caller passes `onCreateColor`, a trailing "+" swatch opens a small form — a colour well,
 * a name, and Add — so a custom colour can be made straight from the menu instead of a trip to
 * Settings. A refusal is shown in place; a success is the caller's to act on (it labels the item and
 * usually closes the menu).
 *
 * @param {ColorPickerProps} props
 * @returns {import('react').ReactElement}
 */
export function ColorPicker({
  value,
  customColors = [],
  onSelect,
  onCreateColor,
  label = 'Color',
}) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [newValue, setNewValue] = useState(DEFAULT_NEW_COLOR);
  const [error, setError] = useState('');

  /** @param {import('react').FormEvent<HTMLFormElement>} event */
  async function submit(event) {
    event.preventDefault();
    if (!onCreateColor) return;

    const outcome = await onCreateColor(name, newValue);
    if (outcome === 'added') {
      setName('');
      setNewValue(DEFAULT_NEW_COLOR);
      setError('');
      setAdding(false);
      return;
    }
    setError(customColorErrorMessage(outcome) || 'Could not add that color.');
  }

  return (
    <div className="cc-color-picker">
      <div className="sh-dropdown-section-label">{label}</div>
      <div className="cc-color-swatches" role="group" aria-label={label}>
        <button
          type="button"
          className={`cc-color-swatch cc-color-swatch-none ut-color-swatch${value ? '' : ' ut-active'}`}
          title="No color"
          aria-label="No color"
          aria-pressed={!value}
          onClick={() => onSelect(null)}
        >
          <i className="fas fa-ban" aria-hidden="true" />
        </button>
        {allColors(customColors).map((color) => (
          <button
            key={color.id}
            type="button"
            className={`cc-color-swatch ut-color-swatch${value === color.id ? ' ut-active' : ''}`}
            style={{ '--tc-swatch-color': swatchValue(color.id, customColors) }}
            title={color.name}
            aria-label={color.name}
            aria-pressed={value === color.id}
            onClick={() => onSelect(color.id)}
          />
        ))}
        {onCreateColor ? (
          <button
            type="button"
            className={`cc-color-swatch cc-color-swatch-add${adding ? ' ut-active' : ''}`}
            title="New custom color"
            aria-label="New custom color"
            aria-expanded={adding}
            onClick={() => {
              setAdding((open) => !open);
              setError('');
            }}
          >
            <i className="fas fa-plus" aria-hidden="true" />
          </button>
        ) : null}
      </div>

      {onCreateColor && adding ? (
        <form className="cc-color-add-form" onSubmit={submit}>
          <input
            className="cc-color-add-value"
            type="color"
            value={newValue}
            aria-label="New color value"
            onChange={(event) => setNewValue(event.target.value)}
          />
          <input
            className="cc-color-add-name"
            type="text"
            value={name}
            maxLength={LIMITS.MAX_CUSTOM_COLOR_NAME_LENGTH}
            placeholder="Color name"
            aria-label="New color name"
            onChange={(event) => {
              setName(event.target.value);
              if (error) setError('');
            }}
          />
          <button
            type="submit"
            className="sh-btn-secondary cc-color-add-submit"
            disabled={!name.trim()}
          >
            Add
          </button>
          {error ? (
            <p className="cc-color-add-error" role="alert">
              {error}
            </p>
          ) : null}
        </form>
      ) : null}
    </div>
  );
}
