// The toolbar action opens the side panel. There is no `default_popup`, so `action.onClicked`
// fires instead of a popup being shown (manifest.json, skill.md §2.2).
import { api } from './api.js';

/** Open the side panel for the window whose toolbar icon was clicked. */
export function registerPanelAction() {
  api.action.onClicked.addListener(async (tab) => {
    await api.sidePanel.open({ windowId: tab.windowId });
  });
}
