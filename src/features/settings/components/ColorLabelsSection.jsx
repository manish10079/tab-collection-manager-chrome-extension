import { useState } from 'react';
import { BUILT_IN_COLORS, swatchValue } from '../../../lib/colors.js';
import { LIMITS } from '../../../shared/constants.js';
import { useSettings } from '../../../store/hooks.js';
import { SettingsCard } from './SettingsCard.jsx';

/** Why a custom colour was refused, phrased for the form. */
const ERROR_MESSAGES = Object.freeze({
  empty: 'Give the color a name.',
  'too-long': `Names are limited to ${LIMITS.MAX_CUSTOM_COLOR_NAME_LENGTH} characters.`,
  invalid: 'Pick a valid color.',
  duplicate: 'A color with that name already exists.',
  'too-many': `You can add up to ${LIMITS.MAX_CUSTOM_COLORS} custom colors.`,
});

/**
 * @typedef {object} ColorLabelsSectionProps
 * @property {import('../hooks/useSettingsActions.js').SettingsActions} actions
 */

/**
 * The Color Labels card: shows the ten built-ins (fixed — they can be used but not edited or
 * removed), lists the user's custom colors with a remove button, and adds a new one from a name plus
 * a colour picker. The palette lives in one setting, so every picker in the panel updates at once.
 *
 * @param {ColorLabelsSectionProps} props
 * @returns {import('react').ReactElement}
 */
export function ColorLabelsSection({ actions }) {
  const settings = useSettings();
  const customColors = /** @type {Array<{id: string, name: string, value?: string}>} */ (
    settings.customColors ?? []
  );
  const [name, setName] = useState('');
  const [value, setValue] = useState('#7c6fff');
  const [error, setError] = useState('');

  /**
   * @param {import('react').FormEvent<HTMLFormElement>} event
   * @returns {Promise<void>}
   */
  async function submit(event) {
    event.preventDefault();
    const outcome = await actions.addCustomColor(name, value);
    if (outcome === 'added') {
      setName('');
      setError('');
      return;
    }
    setError(ERROR_MESSAGES[outcome] ?? 'Could not add that color.');
  }

  return (
    <SettingsCard icon="fa-palette" title="Color Labels">
      <div className="set-color-labels">
        <p className="set-color-labels-hint">
          Ten built-in colors are always available. Add your own, then label folders and collections
          — the same color groups any number of them, and the Color filter shows every match.
        </p>

        <div className="set-color-strip">
          {BUILT_IN_COLORS.map((color) => (
            <span
              key={color.id}
              className="ut-color-swatch set-color-swatch-static"
              style={{ '--tc-swatch-color': swatchValue(color.id) }}
              title={color.name}
            />
          ))}
        </div>

        {customColors.length > 0 ? (
          <ul className="set-color-custom-list">
            {customColors.map((color) => (
              <li key={color.id} className="set-color-custom-item">
                <span
                  className="ut-color-swatch set-color-swatch-static"
                  style={{ '--tc-swatch-color': swatchValue(color.id, customColors) }}
                  aria-hidden="true"
                />
                <span className="set-color-custom-name">{color.name}</span>
                <button
                  type="button"
                  className="sh-icon-btn set-color-remove-btn"
                  title={`Remove ${color.name}`}
                  aria-label={`Remove ${color.name}`}
                  onClick={() => actions.removeCustomColor(color.id)}
                >
                  <i className="fas fa-trash" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        <form className="set-color-form" onSubmit={submit}>
          <input
            className="set-color-name-input"
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
          <input
            className="set-color-value-input"
            type="color"
            value={value}
            aria-label="New color value"
            onChange={(event) => setValue(event.target.value)}
          />
          <button
            type="submit"
            className="sh-btn-secondary set-color-add-btn"
            disabled={!name.trim()}
          >
            Add
          </button>
        </form>

        {error ? (
          <p className="set-color-error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </SettingsCard>
  );
}
