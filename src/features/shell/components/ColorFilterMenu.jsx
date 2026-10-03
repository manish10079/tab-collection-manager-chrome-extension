import { useState } from 'react';
import { allColors, NO_COLOR, swatchValue } from '../../../lib/colors.js';
import { useSettings } from '../../../store/hooks.js';
import { useDismissable } from '../../../app/hooks/useDismissable.js';

/**
 * @typedef {object} ColorFilterMenuProps
 * @property {Set<string>} selected                    Colour ids (and `NO_COLOR`) currently on
 * @property {(colorId: string) => void} onToggle      Add or remove one colour from the filter
 * @property {() => void} onClear                      Show everything again
 */

/**
 * The panel's colour filter. It is a multi-select: every chosen colour is shown, so two colours can
 * be compared at once, and the same colour groups folders and collections together across folders.
 *
 * @param {ColorFilterMenuProps} props
 * @returns {import('react').ReactElement}
 */
export function ColorFilterMenu({ selected, onToggle, onClear }) {
  const settings = useSettings();
  const customColors = /** @type {Array<{id: string, name: string, value?: string}>} */ (
    settings.customColors ?? []
  );
  const [open, setOpen] = useState(false);
  const ref = useDismissable(open, () => setOpen(false));
  const count = selected ? selected.size : 0;

  return (
    <div className="sh-color-filter-container" ref={ref}>
      <button
        type="button"
        className={`sh-icon-btn sh-color-filter-btn${count > 0 ? ' ut-active' : ''}`}
        id="colorFilterBtn"
        title={count > 0 ? `Filter: ${count} color${count === 1 ? '' : 's'}` : 'Filter by color'}
        aria-label="Filter by color"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <i className="fas fa-palette" aria-hidden="true" />
        <span className="sh-action-label">Color</span>
        {count > 0 ? <span className="sh-color-filter-count">{count}</span> : null}
      </button>

      <div
        className={`sh-color-filter-menu${open ? '' : ' ut-hidden'}`}
        role="menu"
        aria-label="Filter by color"
      >
        {allColors(customColors).map((color) => (
          <button
            key={color.id}
            type="button"
            role="menuitemcheckbox"
            aria-checked={selected.has(color.id)}
            className={`sh-color-filter-option${selected.has(color.id) ? ' ut-active' : ''}`}
            onClick={() => onToggle(color.id)}
          >
            <span
              className="ut-color-swatch cc-color-swatch"
              style={{ '--tc-swatch-color': swatchValue(color.id, customColors) }}
              aria-hidden="true"
            />
            <span className="sh-color-filter-name">{color.name}</span>
            {selected.has(color.id) ? (
              <i className="fas fa-check sh-color-filter-check" aria-hidden="true" />
            ) : null}
          </button>
        ))}

        <button
          type="button"
          role="menuitemcheckbox"
          aria-checked={selected.has(NO_COLOR)}
          className={`sh-color-filter-option${selected.has(NO_COLOR) ? ' ut-active' : ''}`}
          onClick={() => onToggle(NO_COLOR)}
        >
          <span className="ut-color-swatch cc-color-swatch cc-color-swatch-none" aria-hidden="true">
            <i className="fas fa-ban" aria-hidden="true" />
          </span>
          <span className="sh-color-filter-name">No color</span>
          {selected.has(NO_COLOR) ? (
            <i className="fas fa-check sh-color-filter-check" aria-hidden="true" />
          ) : null}
        </button>

        <button
          type="button"
          className="sh-color-filter-clear"
          disabled={count === 0}
          onClick={onClear}
        >
          <i className="fas fa-times" aria-hidden="true" /> Clear filter
        </button>
      </div>
    </div>
  );
}
