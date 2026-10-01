import { useEffect, useRef } from 'react';
import { hydrate, mutate } from '../../store/store.js';
import { normalizeOpenedState } from '../../store/openedState.js';

/**
 * The panel's start-up work, lifted out of the deleted `popup.js` in Phase 5.3: ask the worker for
 * an auto-save of the live session, re-read storage (the write comes from a different context), and
 * then normalise the opened state through the same queue everything else uses.
 *
 * The theme is not this hook's job — `useThemeAttribute` applies it as soon as the first hydration
 * lands, which is when the deleted boot script applied it too.
 *
 * Runs once per mount. `main.jsx` has already started the first hydration, so the panel paints
 * immediately and this fills in behind it.
 *
 * @returns {void}
 */
export function useBootSequence() {
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    (async () => {
      try {
        await chrome.runtime.sendMessage({ command: 'forceAutoSave' });
      } catch (error) {
        console.warn('[boot] failed to force auto-save on panel open:', error);
      }

      try {
        await hydrate();
        await mutate((draft) => {
          normalizeOpenedState(draft);
        });
      } catch (error) {
        console.warn('[boot] failed to normalise the opened state:', error);
      }
    })();
  }, []);
}
