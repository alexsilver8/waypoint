// Shortcuts: run any of your Shortcuts from the launcher, through the `shortcuts` command that
// comes with macOS 12 and later. That reaches things with no command of their own, like
// turning on a Focus. The ones you ran last come first. The launcher closes before a shortcut
// runs, so one that works on the app in front gets yours; a failure comes as a notification.
import { execFile, spawn } from 'node:child_process';
import { failureReason, group, parseFolders, parseList, remember, shellQuote, withFolders } from './shortcuts.js';

/** @typedef {import('@waypoint-org/api').Extension} Extension */
/** @typedef {import('@waypoint-org/api').ExtensionContext} Context */
/** @typedef {import('@waypoint-org/api').ListItem} ListItem */
/** @typedef {import('@waypoint-org/api').ListSection} ListSection */
/** @typedef {import('@waypoint-org/api').ListView} ListView */
/** @typedef {import('@waypoint-org/api').ActionResult} ActionResult */
/** @typedef {import('./shortcuts.js').Shortcut} Shortcut */

const SHORTCUTS = '/usr/bin/shortcuts';
const CACHE_MS = 60_000;
/** What listing may take in all: the launcher gives up on an extension after 10 seconds. */
const BUDGET_MS = 8000;
/** Time for the launcher to close and the app you were in to come back to the front. */
const AFTER_HIDE_MS = 300;
const SHORTCUTS_APP = '/System/Applications/Shortcuts.app';

/** @type {{ at: number, shortcuts: Shortcut[] } | undefined} */
let cache;

/** @param {unknown} error */
const isMissing = (error) => /** @type {NodeJS.ErrnoException} */ (error)?.code === 'ENOENT';

/**
 * @param {string[]} args
 * @param {number} [timeout]
 * @returns {Promise<string>}
 */
function shortcuts(args, timeout = BUDGET_MS) {
  return new Promise((resolve, reject) => {
    execFile(SHORTCUTS, args, { timeout, maxBuffer: 8 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (!error) return resolve(stdout);
      const reason = failureReason(`${stderr}`);
      if (reason && !isMissing(error)) error.message = reason;
      reject(error);
    });
  });
}

/**
 * Every shortcut, with its folder. Folders are asked for one by one, together; if that
 * doesn't work out, the list comes without them.
 * @returns {Promise<Shortcut[]>}
 */
async function loadShortcuts() {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.shortcuts;
  const deadline = Date.now() + BUDGET_MS;
  const [all, folders] = await Promise.all([
    shortcuts(['list', '--show-identifiers'], 5000).then((output) => parseList(output)),
    shortcuts(['list', '--folders'], 5000)
      .then(parseFolders)
      .catch(() => []),
  ]);
  /** @type {Shortcut[][]} */
  let byFolder = [];
  // Folders only with the time left for them; the list works without.
  const left = deadline - Date.now() - 500;
  if (folders.length > 0 && left > 1000) {
    try {
      byFolder = await Promise.all(
        folders.map((folder) =>
          shortcuts(['list', '--folder-name', folder, '--show-identifiers'], left).then((output) =>
            parseList(output, folder),
          ),
        ),
      );
    } catch {
      // Shown without folders.
    }
  }
  const list = withFolders(all, byFolder);
  cache = { at: Date.now(), shortcuts: list };
  return list;
}

/** @param {Context} ctx */
function recentIds(ctx) {
  const value = ctx.storage.get('recent');
  return Array.isArray(value) ? value.filter((id) => typeof id === 'string') : [];
}

/**
 * @param {Shortcut} shortcut
 * @returns {ListItem}
 */
function shortcutItem(shortcut) {
  return {
    id: shortcut.id,
    title: shortcut.name,
    icon: { path: SHORTCUTS_APP },
    keywords: shortcut.folder ? [shortcut.folder] : undefined,
    actions: [
      { type: 'callback', id: 'run', title: 'Run Shortcut', payload: { id: shortcut.id, name: shortcut.name } },
      { type: 'callback', id: 'edit', title: 'Edit in Shortcuts', payload: shortcut.name },
      { type: 'copy', text: shortcut.name, title: 'Copy Name', shortcut: { key: 'c', modifiers: ['mod', 'shift'] } },
      { type: 'copy', text: `shortcuts run ${shellQuote(shortcut.name)}`, title: 'Copy Command to Run It' },
      { type: 'callback', id: 'refresh', title: 'Refresh', shortcut: { key: 'r', modifiers: ['mod'] } },
    ],
  };
}

