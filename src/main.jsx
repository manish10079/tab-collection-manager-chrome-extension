import { createRoot } from 'react-dom/client';
import { App } from './app/App.jsx';
import { ToastProvider } from './app/providers/ToastProvider.jsx';
import { hydrate, startStorageSync } from './store/store.js';

// Vendor stylesheets, self-hosted so the panel has no remote assets (Phase 5.4). Vite bundles
// them and emits the fonts they reference into dist/assets.
//
// Font Awesome is pinned to 6.4.0 — the version the CDN link used to serve. `all.min.css` is
// imported rather than the per-style files because it also declares the legacy
// `'Font Awesome 5 Free'` family that two `::before` icons in `popup.css` ask for.
import '@fortawesome/fontawesome-free/css/all.min.css';
// Weights actually used by the stylesheet (300 was requested from the CDN but never used,
// and 900 is left out on purpose: nothing loaded a 900 face before either).
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';

import './styles/shell.css';

// The single entry point of the panel. `src/sidepanel.html` is the Vite HTML entry, so this module
// is what the built page loads; there is no legacy script and no store bridge (Phase 5.3).
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
