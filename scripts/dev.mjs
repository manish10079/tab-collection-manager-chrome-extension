// Dev helper: launch a Chromium browser with the built extension loaded, stream the
// background service worker's (and side panel's) console + errors, and reload the
// extension on every source change.
//
// Why the DevTools Protocol: an unpacked extension cannot be reloaded from the outside
// any other way. We drive a throwaway browser profile over CDP and call
// chrome.runtime.reload() inside the service worker itself.
//
// Why browser-level auto-attach: a service worker can throw during startup, before any
// polling loop could notice it. Target.setAutoAttach hands us every worker the moment it
// is created, so startup crashes are reported instead of silently missed.
//
// No dependencies: Node 22+ ships fetch and WebSocket, which is all CDP needs.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, watch } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');

const WATCHED = [
  'manifest.json',
  'background.js',
  'popup.html',
  'popup.js',
  'popup.css',
  'src',
  'vite.config.js',
];
const IGNORED = /(^|[\\/])(node_modules|dist|\.git|\.freebuff)([\\/]|$)/;

const CHROMIUM_CANDIDATES = {
  win32: [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    '%LOCALAPPDATA%/Google/Chrome/Application/chrome.exe',
    'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  ],
  darwin: [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  ],
  linux: [
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/brave-browser',
    '/usr/bin/microsoft-edge',
  ],
};

const MARK = { log: '·', warn: '▲', error: '✖' };

const options = parseArgs(process.argv.slice(2));

let child = null;
let socket = null;
let nextCommandId = 1;
/** Session ids of extension targets we are listening to: sessionId -> {kind, url} */
const sessions = new Map();
let workerSessionId = null;
let extensionId = null;
let initialReloadDone = false;
let pendingBuild = null;
let shuttingDown = false;

/** @param {string[]} argv */
function parseArgs(argv) {
  const parsed = {
    port: 9222,
    attach: false,
    chrome: process.env.CHROME_PATH || '',
    profile: path.join(tmpdir(), 'tcm-dev-profile'),
    watch: true,
    build: true,
    which: false,
    smoke: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--port') parsed.port = Number(argv[++i]);
    else if (arg === '--attach') parsed.attach = true;
    else if (arg === '--chrome') parsed.chrome = argv[++i] ?? '';
    else if (arg === '--profile') parsed.profile = argv[++i] ?? parsed.profile;
    else if (arg === '--no-watch') parsed.watch = false;
    else if (arg === '--no-build') parsed.build = false;
    else if (arg === '--which') parsed.which = true;
    else if (arg === '--smoke') parsed.smoke = true;
    else if (arg === '--help' || arg === '-h') parsed.help = true;
  }

  return parsed;
}

function usage() {
  console.log(`Tab Collection Manager — dev helper

Usage: npm run dev [-- options]

Options
  --port <n>       DevTools port (default 9222)
  --attach         Attach to an already-running browser with that port instead of launching
  --chrome <path>  Browser binary to launch (default: auto-detect Chrome/Brave/Edge)
  --profile <dir>  Profile directory for the throwaway instance
  --no-watch       Do not watch sources or reload automatically
  --no-build       Skip the build step (attach to whatever is already in dist/)
  --which          Print the detected browser path and exit
  --smoke          Launch, wait for the service worker, report startup errors, then exit
  -h, --help       Show this message`);
}

/**
 * Find an installed Chromium-based browser.
 * @param {string} explicit
 * @returns {string} Absolute path, or '' when nothing is found.
 */
function findBrowser(explicit) {
  if (explicit) return explicit;

  for (const candidate of CHROMIUM_CANDIDATES[process.platform] ?? []) {
    const resolved = candidate.replace('%LOCALAPPDATA%', process.env.LOCALAPPDATA ?? '');
    if (existsSync(resolved)) return resolved;
  }
  return '';
}

/** @param {number} ms */
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** @param {number} ms */
function withTimeout(ms, promise) {
  return Promise.race([promise, delay(ms).then(() => null)]);
}

/** @param {string} text */
function firstLine(text) {
  return String(text).split('\n')[0];
}

/**
 * Run the build and report only failures in full.
 * @returns {boolean}
 */
function runBuild() {
  const started = Date.now();
  const result = spawnSync(process.execPath, [path.join(root, 'scripts', 'build.mjs')], {
    cwd: root,
    encoding: 'utf8',
  });

  if (result.status === 0) {
    console.log(`[dev] build ok (${Date.now() - started}ms)`);
    return true;
  }

  console.error('[dev] build failed:');
  console.error(result.stdout?.trim() ?? '');
  console.error(result.stderr?.trim() ?? '');
  return false;
}

// ── CDP plumbing ────────────────────────────────────────────────────────────────

/**
 * Resolve the browser-level DevTools websocket.
 * @param {number} port
 * @returns {Promise<string>}
 */
async function browserEndpoint(port) {
  const response = await fetch(`http://127.0.0.1:${port}/json/version`);
  if (!response.ok) throw new Error(`DevTools answered ${response.status}`);
  const info = await response.json();
  return /** @type {string} */ (info.webSocketDebuggerUrl);
}

/**
 * Wait until the DevTools endpoint answers.
 * @param {number} port
 * @param {number} timeoutMs
 */
async function waitForEndpoint(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      return await browserEndpoint(port);
    } catch {
      await delay(300);
    }
  }
  return null;
}

