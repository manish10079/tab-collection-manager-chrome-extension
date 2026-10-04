import { useConfirm } from '../../../app/providers/useConfirm.js';
import { SettingsCard } from './SettingsCard.jsx';
import { SettingsRow } from './SettingsRow.jsx';
import { ToggleSwitch } from './ToggleSwitch.jsx';
import { useGDrive } from '../hooks/useGDrive.js';

/**
 * @typedef {object} GDriveSectionProps
 * @property {import('../hooks/useSettingsActions.js').SettingsActions} actions
 */

/**
 * Cloud Backup: the enable toggle, and — only once the worker reports it enabled — the daily
 * auto-backup toggle, the last-backup stamp and the three actions.
 *
 * @param {GDriveSectionProps} props
 * @returns {import('react').ReactElement}
 */
export function GDriveSection({ actions }) {
  const confirm = useConfirm();
  const gdrive = useGDrive(actions);
  const { status, busy } = gdrive;
  const lastBackup = status.lastBackupTime
    ? `Last backup: ${new Date(status.lastBackupTime).toLocaleDateString()} ${new Date(
        status.lastBackupTime
      ).toLocaleTimeString()}`
    : 'Last backup: —';

  return (
    <SettingsCard icon="fa-cloud" title="Cloud Backup" badge="☁️ Google Drive">
      {status.enabled ? (
        <SettingsRow
          icon="fas fa-user-circle"
          avatar={status.accountPicture || undefined}
          label={status.accountName || 'Signed in'}
          description={status.accountEmail || 'Google account connected'}
        />
      ) : null}

      <SettingsRow
        icon="fab fa-google-drive"
        label="Enable Cloud Backup"
        description="Save all collections to your Google Drive (private app data folder)"
      >
        <ToggleSwitch
          id="gdriveBackupToggle"
          label="Enable Cloud Backup"
          checked={status.enabled}
          disabled={busy !== null}
          onChange={(checked) => {
            if (checked === true) gdrive.setEnabled(true);
            else gdrive.setEnabled(false);
          }}
        />
      </SettingsRow>

      {status.enabled ? (
        <SettingsRow
          icon="fas fa-sync-alt"
          label="Auto-Backup Daily"
          description="Automatically back up once per day in the background"
        >
          <ToggleSwitch
            id="gdriveAutoBackupToggle"
            label="Auto-Backup Daily"
            checked={status.autoBackupEnabled}
            disabled={busy !== null}
            onChange={gdrive.setAutoBackup}
          />
        </SettingsRow>
      ) : null}

      {status.enabled ? (
        <SettingsRow
          icon="fas fa-clock"
          label={lastBackup}
          description="Stored in your private Drive app data folder"
        />
      ) : null}

      {status.enabled ? (
        <div className="set-settings-row-actions">
          <button
            type="button"
            className="sh-btn-secondary set-cloud-backup-btn"
            disabled={busy !== null}
            onClick={gdrive.backupNow}
          >
            <i
              className={`fas ${busy === 'backup' ? 'fa-spinner fa-spin' : 'fa-cloud-upload-alt'}`}
            />{' '}
            {busy === 'backup' ? 'Backing up...' : 'Backup Now'}
          </button>
          <button
            type="button"
            className="sh-btn-secondary set-cloud-backup-btn"
            disabled={busy !== null}
            onClick={async () => {
              const proceed = await confirm({
                title: 'Restore from Google Drive',
                message:
                  'This will overwrite your current collections with the Google Drive backup. Continue?',
                confirmLabel: 'Restore',
              });
              if (!proceed) return;
              gdrive.restore();
            }}
          >
            <i
              className={`fas ${busy === 'restore' ? 'fa-spinner fa-spin' : 'fa-cloud-download-alt'}`}
            />{' '}
            {busy === 'restore' ? 'Restoring...' : 'Restore from Drive'}
          </button>
          <button
            type="button"
            className="sh-btn-outline set-cloud-backup-btn"
            disabled={busy !== null}
            onClick={async () => {
              const proceed = await confirm({
                title: 'Disconnect Google Drive',
                message: 'Disconnect Google Drive? This will remove the backup from Drive.',
                confirmLabel: 'Disconnect',
                danger: true,
              });
              if (!proceed) return;
              gdrive.disconnect();
            }}
          >
            <i className="fas fa-unlink" /> Disconnect
          </button>
        </div>
      ) : null}
    </SettingsCard>
  );
}
