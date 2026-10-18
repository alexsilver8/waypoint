// Where Chromium browsers keep their bookmarks, and reading them. Chrome, Brave, Edge, Vivaldi
// and Chromium all write the same JSON file (`Bookmarks`) in each profile's folder, and list
// their profiles in `Local State`. Kept free of side effects so it can be tested anywhere.
import { join } from 'node:path';

/**
 * The files a profile keeps bookmarks in: `Bookmarks`, and `AccountBookmarks` for the ones
 * Chrome saves to your Google Account without syncing everything.
 */
export const BOOKMARK_FILES = ['Bookmarks', 'AccountBookmarks'];

/**
 * @typedef {object} Browser
 * @property {string} id
 * @property {string} name
 * @property {Partial<Record<'darwin' | 'win32' | 'linux', string[]>>} dirs Where its user data
 *   folder may be: macOS under Application Support, Windows under %LOCALAPPDATA%, Linux under
 *   ~/.config, or a Flatpak or Snap folder.
 * @property {string} [bundleId] Its macOS bundle identifier.
 * @property {string} [macApp] The app's name on macOS, which is also its program's name.
 * @property {string[]} [windowsExe] Where its program installs on Windows, under Program Files
 *   or %LOCALAPPDATA%.
 * @property {string[]} [linuxCommands] Its commands on Linux; a Flatpak's is its app ID.
 */

/** @type {Browser[]} */
export const BROWSERS = [
  {
    id: 'chrome',
    name: 'Chrome',
    dirs: {
      darwin: ['Google/Chrome'],
      win32: ['Google\\Chrome\\User Data'],
      linux: ['google-chrome', '~/.var/app/com.google.Chrome/config/google-chrome'],
    },
    bundleId: 'com.google.Chrome',
    macApp: 'Google Chrome',
    windowsExe: ['Google\\Chrome\\Application\\chrome.exe'],
    linuxCommands: ['google-chrome', 'google-chrome-stable', 'com.google.Chrome'],
  },
  {
    id: 'brave',
    name: 'Brave',
    dirs: {
      darwin: ['BraveSoftware/Brave-Browser'],
      win32: ['BraveSoftware\\Brave-Browser\\User Data'],
      linux: ['BraveSoftware/Brave-Browser', '~/.var/app/com.brave.Browser/config/BraveSoftware/Brave-Browser'],
    },
    bundleId: 'com.brave.Browser',
    macApp: 'Brave Browser',
    windowsExe: ['BraveSoftware\\Brave-Browser\\Application\\brave.exe'],
    linuxCommands: ['brave-browser', 'brave', 'com.brave.Browser'],
  },
  {
    id: 'edge',
    name: 'Edge',
    dirs: {
      darwin: ['Microsoft Edge'],
      win32: ['Microsoft\\Edge\\User Data'],
      linux: ['microsoft-edge', '~/.var/app/com.microsoft.Edge/config/microsoft-edge'],
    },
    bundleId: 'com.microsoft.edgemac',
    macApp: 'Microsoft Edge',
    windowsExe: ['Microsoft\\Edge\\Application\\msedge.exe'],
    linuxCommands: ['microsoft-edge', 'microsoft-edge-stable', 'com.microsoft.Edge'],
  },
  {
    id: 'vivaldi',
    name: 'Vivaldi',
    dirs: { darwin: ['Vivaldi'], win32: ['Vivaldi\\User Data'], linux: ['vivaldi'] },
    bundleId: 'com.vivaldi.Vivaldi',
    macApp: 'Vivaldi',
    windowsExe: ['Vivaldi\\Application\\vivaldi.exe'],
    linuxCommands: ['vivaldi', 'vivaldi-stable'],
  },
  {
    id: 'chromium',
    name: 'Chromium',
    dirs: {
      darwin: ['Chromium'],
      win32: ['Chromium\\User Data'],
      linux: ['chromium', '~/snap/chromium/common/chromium', '~/.var/app/org.chromium.Chromium/config/chromium'],
    },
    bundleId: 'org.chromium.Chromium',
    macApp: 'Chromium',
    windowsExe: ['Chromium\\Application\\chrome.exe'],
    linuxCommands: ['chromium', 'chromium-browser', 'org.chromium.Chromium'],
  },
];

/**
 * The folders a browser's user data may be in on this system.
 * @param {Browser} browser
 * @param {string} platform
 * @param {{ home: string, localAppData?: string }} places
 * @returns {string[]}
 */
export function userDataDirs(browser, platform, { home, localAppData }) {
  const dirs = browser.dirs[/** @type {'darwin' | 'win32' | 'linux'} */ (platform)] ?? [];
  return dirs.map((dir) => {
    if (dir.startsWith('~/')) return join(home, dir.slice(2));
    if (platform === 'darwin') return join(home, 'Library', 'Application Support', dir);
    if (platform === 'win32') return join(localAppData ?? join(home, 'AppData', 'Local'), dir);
    return join(home, '.config', dir);
  });
}

/**
 * The profiles `Local State` lists, by folder name: `{ Default: 'Alex', 'Profile 1': 'Work' }`.
 * @param {unknown} localState
 * @returns {Record<string, string>}
 */
export function profileNames(localState) {
  const cache = /** @type {any} */ (localState)?.profile?.info_cache;
  if (typeof cache !== 'object' || cache === null) return {};
  /** @type {Record<string, string>} */
  const names = {};
  for (const [dir, info] of Object.entries(cache)) {
    const name = /** @type {any} */ (info)?.name;
    names[dir] = typeof name === 'string' && name.trim() ? name.trim() : dir;
  }
  return names;
}

/**
 * Chromium counts time in microseconds since 1601, as strings.
 * @param {unknown} value
 * @returns {number | undefined} Milliseconds since 1970.
 */