/**
 * Send a CDP command, optionally scoped to a target session.
 * @param {string} method
 * @param {Record<string, unknown>} params
 * @param {string} [sessionId]
 */
function send(method, params = {}, sessionId) {
  if (!socket || socket.readyState !== 1) return;
  const message = { id: nextCommandId++, method, params };
  if (sessionId) message.sessionId = sessionId;
  socket.send(JSON.stringify(message));
}

/**
 * Open the browser-level connection and switch on auto-attach.
 * @param {string} wsUrl
 */
function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    socket = new WebSocket(wsUrl);

    socket.addEventListener('open', () => {
      send('Target.setDiscoverTargets', { discover: true });
      // waitForDebuggerOnStart is what makes startup crashes visible: the worker is
      // paused before its script runs, so we enable Runtime/Log first, then resume it.
      send('Target.setAutoAttach', {
        autoAttach: true,
        waitForDebuggerOnStart: true,
        flatten: true,
      });
      resolve(undefined);
    });

    socket.addEventListener('message', (event) => {
      let message;
      try {
        message = JSON.parse(String(event.data));
      } catch {
        return;
      }
      handleMessage(message);
    });

    socket.addEventListener('error', () => reject(new Error('CDP connection failed')));
    socket.addEventListener('close', () => {
      if (!shuttingDown) {
        sessions.clear();
        workerSessionId = null;
      }
    });
  });
}

/**
 * Route a CDP message: target lifecycle events and the console output we care about.
 * @param {Record<string, any>} message
 */
