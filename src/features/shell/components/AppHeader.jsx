/**
 * @typedef {object} AppHeaderProps
 * @property {{name: string, version: string}} manifest
 * @property {() => void} onOpenSettings
 * @property {() => void} onClose
 */

/**
 * The panel header. Replaces the legacy markup that `popup.js` filled in on `DOMContentLoaded`
 * (react-migration-plan.md §8, Phase 5.2). The `#app-name` id is kept because `popup.css`
 * styles it.
 *
 * @param {AppHeaderProps} props
 * @returns {import('react').ReactElement}
 */
export function AppHeader({ manifest, onOpenSettings, onClose }) {
  return (
    <header className="header">
      <h1>
        <i className="fas fa-layer-group" /> <span id="app-name">{manifest.name}</span>
        <sub id="version" style={{ fontSize: '0.5rem', fontWeight: 100 }}>
          {manifest.version ? `v${manifest.version}` : ''}
        </sub>
      </h1>

      <div className="header-actions">
        <button
          type="button"
          className="icon-btn"
          id="settingsBtn"
          title="Settings"
          onClick={onOpenSettings}
        >
          <i className="fas fa-cog" />
        </button>
        <button
          type="button"
          className="icon-btn"
          id="closePanelBtn"
          title="Close Panel"
          onClick={onClose}
        >
          <i className="fas fa-times" />
        </button>
      </div>

      <p className="subtitle">Autosave &amp; organize your browsing sessions</p>
    </header>
  );
}
