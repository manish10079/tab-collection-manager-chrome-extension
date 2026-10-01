import { createRoot } from 'react-dom/client';
import { App } from './app/App.jsx';
import { publishLegacyHandle } from './app/legacy-handle.js';
import { publishStoreBridge } from './app/legacy-store.js';
import { hydrate, startStorageSync } from './store/store.js';
import './styles/shell.css';

// React renders into the legacy `#collectionsContainer`, which keeps the stylesheet, the grid
// layout and the remaining legacy lookups (global search, keyboard jumps) working unchanged.
const container = document.getElementById('collectionsContainer');

if (container) {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) {
    // Opened outside an extension context (e.g. the page opened directly in a tab).
    container.textContent = 'React UI: chrome.storage unavailable — open the extension side panel.';
  } else {
    // Published before the first hydrate finishes: the legacy `popup.js` reads state from its
    // DOMContentLoaded handlers, which run after this module either way, but a missing bridge
    // is a hard error for it rather than a silent second write path.
    publishStoreBridge();
    startStorageSync();
    hydrate();
    publishLegacyHandle();
    createRoot(container).render(<App mountPoint={container} />);
  }
}
