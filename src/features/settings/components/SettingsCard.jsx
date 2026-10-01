/**
 * @typedef {object} SettingsCardProps
 * @property {string} icon        Font Awesome class for the card icon
 * @property {string} title
 * @property {string} [badge]     Small badge beside the title (e.g. the Google Drive label)
 * @property {import('react').ReactNode} children Card rows
 */

/**
 * One titled section of the settings modal — the legacy `.settings-card` markup, as a component.
 *
 * @param {SettingsCardProps} props
 * @returns {import('react').ReactElement}
 */
export function SettingsCard({ icon, title, badge, children }) {
  return (
    <div className="settings-card">
      <div className="settings-card-header">
        <i className={`fas ${icon} settings-card-icon`} />
        <span>
          {title}
          {badge ? <span className="ram-saver-badge">{badge}</span> : null}
        </span>
      </div>
      <div className="settings-card-body">{children}</div>
    </div>
  );
}
