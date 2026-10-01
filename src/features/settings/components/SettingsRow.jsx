/**
 * @typedef {object} SettingsRowProps
 * @property {string} icon                Full Font Awesome classes, e.g. `fas fa-save` or the
 *   brand set's `fab fa-google-drive`
 * @property {string} label
 * @property {string} description
 * @property {string} [badge]             Extra emphasis beside the label (e.g. "💾 Lazy Load")
 * @property {string} [title]             Tooltip for the whole row
 * @property {import('react').ReactNode} [children] Control shown on the right
 * @property {import('react').ReactNode} [below]    Content rendered under the row (e.g. actions)
 */

/**
 * One labelled row of a settings card: icon, label, description, and the control that changes it.
 *
 * @param {SettingsRowProps} props
 * @returns {import('react').ReactElement}
 */
export function SettingsRow({ icon, label, description, badge, title, children, below }) {
  return (
    <>
      <div className="settings-row" title={title}>
        <div className="settings-row-left">
          <div className="settings-row-icon">
            <i className={icon} />
          </div>
          <div className="settings-row-text">
            <span className="settings-row-label">
              {label}
              {badge ? <span className="ram-saver-badge">{badge}</span> : null}
            </span>
            <span className="settings-row-desc">{description}</span>
          </div>
        </div>
        {children ? <div className="settings-row-right">{children}</div> : null}
      </div>
      {below}
    </>
  );
}