function handleMessage(message) {
  const { method, params, sessionId } = message;

  if (method === 'Target.attachedToTarget') {
    const info = params?.targetInfo ?? {};
    const url = String(info.url ?? '');
    const isExtension = url.startsWith('chrome-extension://');

    const sessionId = String(params.sessionId);

    if (isExtension) {
      const kind = info.type === 'service_worker' ? 'sw' : 'panel';
      sessions.set(sessionId, { kind, url });
      if (kind === 'sw' && !extensionId) {
        extensionId = new URL(url).host;
      }
      if (kind === 'sw') workerSessionId = sessionId;
      console.log(`[dev] ${kind === 'sw' ? 'service worker' : 'extension page'} attached — ${url}`);
      // Enable the domains that carry console output and exceptions.
      send('Runtime.enable', {}, sessionId);
      send('Log.enable', {}, sessionId);
    }

    // Every paused target must be resumed, extension or not, or the browser hangs.
    send('Runtime.runIfWaitingForDebugger', {}, sessionId);
    return;
  }

  if (method === 'Target.detachedFromTarget') {
    const id = String(params?.sessionId);
    const session = sessions.get(id);
    if (session) {
      sessions.delete(id);
      if (id === workerSessionId) {
        workerSessionId = null;
        console.log('[dev] service worker stopped (idle or reloading)');
      }
    }
    return;
  }

  if (!sessionId || !sessions.has(String(sessionId))) return;
  const kind = sessions.get(String(sessionId)).kind;
  const tag = kind === 'sw' ? 'sw' : 'panel';

  if (method === 'Runtime.consoleAPICalled') {
    const text = (params.args ?? []).map(formatArg).join(' ');
    const type = params.type === 'error' ? 'error' : params.type === 'warning' ? 'warn' : 'log';
    const line = `[${tag} ${MARK[type] ?? '·'}] ${text}`;
    if (type === 'error') console.error(line);
    else console.log(line);
    return;
  }

  if (method === 'Runtime.exceptionThrown') {
    const details = params.exceptionDetails ?? {};
    const text = details.exception?.description ?? details.text ?? 'Unknown error';
    console.error(`[${tag} ${MARK.error}] ${firstLine(text)}`);
    for (const frame of (details.stackTrace?.callFrames ?? []).slice(0, 3)) {
      console.error(
        `           at ${frame.functionName || '<anonymous>'} (${frame.url}:${frame.lineNumber + 1})`
      );
    }
    return;
  }

  if (method === 'Log.entryAdded') {
    const entry = params.entry ?? {};
    if (entry.level === 'error' || entry.level === 'warning') {
      console.log(
        `[${tag} ${MARK[entry.level] ?? '·'}] ${entry.source ?? 'log'}: ${firstLine(entry.text ?? '')}`
      );
    }
  }
}

/**
 * @param {Record<string, unknown>} arg
 */
function formatArg(arg) {
  if (arg.value !== undefined) {
    return typeof arg.value === 'string' ? arg.value : JSON.stringify(arg.value);
  }
  return String(arg.description ?? arg.unserializableValue ?? arg.type ?? '?');
}

/**
 * Open the side panel page in a tab of the dev browser.
 * It wakes a sleeping service worker after a reload (a reload never fires onInstalled)
 * and streams the panel's own errors alongside the worker's.
 */
function openPanelPage() {
  if (!extensionId) return;
  const alreadyOpen = [...sessions.values()].some((session) => session.kind === 'panel');
  if (alreadyOpen) return;

  const url = `chrome-extension://${extensionId}/sidepanel.html`;
  send('Target.createTarget', { url, background: true });
  console.log('[dev] opened the side panel page in a tab (wakes the worker, streams panel errors)');
}

/** Ask the extension to reload itself, from inside its own service worker. */
function reloadExtension() {
  if (!workerSessionId) {
    console.warn('[dev] reload skipped — service worker not connected');
    return false;
  }
  send(
    'Runtime.evaluate',
    { expression: 'chrome.runtime.reload()', returnByValue: true },
    workerSessionId
  );
  console.log('[dev] extension reload requested');
  return true;
}

// ── Watching, shutdown ──────────────────────────────────────────────────────────

function startWatcher() {
  const trigger = (filename) => {
    if (IGNORED.test(String(filename))) return;
    clearTimeout(pendingBuild);
    pendingBuild = setTimeout(() => {
      console.log(`[dev] change detected: ${filename}`);
      if (options.build && !runBuild()) return;
      if (reloadExtension()) {
        setTimeout(() => {
          openPanelPage();
          console.log('[dev] refresh the side panel tab to see UI changes');
        }, 1500);
      }
    }, 250);
  };

  const watched = [];
  for (const target of WATCHED) {
    const absolute = path.join(root, target);
    if (!existsSync(absolute)) continue;
    try {
      watch(absolute, { recursive: true }, (_event, filename) => trigger(filename ?? target));
      watched.push(target);
    } catch (error) {
      console.warn(`[dev] cannot watch ${target}: ${error.message}`);
    }
  }
  console.log(`[dev] watching: ${watched.join(', ')}`);
}

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;

  clearTimeout(pendingBuild);
  try {
    socket?.close();
  } catch {
    // ignore
  }

  if (child && !child.killed) {
    console.log('[dev] closing the dev browser');
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      child.kill();
    }
  }
  process.exit(0);
}

