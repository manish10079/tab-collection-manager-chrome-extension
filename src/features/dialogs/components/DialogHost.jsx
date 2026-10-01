import { useCollections } from '../../../store/hooks.js';
import { AddTabsModal } from './AddTabsModal.jsx';
import { DuplicateUrlDialog } from './DuplicateUrlDialog.jsx';
import { HistoryModal } from './HistoryModal.jsx';
import { SessionDetailsModal } from './SessionDetailsModal.jsx';
import { ShortcutsHelpModal } from './ShortcutsHelpModal.jsx';

/**
 * @typedef {object} DialogHostProps
 * @property {ReturnType<import('../hooks/useDialogs.js').useDialogs>} dialogs
 */

/**
 * Renders whichever dialogs are open. Keeping the mapping in one place means `App` stays a shell
 * and the dialogs stay independently mountable in tests. Order is load-bearing: a dialog rendered
 * later mounts its portal later, so it paints and stacks above the one before it — the duplicate
 * prompt above add-tabs, and session details above history.
 *
 * @param {DialogHostProps} props
 * @returns {import('react').ReactElement}
 */
export function DialogHost({ dialogs }) {
  const { state, actions, intake, settleDuplicates } = dialogs;
  const collections = useCollections();
  const target = state.addTabsFor
    ? collections.find((collection) => collection.id === state.addTabsFor)
    : null;

  return (
    <>
      {target ? (
        <AddTabsModal collection={target} intake={intake} onClose={actions.closeAddTabs} />
      ) : null}
      {state.duplicateRequest ? (
        <DuplicateUrlDialog request={state.duplicateRequest} onSettle={settleDuplicates} />
      ) : null}
      {state.historyOpen ? (
        <HistoryModal
          onClose={actions.closeHistory}
          onOpenDetails={actions.openDetails}
          onOpenAll={actions.openAllFromHistory}
        />
      ) : null}
      {state.sessionDetails ? (
        <SessionDetailsModal
          session={state.sessionDetails.session}
          label={state.sessionDetails.label}
          onClose={actions.closeDetails}
        />
      ) : null}
      {state.shortcutsOpen ? <ShortcutsHelpModal onClose={actions.closeShortcuts} /> : null}
    </>
  );
}
