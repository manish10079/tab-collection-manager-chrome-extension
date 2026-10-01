/**
 * @typedef {object} ToggleSwitchProps
 * @property {string} id            Stable id, used for the aria-label link and tests
 * @property {string} label          Accessible name — the row's visible label
 * @property {boolean} checked
 * @property {(checked: boolean) => void} onChange
 * @property {boolean} [disabled]
 */

/**
 * The legacy `.toggle-switch` markup (visually a switch, structurally a checkbox), so the switch
 * stays keyboard operable and announced as a checkbox rather than faking a button.
 *
 * @param {ToggleSwitchProps} props
 * @returns {import('react').ReactElement}
 */
export function ToggleSwitch({ id, label, checked, onChange, disabled = false }) {
  return (
    <label className="toggle-switch">
      <input
        type="checkbox"
        id={id}
        className="toggle-input"
        aria-label={label}
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="toggle-track">
        <span className="toggle-thumb" />
      </span>
    </label>
  );
}
