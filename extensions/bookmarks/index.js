// Browser Bookmarks: search the bookmarks in Chrome, Brave, Edge, Vivaldi and Chromium, in
// every profile, and open one in the browser and profile it's from. The bookmarks you opened
// most recently come first. Nothing is sent anywhere: the browsers' own files are read.
import { execFile, spawn } from 'node:child_process';
import { accessSync, constants, existsSync } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';
import {
  BOOKMARK_FILES,
  BROWSERS,
  dedupe,
  hostOf,
  matchBookmarks,
  parseBookmarks,
  profileNames,
  userDataDirs,
  when,
} from './bookmarks.js';

/** @typedef {import('@waypoint/api').Extension} Extension */
/** @typedef {import('@waypoint/api').ExtensionContext} Context */
/** @typedef {import('@waypoint/api').ListItem} ListItem */
/** @typedef {import('@waypoint/api').ListView} ListView */
/** @typedef {import('@waypoint/api').Icon} Icon */
/** @typedef {import('./bookmarks.js').Browser} Browser */
/** @typedef {import('./bookmarks.js').Bookmark} Bookmark */

/**
 * @typedef {Bookmark & { source: string, browser: string, profile: string }} Found A bookmark,
 *   and the browser (by id) and profile folder it's in; `source` names both for showing.
 * @typedef {Found & { alsoIn: string[] }} Listed A bookmark once, with the other places it's in.
 */

const MAX_ITEMS = 300;
const home = homedir();

/** Parsed files, kept until they change. @type {Map<string, { mtimeMs: number, size: number, value: unknown }>} */
const files = new Map();

/**
 * A JSON file, parsed again only when it has changed.
 * @param {string} path
 * @returns {Promise<unknown>}
 */
async function readJson(path) {
  let stats;
  try {
    stats = await stat(path);
  } catch {
    return undefined;
  }
  const cached = files.get(path);
  if (cached && cached.mtimeMs === stats.mtimeMs && cached.size === stats.size) return cached.value;
  let value;
  try {
    value = JSON.parse(await readFile(path, 'utf8'));
  } catch {
    // Half-written while the browser saves it; next time.
    return cached?.value;
  }
  files.set(path, { mtimeMs: stats.mtimeMs, size: stats.size, value });
  return value;
}

/**
 * The profiles in a browser's user data folder: the ones `Local State` names, else every
 * `Default` or `Profile N` folder.
 * @param {string} dir
 * @returns {Promise<Array<{ dir: string, name: string }>>}
 */
async function profilesIn(dir) {
  const names = profileNames(await readJson(join(dir, 'Local State')));
  const listed = Object.entries(names).map(([folder, name]) => ({ dir: folder, name }));
  if (listed.length > 0) return listed;
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory() && /^(Default|Profile \d+)$/.test(entry.name))
      .map((entry) => ({ dir: entry.name, name: entry.name }));
  } catch {
    return [];
  }
}

/**
 * Every bookmark in every profile of every browser here.
 * @param {string} platform
 * @returns {Promise<{ bookmarks: Listed[], browsers: string[] }>}
 */
async function loadBookmarks(platform) {
  /** @type {Found[]} */
  const bookmarks = [];
  /** @type {Set<string>} */
  const browsers = new Set();
  for (const browser of BROWSERS) {
    for (const dir of userDataDirs(browser, platform, { home, localAppData: process.env.LOCALAPPDATA })) {
      if (!existsSync(dir)) continue;
      const profiles = await profilesIn(dir);
      for (const profile of profiles) {
        for (const file of BOOKMARK_FILES) {
          const json = await readJson(join(dir, profile.dir, file));
          if (json === undefined) continue;
          browsers.add(browser.id);
          const source = profiles.length > 1 ? `${browser.name} · ${profile.name}` : browser.name;
          for (const bookmark of parseBookmarks(json)) {
            bookmarks.push({ ...bookmark, source, browser: browser.id, profile: profile.dir });
          }
        }
      }
    }
  }
  return { bookmarks: dedupe(bookmarks), browsers: [...browsers] };
}

/** @param {string} name */
function onPath(name) {
  const dirs = [
    ...(process.env.PATH ?? '').split(delimiter),
    '/usr/bin',
    '/usr/local/bin',
    '/snap/bin',
    '/var/lib/flatpak/exports/bin',
    join(home, '.local', 'share', 'flatpak', 'exports', 'bin'),
    join(home, '.local', 'bin'),
  ];
  for (const dir of dirs) {
    if (!dir) continue;
    const file = join(dir, name);
    try {
      accessSync(file, constants.X_OK);
      return file;
    } catch {
      // Not here.
    }
  }
  return undefined;
}

/**
 * The browser's app on macOS, or its program on Windows and Linux.
 * @param {Browser} browser
 * @param {string} platform
 * @returns {{ app?: string, program: string } | undefined}
 */
function findProgram(browser, platform) {
  if (platform === 'darwin' && browser.macApp) {
    for (const folder of ['/Applications', join(home, 'Applications')]) {
      const app = join(folder, `${browser.macApp}.app`);
      const program = join(app, 'Contents', 'MacOS', browser.macApp);
      if (existsSync(program)) return { app, program };
    }
    return undefined;
  }
  if (platform === 'win32') {
    const roots = [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA];
    for (const root of roots) {
      if (!root) continue;
      for (const exe of browser.windowsExe ?? []) {
        const program = join(root, exe);
        if (existsSync(program)) return { app: program, program };
      }
    }
    return undefined;
  }
  for (const command of browser.linuxCommands ?? []) {
    const program = onPath(command);
    if (program) return { program };
  }
  return undefined;
}

