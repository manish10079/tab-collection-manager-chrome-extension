import { createRoot } from 'react-dom/client';
import { App } from './app/App.jsx';
import { ToastProvider } from './app/providers/ToastProvider.jsx';
import { publishStoreBridge } from './app/legacy-store.js';
import { hydrate, startStorageSync } from './store/store.js';
import './styles/shell.css';

// Since Phase 5.2 React renders the whole panel — header, controls bar, search results and the
// collection list — into `#appRoot`, which popup.html leaves inside `.container`. The boot script
// (`popup.js`) only talks to the store bridge published below.
const container = document.getElementById('appRoot');

if (container) {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) {
    // Opened outside an extension context (e.g. the page opened directly in a tab).
    container.textContent = 'React UI: chrome.storage unavailable — open the extension side panel.';
  } else {
    // Published before the first hydrate finishes: `popup.js` reads state from its
    // DOMContentLoaded handler, which runs after this module either way, but a missing bridge
    // is a hard error for it rather than a silent second write path.
    publishStoreBridge();
    startStorageSync();
    hydrate();
    createRoot(container).render(
      <ToastProvider>
        <App />
      </ToastProvider>
    );
  }
}