export function chromeTime(value) {
  const micros = typeof value === 'string' ? Number(value) : typeof value === 'number' ? value : Number.NaN;
  if (!Number.isFinite(micros) || micros <= 0) return undefined;
  return Math.round(micros / 1000 - 11_644_473_600_000);
}

/**
 * @typedef {object} Bookmark
 * @property {string} title
 * @property {string} url
 * @property {string} folder Where it is, like "Bookmarks bar › Dev".
 * @property {number} [added] In ms.
 * @property {number} [used] When it was last opened, in ms; Chromium has kept this since 2021.
 */

/**
 * Every web bookmark in a `Bookmarks` file, in the order the browser shows them. Bookmarklets
 * (`javascript:`) and the browser's own pages are left out: neither opens from outside it.
 * @param {unknown} json
 * @returns {Bookmark[]}
 */
export function parseBookmarks(json) {
  const roots = /** @type {any} */ (json)?.roots;
  if (typeof roots !== 'object' || roots === null) return [];
  /** @type {Bookmark[]} */
  const found = [];
  /**
   * @param {any} node
   * @param {string[]} path
   * @param {number} depth
   */
  const walk = (node, path, depth) => {
    if (typeof node !== 'object' || node === null || depth > 50) return;
    if (node.type === 'url') {
      const url = typeof node.url === 'string' ? node.url.trim() : '';
      if (!/^https?:\/\//i.test(url)) return;
      const name = typeof node.name === 'string' ? node.name.trim() : '';
      const added = chromeTime(node.date_added);
      const used = chromeTime(node.date_last_used);
      found.push({
        title: name || url,
        url,
        folder: path.join(' › '),
        ...(added ? { added } : {}),
        ...(used ? { used } : {}),
      });
      return;
    }
    if (!Array.isArray(node.children)) return;
    const name = typeof node.name === 'string' && node.name.trim() ? node.name.trim() : undefined;
    const inside = depth === 0 || !name ? path : [...path, name];
    for (const child of node.children) walk(child, inside, depth + 1);
  };
  for (const [key, root] of Object.entries(roots)) {
    if (typeof root !== 'object' || root === null) continue;
    const name = typeof (/** @type {any} */ (root).name) === 'string' ? /** @type {any} */ (root).name : key;
    walk(root, [name], 0);
  }
  return found;
}

/**
 * The host of a URL without `www.`, for showing.
 * @param {string} url
 */
export function hostOf(url) {
  try {
    return new URL(url).host.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/**
 * The same page, however it was written: the scheme and host in any case, without a trailing
 * slash or `#`. The rest keeps its case, which can matter (a video's ID, a document's).
 * @param {string} url
 */
export function sameUrl(url) {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.replace(/\/$/, '');
    return `${parsed.protocol}//${parsed.host}${path}${parsed.search}${parsed.hash === '#' ? '' : parsed.hash}`;
  } catch {
    return url.replace(/#$/, '').replace(/\/$/, '');
  }
}

/**
 * @template {Bookmark} T
 * @param {T} bookmark
 */
const lastTouched = (bookmark) => bookmark.used ?? bookmark.added ?? 0;

/**
 * One bookmark for each page: the one opened most recently, noting where else it is.
 * @template {Bookmark & { source: string }} T
 * @param {T[]} bookmarks
 * @returns {Array<T & { alsoIn: string[] }>}
 */
export function dedupe(bookmarks) {
  /** @type {Map<string, T & { alsoIn: string[] }>} */
  const byUrl = new Map();
  for (const bookmark of bookmarks) {
    const key = sameUrl(bookmark.url);
    const kept = byUrl.get(key);
    if (!kept) {
      byUrl.set(key, { ...bookmark, alsoIn: [] });
      continue;
    }
    const sources = [...new Set([kept.source, ...kept.alsoIn, bookmark.source])];
    const winner = lastTouched(bookmark) > lastTouched(kept) ? bookmark : kept;
    byUrl.set(key, { ...winner, alsoIn: sources.filter((source) => source !== winner.source) });
  }
  return [...byUrl.values()];
}

/**
 * Bookmarks matching every word typed, in their title, address or folder; the best title
 * matches first, then the most recently used. Nothing typed lists them all, latest first.
 * @template {Bookmark} T
 * @param {T[]} bookmarks
 * @param {string} query
 * @returns {T[]}
 */
export function matchBookmarks(bookmarks, query) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const byRecent = (/** @type {T} */ a, /** @type {T} */ b) => lastTouched(b) - lastTouched(a);
  if (words.length === 0) return [...bookmarks].sort(byRecent);
  const whole = words.join(' ');
  /** @param {T} bookmark */
  const rank = (bookmark) => {
    const title = bookmark.title.toLowerCase();
    const host = hostOf(bookmark.url).toLowerCase();
    if (title === whole) return 0;
    if (title.startsWith(whole)) return 1;
    if (host.startsWith(whole)) return 2;
    if (title.includes(whole)) return 3;
    if (words.every((word) => title.includes(word))) return 4;
    return 5;
  };
  return bookmarks
    .filter((bookmark) => {
      const text = `${bookmark.title} ${bookmark.url} ${bookmark.folder}`.toLowerCase();
      return words.every((word) => text.includes(word));
    })
    .map((bookmark) => ({ bookmark, rank: rank(bookmark) }))
    .sort((a, b) => a.rank - b.rank || byRecent(a.bookmark, b.bookmark))
    .map(({ bookmark }) => bookmark);
}

/**
 * "today", "yesterday", "3 days ago", "Mar 2024".
 * @param {number} ms
 * @param {number} now
 */
export function when(ms, now) {
  const days = Math.floor((now - ms) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  return new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'short' });
}
