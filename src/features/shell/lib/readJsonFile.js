// Ask the user for a JSON file and resolve its parsed contents. The legacy importer built the
// input inline inside an event handler; this keeps the DOM part in one place and lets the caller
// report a parse failure as a toast instead of an `alert()`.

/**
 * @typedef {{ok: true, data: unknown} | {ok: false}} JsonFileResult
 */

/**
 * Open the file picker and resolve the parsed JSON.
 *
 * Resolves `null` when the user cancels, `{ok: false}` when the file is not valid JSON, and
 * `{ok: true, data}` otherwise.
 *
 * @returns {Promise<JsonFileResult|null>}
 */
export function readJsonFile() {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';

    input.addEventListener('change', () => {
      const file = input.files && input.files[0];
      if (!file) {
        resolve(null);
        return;
      }

      const reader = new FileReader();
      reader.addEventListener('load', (event) => {
        try {
          const text = String(event.target?.result ?? '');
          resolve({ ok: true, data: JSON.parse(text) });
        } catch {
          resolve({ ok: false });
        }
      });
      reader.addEventListener('error', () => resolve({ ok: false }));
      reader.readAsText(file);
    });

    // A cancelled picker fires no `change` event in most browsers; the promise then simply never
    // settles, which is fine for a user-initiated dialog that they can reopen.
    input.click();
  });
}
