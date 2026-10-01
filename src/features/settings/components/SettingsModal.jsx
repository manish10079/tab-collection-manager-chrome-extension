import { Modal } from '../../../components/Modal.jsx';
import { useSettings } from '../../../store/hooks.js';
import { SHORTCUTS } from '../lib/shortcuts.js';
import { GDriveSection } from './GDriveSection.jsx';
import { LimitInput } from './LimitInput.jsx';
import { SettingsCard } from './SettingsCard.jsx';
import { SettingsRow } from './SettingsRow.jsx';
import { ToggleSwitch } from './ToggleSwitch.jsx';

/**
 * @typedef {object} SettingsModalProps
 * @property {() => void} onClose
 * @property {import('../hooks/useSettingsActions.js').SettingsActions} actions
 */

/**
 * The settings modal, rendering straight from the store: every control reads its value from
 * persisted settings and writes back through the store's queue, so the panel and the list can
 * never disagree about what is on. Replaces the legacy `setupSettingsModal()` and its markup.
 *
 * @param {SettingsModalProps} props
 * @returns {import('react').ReactElement}
 */
export function SettingsModal({ onClose, actions }) {
  const settings = useSettings();
  const autoSave = Boolean(settings.autoSaveCollectionId);
  const ramSaver = Boolean(settings.ramSaverEnabled);
  const lightMode = settings.theme === 'light';
  const enforceCollections = settings.enforceMaxPinnedCollections !== false;
  const enforceTabs = settings.enforceMaxPinnedTabs !== false;
  const maxCollections = Number(settings.maxPinnedCollections ?? 3);
  const maxTabs = Number(settings.maxPinnedTabs ?? 3);

  return (
    <Modal
      title="Settings"
      icon="fa-sliders-h"
      className="settings-modal"
      bodyClassName="settings-modal-body"
      onClose={onClose}
    >
      <SettingsCard icon="fa-clock" title="Session">
        <SettingsRow
          icon="fas fa-save"
          label="Auto-Save"
          description="Enable auto-save to Current Session"
        >
          <ToggleSwitch
            id="autoSaveToggle"
            label="Auto-Save"
            checked={autoSave}
            onChange={actions.setAutoSave}
          />
        </SettingsRow>
      </SettingsCard>

      <SettingsCard icon="fa-bolt" title="Performance">
        <SettingsRow
          icon="fas fa-memory"
          label="RAM Saver"
          badge="💾 Lazy Load"
          description="Lazy load restored tabs to save memory"
          title="When enabled, restored tabs load in the background and only fully load when you click on them — saving RAM."
        >
          <ToggleSwitch
            id="ramSaverToggle"
            label="RAM Saver"
            checked={ramSaver}
            onChange={actions.setRamSaver}
          />
        </SettingsRow>
      </SettingsCard>

      <SettingsCard icon="fa-palette" title="Appearance">
        <SettingsRow
          icon="fas fa-sun"
          label="Light Mode"
          description="Switch between dark and light theme"
        >
          <ToggleSwitch
            id="lightModeToggle"
            label="Light Mode"
            checked={lightMode}
            onChange={(enabled) => actions.setTheme(enabled ? 'light' : 'dark')}
          />
        </SettingsRow>
      </SettingsCard>

      <SettingsCard icon="fa-keyboard" title="Keyboard Shortcuts">
        <div className="shortcut-grid">
          {SHORTCUTS.map((shortcut) => (
            <div className="shortcut-row" key={shortcut.description}>
              <span className="shortcut-keys">
                {shortcut.keys.map((key, index) => (
                  <span key={`${shortcut.description}-${key}`}>
                    {index > 0 ? ' + ' : null}
                    <kbd>{key}</kbd>
                  </span>
                ))}
              </span>
              <span className="shortcut-desc">{shortcut.description}</span>
            </div>
          ))}
        </div>
      </SettingsCard>

      <GDriveSection actions={actions} />

      <SettingsCard icon="fa-sliders-h" title="Limits">
        <SettingsRow
          icon="fas fa-layer-group"
          label="Limit pinned collections"
          description="Restrict how many collections can be pinned"
        >
          <ToggleSwitch
            id="enforceMaxPinnedCollectionsToggle"
            label="Limit pinned collections"
            checked={enforceCollections}
            onChange={(enabled) => actions.setEnforcePinnedCollections(enabled, maxCollections)}
          />
          <LimitInput
            id="maxPinnedCollectionsInput"
            label="Maximum pinned collections"
            value={maxCollections}
            min={1}
            max={20}
            disabled={!enforceCollections}
            onCommit={(raw) => actions.setPinnedLimit('collections', raw)}
          />
        </SettingsRow>

        <SettingsRow
          icon="fas fa-thumbtack"
          label="Limit pinned tabs per collection"
          description="Restrict how many tabs can be pinned per collection"
        >
          <ToggleSwitch
            id="enforceMaxPinnedTabsToggle"
            label="Limit pinned tabs per collection"
            checked={enforceTabs}
            onChange={(enabled) => actions.setEnforcePinnedTabs(enabled, maxTabs)}
          />
          <LimitInput
            id="maxPinnedTabsInput"
            label="Maximum pinned tabs per collection"
            value={maxTabs}
            min={1}
            max={50}
            disabled={!enforceTabs}
            onCommit={(raw) => actions.setPinnedLimit('tabs', raw)}
          />
        </SettingsRow>
      </SettingsCard>
    </Modal>
  );
}
