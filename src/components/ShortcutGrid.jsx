import { SHORTCUTS } from '../shared/shortcuts.js';

/**
 * The `.shortcut-grid` both the settings modal and the shortcuts-help dialog show. One component
 * so the two lists can never drift apart (they did while both were hand-written markup).
 *
 * @returns {import('react').ReactElement}
 */
export function ShortcutGrid() {
  return (
    <div className="set-shortcut-grid">
      {SHORTCUTS.map((shortcut) => (
        <div className="set-shortcut-row" key={shortcut.description}>
          <span className="set-shortcut-keys">
            {shortcut.keys.map((key, index) => (
              <span key={`${shortcut.description}-${key}`}>
                {index > 0 ? ' + ' : null}
                <kbd>{key}</kbd>
              </span>
            ))}
          </span>
          <span className="set-shortcut-desc">{shortcut.description}</span>
        </div>
      ))}
    </div>
  );
}
