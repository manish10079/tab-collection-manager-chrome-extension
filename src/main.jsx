import { createRoot } from 'react-dom/client';
import { App } from './app/App.jsx';
import { ToastProvider } from './app/providers/ToastProvider.jsx';
import { hydrate, startStorageSync } from './store/store.js';
import './styles/shell.css';

// The single entry point of the panel. `src/sidepanel.html` is the Vite HTML entry, so this module
// is what the built page loads; there is no legacy script and no store bridge any more
// (react-migration-plan.md §8, Phase 5.3).
const container = document.getElementById('root');

if (container) {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) {
    // Opened outside an extension context (e.g. the page opened directly in a tab).
    container.textContent = 'React UI: chrome.storage unavailable — open the extension side panel.';
  } else {
    // Start syncing and kick off the first read; the app paints from whatever the store holds and
    // re-renders when this lands. The worker auto-save and the opened-state normalisation follow in
    // `useBootSequence`.
    startStorageSync();
    hydrate();
    createRoot(container).render(
      <ToastProvider>
        <App />
      </ToastProvider>
    );
  }
}