// ── Main ────────────────────────────────────────────────────────────────────────

async function main() {
  if (options.help) {
    usage();
    return;
  }

  const browser = findBrowser(options.chrome);
  if (options.which) {
    console.log(browser || 'no Chromium browser found (set CHROME_PATH or --chrome)');
    return;
  }

  if (options.build) {
    if (!runBuild()) process.exit(1);
  } else if (!existsSync(path.join(dist, 'manifest.json'))) {
    console.error(`[dev] ${dist} has no manifest — run "npm run build" first`);
    process.exit(1);
  }

  if (!options.attach) {
    if (!browser) {
      console.error('[dev] no Chromium browser found. Pass --chrome <path> or set CHROME_PATH.');
      process.exit(1);
    }

    await mkdir(options.profile, { recursive: true });
    child = spawn(
      browser,
      [
        `--remote-debugging-port=${options.port}`,
        '--remote-allow-origins=*',
        `--user-data-dir=${options.profile}`,
        `--load-extension=${dist}`,
        `--disable-extensions-except=${dist}`,
        '--disable-features=DisableLoadExtensionCommandLineSwitch',
        '--no-first-run',
        '--no-default-browser-check',
        'about:blank',
      ],
      { stdio: 'ignore', detached: false }
    );

    child.on('exit', (code) => {
      if (!shuttingDown) {
        console.log(`[dev] browser exited (code ${code})`);
        shutdown();
      }
    });

    console.log(`[dev] launched ${path.basename(browser)} on port ${options.port}`);
    console.log(`[dev] profile: ${options.profile}`);
  } else {
    console.log(`[dev] attaching to an existing browser on port ${options.port}`);
    console.log('[dev] note: the browser must have been started with --remote-debugging-port');
  }

  const endpoint = await withTimeout(20000, waitForEndpoint(options.port, 20000));
  if (!endpoint) {
    console.error(`[dev] no DevTools endpoint on port ${options.port}`);
    shutdown();
    return;
  }
  await connect(endpoint);

  // Wait for the background worker to attach; auto-attach also catches startup crashes.
  const deadline = Date.now() + 20000;
  while (!workerSessionId && Date.now() < deadline) await delay(200);

  if (!workerSessionId) {
    console.error('[dev] no extension service worker appeared.');
    console.error('      - is the extension loaded unpacked? (load dist/)');
    console.error('      - some browser builds ignore --load-extension; load dist/ by hand');
    console.error('        and start the browser with --remote-debugging-port, then use --attach');
    shutdown();
    return;
  }

  console.log(`[dev] extension id: ${extensionId}`);
  console.log(`[dev] side panel: chrome-extension://${extensionId}/sidepanel.html`);
  console.log('[dev] click the toolbar icon to open the side panel');

  if (!options.attach && !initialReloadDone) {
    // A reused dev profile can serve a cached worker; reloading forces the newest build
    // to load from dist/ — and exercises the same path the watcher uses.
    initialReloadDone = true;
    console.log('[dev] reloading once so the current build is what runs');
    reloadExtension();
    await delay(1500);
    openPanelPage();
    await delay(2000);
  }

  if (options.smoke) {
    await delay(2000);
    console.log('[dev] smoke test ok — service worker reachable and streaming over CDP');
    shutdown();
    return;
  }

  if (options.watch) startWatcher();
  console.log('[dev] Ctrl+C to stop');

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error) => {
  console.error('[dev] failed:', error.message);
  shutdown();
});
