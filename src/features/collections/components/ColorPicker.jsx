import { allColors, swatchValue } from '../../../lib/colors.js';

/**
 * @typedef {object} ColorPickerProps
 * @property {string|null} value             The item's current colour id, or null
 * @property {Array<{id: string, name: string, value?: string, token?: string}>} [customColors]
 * @property {(colorId: string|null) => void} onSelect
 * @property {string} [label]
 */

/**
 * A row of colour swatches for the collection and folder dropdown menus: the ten built-ins, every
 * custom colour the user has added, and a "none" swatch that clears the label. Choosing one hands
 * the id back to the caller, which owns the store write and closing the menu.
 *
 * @param {ColorPickerProps} props
 * @returns {import('react').ReactElement}
 */
export function ColorPicker({ value, customColors = [], onSelect, label = 'Color' }) {
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
      </div>
    </div>
  );
}
