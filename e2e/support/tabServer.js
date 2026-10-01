// A throwaway static server for the multi-select picker.
//
// The picker reads `chrome.tabs.query({ currentWindow: true })` and the intake only accepts URLs
// `new URL()` can parse, so a tab has to be a real page to be worth saving. Serving two pages over
// loopback keeps the test offline and gives the tabs real titles and http URLs.
import { createServer } from 'node:http';

const PAGES = {
  '/alpha': { title: 'Alpha page', heading: 'Alpha' },
  '/beta': { title: 'Beta page', heading: 'Beta' },
};

/**
 * Start the server on an ephemeral port.
 *
 * @returns {Promise<{url: (name: 'alpha'|'beta') => string, close: () => Promise<void>}>}
 */
export async function createTabServer() {
  const server = createServer((request, response) => {
    const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
    const page = PAGES[pathname];
    if (!page) {
      response.writeHead(404, { 'content-type': 'text/plain' });
      response.end('not found');
      return;
    }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(
      `<!doctype html><html><head><meta charset="utf-8"><title>${page.title}</title></head>` +
        `<body><h1>${page.heading}</h1></body></html>`
    );
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = /** @type {import('node:net').AddressInfo} */ (server.address());

  return {
    url: (name) => `http://127.0.0.1:${port}/${name}`,
    close: () =>
      new Promise((resolve) => {
        // The browser's keep-alive sockets would otherwise hold `close()` open until the test
        // timeout; drop them first.
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}