/** @type {ListSection} */
const APP_SECTION = {
  title: 'Shortcuts app',
  items: [
    {
      id: 'create',
      title: 'Create a Shortcut',
      icon: { path: SHORTCUTS_APP },
      actions: [{ type: 'open-url', url: 'shortcuts://create-shortcut', title: 'Create a Shortcut' }],
    },
    {
      id: 'open-app',
      title: 'Open Shortcuts',
      icon: { path: SHORTCUTS_APP },
      actions: [{ type: 'open-path', path: SHORTCUTS_APP, title: 'Open Shortcuts' }],
    },
  ],
};

/**
 * @param {Context} ctx
 * @returns {Promise<ListView>}
 */
async function runView(ctx) {
  const base = {
    type: /** @type {const} */ ('list'),
    title: 'Shortcuts',
    searchPlaceholder: 'Search your shortcuts…',
  };
  /** @type {Shortcut[]} */
  let list;
  try {
    list = await loadShortcuts();
  } catch (error) {
    return {
      ...base,
      emptyText: isMissing(error)
        ? 'Running shortcuts needs macOS 12 or later.'
        : `Couldn't list your shortcuts: ${error instanceof Error ? error.message : String(error)}`,
      sections: [],
    };
  }
  return {
    ...base,
    emptyText: 'No shortcuts match.',
    sections: [
      ...group(list, recentIds(ctx)).map((section) => ({
        title: section.title,
        items: section.shortcuts.map(shortcutItem),
      })),
      APP_SECTION,
    ],
  };
}

/**
 * Shows a macOS notification: how a shortcut's failure is told, once the launcher has closed.
 * @param {string} title
 * @param {string} body
 */
function notify(title, body) {
  execFile(
    'osascript',
    [
      '-e',
      'on run argv',
      '-e',
      'display notification (item 2 of argv) with title (item 1 of argv)',
      '-e',
      'end run',
      title,
      body,
    ],
    { timeout: 5000 },
    () => {},
  );
}

/**
 * Runs a shortcut on its own, telling you with a notification if it fails.
 * @param {string} name
 */
function runShortcut(name) {
  const child = spawn(SHORTCUTS, ['run', name], { detached: true, stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  child.stderr?.setEncoding('utf8');
  child.stderr?.on('data', (/** @type {string} */ text) => {
    stderr += text;
  });
  const title = `“${name}” didn't run`;
  child.once('error', (error) =>
    notify(title, isMissing(error) ? 'Running shortcuts needs macOS 12 or later.' : error.message),
  );
  child.once('exit', (code) => {
    if (code) notify(title, failureReason(stderr) || `It stopped with exit code ${code}.`);
  });
}

/**
 * @param {string} id
 * @param {unknown} payload
 * @param {Context} ctx
 * @returns {Promise<ActionResult | undefined>}
 */
async function onAction(id, payload, ctx) {
  if (id === 'refresh') {
    cache = undefined;
    return { replace: await runView(ctx) };
  }
  if (id === 'run' && typeof payload === 'object' && payload !== null && !Array.isArray(payload)) {
    const { id: shortcutId, name } = /** @type {{ id?: unknown, name?: unknown }} */ (payload);
    if (typeof shortcutId !== 'string' || typeof name !== 'string') return undefined;
    ctx.storage.set('recent', remember(recentIds(ctx), shortcutId));
    setTimeout(() => runShortcut(name), AFTER_HIDE_MS);
    return { hide: true };
  }
  if (id === 'edit' && typeof payload === 'string') {
    try {
      await shortcuts(['view', payload]);
    } catch (error) {
      return {
        toast: `Couldn't open it in Shortcuts: ${error instanceof Error ? error.message : String(error)}`,
        toastStyle: 'failure',
      };
    }
    return { hide: true };
  }
  return undefined;
}

/** @type {Extension} */
export default {
  commands: {
    run: { view: runView, onAction },
  },
};
