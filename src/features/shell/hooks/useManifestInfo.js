import { useState } from 'react';

/**
 * The extension's display name and version, read once from the manifest. The legacy shell wrote
 * these into `#app-name` / `#version` on `DOMContentLoaded`; reading them in a state initializer
 * means the header never renders a blank first pass.
 *
 * @returns {{name: string, version: string}}
 */
export function useManifestInfo() {
  const [info] = useState(() => {
    try {
      const manifest = chrome.runtime.getManifest();
      return { name: manifest.name, version: manifest.version };
    } catch {
      // Outside an extension context (a plain tab, a component test without the mock).
      return { name: 'Tab Collection Manager', version: '' };
    }
  });
  return info;
}