/** @type {Map<string, { app?: string, program: string } | undefined>} */
const programs = new Map();

/**
 * @param {string} id
 * @param {string} platform
 */
function programFor(id, platform) {
  if (!programs.has(id)) {
    const browser = BROWSERS.find((each) => each.id === id);
    programs.set(id, browser ? findProgram(browser, platform) : undefined);
  }
  return programs.get(id);
}

/**
 * Opens the page in the browser and profile the bookmark is from. The browser is started
 * again with the profile and the page; one that's already open takes them over, and shows the
 * page as a new tab in that profile's window.
 * @param {{ url: string, browser: string, profile: string }} target
 * @param {string} platform
 * @returns {Promise<void>}
 */
function openInBrowser(target, platform) {
  const browser = BROWSERS.find((each) => each.id === target.browser);
  if (!browser) return Promise.reject(new Error("That browser isn't one Waypoint knows."));
  const args = [`--profile-directory=${target.profile}`, target.url];
  if (platform === 'darwin') {
    // `open -n` starts it through Launch Services, so it comes to the front.
    return new Promise((resolve, reject) => {
      execFile('open', ['-n', '-b', browser.bundleId ?? '', '--args', ...args], { timeout: 8000 }, (error) =>
        error ? reject(new Error(`Couldn't open ${browser.name}.`)) : resolve(),
      );
    });
  }
  const found = programFor(browser.id, platform);
  if (!found) return Promise.reject(new Error(`${browser.name} isn't installed where Waypoint can find it.`));
  return new Promise((resolve, reject) => {
    const child = spawn(found.program, args, { detached: true, stdio: 'ignore' });
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
}

/**
 * @param {Listed} bookmark
 * @param {string} platform
 * @param {boolean} manySources
 * @returns {ListItem}
 */
function bookmarkItem(bookmark, platform, manySources) {
  const browser = BROWSERS.find((each) => each.id === bookmark.browser);
  const app = programFor(bookmark.browser, platform)?.app;
  /** @type {Icon} */
  const icon = app ? { path: app } : { builtin: 'globe', tint: 'blue' };
  const now = Date.now();
  const folderName = bookmark.folder.split(' › ').pop() ?? '';
  return {
    id: bookmark.url,
    title: bookmark.title,
    subtitle: hostOf(bookmark.url),
    accessory: manySources ? bookmark.source : folderName,
    icon,
    detail: {
      title: bookmark.title,
      body: bookmark.url,
      metadata: [
        { label: 'Folder', value: bookmark.folder },
        { label: 'Browser', value: bookmark.source },
        ...(bookmark.alsoIn.length > 0 ? [{ label: 'Also in', value: bookmark.alsoIn.join(', ') }] : []),
        ...(bookmark.used ? [{ label: 'Last opened', value: when(bookmark.used, now) }] : []),
        ...(bookmark.added ? [{ label: 'Added', value: when(bookmark.added, now) }] : []),
      ],
    },
    actions: [
      {
        type: 'callback',
        id: 'open',
        title: `Open in ${browser?.name ?? 'Browser'}`,
        payload: { url: bookmark.url, browser: bookmark.browser, profile: bookmark.profile },
      },
      { type: 'open-url', url: bookmark.url, title: 'Open in Default Browser' },
      { type: 'copy', text: bookmark.url, title: 'Copy URL', shortcut: { key: 'c', modifiers: ['mod', 'shift'] } },
      { type: 'copy', text: `[${bookmark.title}](${bookmark.url})`, title: 'Copy as Markdown Link' },
      { type: 'paste', text: bookmark.url, title: 'Paste URL' },
    ],
  };
}

/**
 * @param {Context} ctx
 * @returns {Promise<ListView>}
 */
async function searchView(ctx) {
  const query = (ctx.query || ctx.argument || '').trim();
  const { bookmarks, browsers } = await loadBookmarks(ctx.platform);
  const matches = matchBookmarks(bookmarks, query);
  const manySources = new Set(bookmarks.map((bookmark) => bookmark.source)).size > 1;
  const emptyText =
    browsers.length === 0
      ? 'No bookmarks found. Search Bookmarks reads Chrome, Brave, Edge, Vivaldi and Chromium.'
      : query
        ? `No bookmark matches “${query}”.`
        : 'Your browsers have no bookmarks yet.';
  return {
    type: 'list',
    title: 'Bookmarks',
    searchPlaceholder: 'Search bookmarks by name, address or folder…',
    filtering: false,
    emptyText,
    sections:
      matches.length > 0
        ? [
            {
              title: query ? 'Results' : 'Recently opened',
              items: matches.slice(0, MAX_ITEMS).map((bookmark) => bookmarkItem(bookmark, ctx.platform, manySources)),
            },
          ]
        : [],
  };
}

/** @type {Extension} */
export default {
  commands: {
    search: {
      view: searchView,
      async onAction(id, payload, ctx) {
        if (id !== 'open' || typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
          return undefined;
        }
        const { url, browser, profile } = /** @type {Record<string, unknown>} */ (payload);
        if (typeof url !== 'string' || typeof browser !== 'string' || typeof profile !== 'string') return undefined;
        try {
          await openInBrowser({ url, browser, profile }, ctx.platform);
        } catch (error) {
          return { toast: error instanceof Error ? error.message : String(error), toastStyle: 'failure' };
        }
        return { hide: true };
      },
    },
  },
};
