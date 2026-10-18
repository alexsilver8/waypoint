// Files: find any file by name with the search your system already keeps: Spotlight on
// macOS, Everything (when its command-line tool is installed) or Windows Search on Windows,
// locate or fd on Linux, or a look through your home folder when there's none of those. With
// nothing typed it lists the files you opened recently. Search Downloads lists your downloads,
// newest first, and Open Latest Download opens the newest one.
import { spawn } from 'node:child_process';
import { accessSync, constants, readFileSync } from 'node:fs';
import { open, readdir, readFile, rm, stat } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { basename, delimiter, join, sep } from 'node:path';
import {
  copyFileCommand,
  fold,
  formatBytes,
  isPartialDownload,
  isTextName,
  kindOf,
  linuxDownloads,
  looksLikeText,
  openCommand,
  parseLastUsedLine,
  parseRecentlyUsed,
  powershellArgs,
  previewOf,
  rankPaths,
  searchPlan,
  timeAgo,
  trashCommand,
  whereIs,
  windowsRecentScript,
  wordsOf,
} from './files.js';

/** @typedef {import('../../src/shared/extension-api').Extension} Extension */
/** @typedef {import('../../src/shared/extension-api').ExtensionContext} Context */
/** @typedef {import('../../src/shared/extension-api').ListItem} ListItem */
/** @typedef {import('../../src/shared/extension-api').ListSection} ListSection */
/** @typedef {import('../../src/shared/extension-api').ListView} ListView */
/** @typedef {import('../../src/shared/extension-api').Action} Action */
/** @typedef {import('../../src/shared/extension-api').ActionResult} ActionResult */
/** @typedef {import('../../src/shared/extension-api').Icon} Icon */
/** @typedef {import('./files.js').Backend} Backend */

/**
 * @typedef {object} Found A file or folder, with what the list shows about it.
 * @property {string} path
 * @property {string} name
 * @property {boolean} isFolder
 * @property {number} size
 * @property {number} modified
 * @property {number} created
 * @property {boolean} inCloud Its contents are in iCloud or OneDrive, not on this computer.
 * @property {number} [at] When it was used or downloaded, if that's what it's listed by.
 * @property {string} [preview] The start of a text file.
 * @property {string[]} [inside] A folder's first few files and folders.
 * @property {number} [count] How many things a folder holds.
 */

const home = homedir();
/** Candidates asked for from a search; the best of them are shown. */
const LIMIT = 500;
const SHOWN = 60;
/** Only the first results get a preview, which means reading them. */
const PREVIEWED = 30;
const DOWNLOADS_SHOWN = 200;
/** What a call may take in all: the launcher gives up on an extension after 10 seconds. */
const BUDGET_MS = 8000;
const WALK_BUDGET_MS = 2500;
const WALK_DEPTH = 6;
const PREVIEW_BYTES = 4096;
/** Images bigger than this get a plain icon, rather than being drawn small. */
const BIG_IMAGE = 5_000_000;
const IMAGE = /\.(png|jpe?g|gif|webp|svg|ico)$/i;
/** Folders not worth looking through for your files. */
const SKIP_FOLDERS = new Set(['node_modules', 'Library', 'AppData', 'Application Data', '$RECYCLE.BIN', '__pycache__']);

/**
 * Each search counts up; a newer one stops the processes of older ones, and older ones then
 * stop trying further ways to search.
 */
let latestSearch = 0;
/** @type {Map<import('node:child_process').ChildProcess, number>} */
const searching = new Map();
/** The latest search's list, to take a file out of after it's moved to the Trash. */
/** @type {Map<string, ListView>} */
const shown = new Map();

/** @param {unknown} error */
function message(error) {
  return error instanceof Error ? error.message : String(error);
}

/** @param {string} platform */
function fileManager(platform) {
  return platform === 'darwin' ? 'Finder' : platform === 'win32' ? 'File Explorer' : 'Files';
}

/** @param {string} platform */
function trashName(platform) {
  return platform === 'win32' ? 'Recycle Bin' : 'Trash';
}

/** @param {number} deadline */
const left = (deadline) => Math.max(0, deadline - Date.now());

/**
 * Where a program is, looking where things install as well as PATH: an app started from the
 * Dock or Start menu gets a short PATH.
 * @param {string} name
 */
function findProgram(name) {
  const dirs = [
    ...(process.env.PATH ?? '').split(delimiter),
    '/usr/bin',
    '/usr/local/bin',
    '/bin',
    '/snap/bin',
    '/opt/homebrew/bin',
    join(home, '.local', 'bin'),
    join(home, '.cargo', 'bin'),
    ...[process.env.ProgramFiles, process.env['ProgramFiles(x86)']].flatMap((root) =>
      root ? [join(root, 'Everything')] : [],
    ),
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

/** @type {Record<string, string | undefined> | undefined} */
let foundPrograms;

/** The helper programs installed here, looked for once. */
function programs() {
  if (!foundPrograms) {
    const names =
      process.platform === 'win32'
        ? ['es.exe']
        : ['plocate', 'locate', 'fd', 'fdfind', 'gio', 'kioclient5', 'trash-put', 'xclip', 'wl-copy'];
    foundPrograms = Object.fromEntries(names.map((name) => [name, findProgram(name)]));
  }
  return foundPrograms;
}

/** Stops the processes of searches older than this one. @param {number} search */
function stopOlderSearches(search) {
  for (const [child, owner] of searching) if (owner < search) child.kill();
}

/**
 * Runs a search program and collects the paths it prints, one a line, stopping it once it has
 * printed enough, run out of time, or a newer search has started.
 * @param {string} file
 * @param {string[]} args
 * @param {{ limit: number, timeoutMs: number, search: number, env?: Record<string, string> }} options
 * @returns {Promise<{ lines: string[], ok: boolean, stopped: boolean }>}
 */
function collectLines(file, args, { limit, timeoutMs, search, env }) {
  return new Promise((resolve) => {
    if (timeoutMs <= 0 || search !== latestSearch) {
      resolve({ lines: [], ok: false, stopped: search !== latestSearch });
      return;
    }
    const child = spawn(file, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      ...(env ? { env: { ...process.env, ...env } } : {}),
    });
    searching.set(child, search);
    /** @type {string[]} */
    const lines = [];
    let rest = '';
    let stderr = '';
    let settled = false;
    const finish = (/** @type {boolean} */ ok) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      searching.delete(child);
      if (rest.trim() && lines.length < limit) lines.push(rest.trim());
      resolve({ lines, ok, stopped: search !== latestSearch });
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(true);
    }, timeoutMs);
    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (/** @type {string} */ chunk) => {
      const parts = (rest + chunk).split(/\r?\n/);
      rest = parts.pop() ?? '';
      for (const line of parts) if (line.trim()) lines.push(line.trim());
      if (lines.length >= limit) {
        lines.length = limit;
        child.kill();
        finish(true);
      }
    });
    child.stderr?.on('data', (data) => {
      stderr += String(data);
    });
    child.once('error', () => finish(false));
    // locate and fd say they found nothing by exiting with 1.
    child.once('close', (code, signal) => finish(code === 0 || signal !== null || (code === 1 && !stderr.trim())));
  });
}

/**
 * Runs one way of searching: printing its results, or writing them to a file.
 * @param {Backend} backend
 * @param {string[]} args
 * @param {{ search: number, deadline: number }} options
 */
async function runBackend(backend, args, { search, deadline }) {
  const timeoutMs = Math.min(5000, left(deadline) - 1500);
  if (!backend.exportArg) {
    return collectLines(backend.file, args, { limit: backend.limit ?? LIMIT, timeoutMs, search, env: backend.env });
  }
  const file = join(tmpdir(), `waypoint-files-${process.pid}-${search}.txt`);
  try {
    const result = await collectLines(backend.file, [...args, backend.exportArg, file], {
      limit: LIMIT,
      timeoutMs,
      search,
      env: backend.env,
    });
    if (!result.ok) return result;
    const text = await readFile(file, 'utf8').catch(() => '');
    const lines = text
      .replace(/^﻿/, '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, LIMIT);
    return { ...result, lines };
  } finally {
    await rm(file, { force: true }).catch(() => {});
  }
}

/**
 * Looks through folders for names holding every word, shallow ones first, for as long as the
 * budget lasts. Used when there's no search index to ask.
 * @param {string[]} words
 * @param {string[]} roots
 * @param {{ deadline: number, search: number }} options
 * @returns {Promise<string[]>}
 */
async function walk(words, roots, { deadline, search }) {
  const folded = words.map(fold);
  /** @type {string[]} */
  const found = [];
  /** @type {Array<{ dir: string, depth: number }>} */
  const queue = roots.map((dir) => ({ dir, depth: 0 }));
  while (queue.length > 0 && Date.now() < deadline && found.length < LIMIT && search === latestSearch) {
    const { dir, depth } = /** @type {{ dir: string, depth: number }} */ (queue.shift());
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const path = join(dir, entry.name);
      const name = fold(entry.name);
      if (folded.every((word) => name.includes(word))) found.push(path);
      if (entry.isDirectory() && depth < WALK_DEPTH && !SKIP_FOLDERS.has(entry.name)) {
        queue.push({ dir: path, depth: depth + 1 });
      }
    }
  }
  return found;
}

/** Where results came from, for the list's heading. @type {Record<string, string>} */
const FOUND_BY = {
  spotlight: 'Found by Spotlight',
  everything: 'Found by Everything',
  'windows-search': 'Found by Windows Search',
  locate: 'Found by locate',
  fd: 'Found by fd',
  walk: 'Found in your home folder',
};

/**
 * Paths whose names hold every word typed, from the best way to search here.
 * @param {string} query
 * @param {string} platform
 * @param {{ search: number, deadline: number }} options
 * @returns {Promise<{ paths: string[], via: string }>}
 */
async function searchPaths(query, platform, { search, deadline }) {
  const words = wordsOf(query);
  for (const backend of searchPlan(platform, words, { home, programs: programs(), limit: LIMIT })) {
    const result = await runBackend(backend, backend.args, { search, deadline });
    if (result.stopped) return { paths: [], via: 'stopped' };
    if (!result.ok || (result.lines.length === 0 && !backend.trustEmpty)) continue;
    let paths = result.lines;
    // Little in your own folders: look everywhere too.
    if (backend.widerArgs && paths.length < 40) {
      const wider = await runBackend(backend, backend.widerArgs, { search, deadline });
      if (wider.stopped) return { paths: [], via: 'stopped' };
      if (wider.ok) paths = [...paths, ...wider.lines];
    }
    return { paths, via: backend.id };
  }
  const budget = Math.min(WALK_BUDGET_MS, left(deadline) - 1500);
  return { paths: await walk(words, [home], { deadline: Date.now() + budget, search }), via: 'walk' };
}

/**
 * The files you opened lately: Spotlight's last-used dates on macOS, GTK's recent files on
 * Linux, the Recent folder on Windows.
 * @param {string} platform
 * @param {{ search: number, deadline: number }} options
 * @returns {Promise<Array<{ path: string, at?: number }>>}
 */
async function recentPaths(platform, { search, deadline }) {
  const timeoutMs = Math.min(5000, left(deadline) - 1500);
  if (platform === 'darwin') {
    const { lines } = await collectLines(
      '/usr/bin/mdfind',
      ['-onlyin', home, '-attr', 'kMDItemLastUsedDate', 'kMDItemLastUsedDate >= $time.today(-14)'],
      { limit: 400, timeoutMs, search },
    );
    return lines
      .map(parseLastUsedLine)
      .filter(({ path }) => !/\/(Library|\.[^/]+)\//.test(path.slice(home.length)))
      .sort((a, b) => (b.at ?? 0) - (a.at ?? 0));
  }
  if (platform === 'linux') {
    try {
      return parseRecentlyUsed(readFileSync(join(home, '.local', 'share', 'recently-used.xbel'), 'utf8'));
    } catch {
      return [];
    }
  }
  if (platform === 'win32') {
    const { lines } = await collectLines('powershell.exe', powershellArgs(windowsRecentScript(60)), {
      limit: 60,
      timeoutMs,
      search,
    });
    return lines.map((path) => ({ path }));
  }
  return [];
}

/**
 * The start of a file, when it's text.
 * @param {string} path
 * @param {string} name
 */
async function previewFile(path, name) {
  let file;
  try {
    file = await open(path, 'r');
    const buffer = Buffer.alloc(PREVIEW_BYTES);
    const { bytesRead } = await file.read(buffer, 0, PREVIEW_BYTES, 0);
    const bytes = buffer.subarray(0, bytesRead);
    return looksLikeText(bytes) ? previewOf(bytes.toString('utf8'), name) : undefined;
  } catch {
    return undefined;
  } finally {
    await file?.close();
  }
}

/**
 * What a folder holds: the first folders and files, by name.
 * @param {string} path
 */
async function folderContents(path) {
  try {
    const entries = (await readdir(path, { withFileTypes: true })).filter((entry) => !entry.name.startsWith('.'));
    const names = entries
      .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))
      .map((entry) => (entry.isDirectory() ? `${entry.name}/` : entry.name));
    return { inside: names.slice(0, 25), count: names.length };
  } catch {
    return { inside: [], count: 0 };
  }
}

/** OneDrive's folders, whose files may be placeholders that reading would download. */
const ONEDRIVE = [process.env.OneDrive, process.env.OneDriveConsumer, process.env.OneDriveCommercial].flatMap((dir) =>
  dir ? [dir] : [],
);

/**
 * Whether a file's contents may be only in the cloud: iCloud leaves a file with no blocks on
 * disk when it's offloaded, and OneDrive's folders hold placeholders. (Only on macOS do no
 * blocks mean that: Linux's btrfs and Windows keep small files inside their metadata.)
 * @param {string} path
 * @param {import('node:fs').Stats} stats
 */
function isInCloud(path, stats) {
  if (process.platform === 'darwin' && stats.isFile() && stats.size > 0 && stats.blocks === 0) return true;
  return ONEDRIVE.some((dir) => path === dir || path.startsWith(dir + sep));
}

/**
 * Everything the list shows about a path; nothing when it isn't there any more.
 * @param {string} path
 * @param {{ at?: number, preview: boolean }} options
 * @returns {Promise<Found | undefined>}
 */
async function describe(path, { at, preview }) {
  let stats;
  try {
    stats = await stat(path);
  } catch {
    return undefined;
  }
  const name = basename(path);
  const isFolder = stats.isDirectory() && !/\.app$/i.test(name);
  /** @type {Found} */
  const found = {
    path,
    name,
    isFolder,
    size: stats.size,
    modified: stats.mtimeMs,
    created: stats.birthtimeMs,
    inCloud: isInCloud(path, stats),
    ...(at ? { at } : {}),
  };
  if (!preview || found.inCloud) return found;
  if (isFolder) return { ...found, ...(await folderContents(path)) };
  if (stats.isFile() && stats.size > 0 && (isTextName(name) || !name.includes('.'))) {
    const text = await previewFile(path, name);
    if (text) found.preview = text;
  }
  return found;
}

/**
 * The file's own icon, or a plain one for a big image or a file that's only in the cloud,
 * which drawing would mean reading.
 * @param {Found} found
 * @returns {Icon}
 */
function iconOf(found) {
  if (found.inCloud || (IMAGE.test(found.name) && found.size > BIG_IMAGE)) {
    return { builtin: found.isFolder ? 'folder' : 'file', tint: found.isFolder ? 'blue' : 'purple' };
  }
  return { path: found.path };
}

/**
 * @param {Found} found
 * @param {string} platform
 * @param {{ timeLabel: string }} options What `at` is, when the list is in that order.
 * @returns {ListItem}
 */
function fileItem(found, platform, { timeLabel }) {
  const now = Date.now();
  const manager = fileManager(platform);
  /** @type {Action[]} */
  const actions = [
    { type: 'open-path', path: found.path, title: found.isFolder ? `Open in ${manager}` : 'Open' },
    { type: 'reveal-path', path: found.path, title: `Show in ${manager}` },
  ];
  if (platform === 'darwin' && !found.isFolder) {
    actions.push({
      type: 'callback',
      id: 'quick-look',
      title: 'Quick Look',
      payload: found.path,
      shortcut: { key: 'y', modifiers: ['mod'] },
    });
  }
  actions.push(
    { type: 'callback', id: 'copy-file', title: found.isFolder ? 'Copy Folder' : 'Copy File', payload: found.path },
    { type: 'copy', text: found.path, title: 'Copy Path', shortcut: { key: 'c', modifiers: ['mod', 'shift'] } },
    { type: 'copy', text: found.name, title: 'Copy Name' },
    {
      type: 'callback',
      id: 'trash',
      title: `Move to ${trashName(platform)}`,
      payload: found.path,
      style: 'destructive',
      // ⌘⌫ alone clears the search field as you type, so it needs ⇧ too.
      shortcut: { key: 'Backspace', modifiers: ['mod', 'shift'] },
    },
  );
  const folderBody = found.count
    ? (found.inside ?? []).map((name) => `- ${name}`).join('\n') +
      (found.count > 25 ? `\n- …and ${found.count - 25} more` : '')
    : found.inside
      ? 'This folder is empty.'
      : '';
  const body = found.inCloud
    ? `In ${ONEDRIVE.some((dir) => found.path.startsWith(dir)) ? 'OneDrive' : 'iCloud'}; it's downloaded when you open it.`
    : found.isFolder
      ? folderBody
      : (found.preview ?? '');
  return {
    id: found.path,
    title: found.name,
    subtitle: whereIs(found.path, home),
    accessory: timeAgo(found.at ?? found.modified, now),
    icon: iconOf(found),
    detail: {
      title: found.name,
      body,
      metadata: [
        { label: 'Kind', value: kindOf(found.name, found.isFolder) },
        ...(!found.isFolder
          ? [{ label: 'Size', value: formatBytes(found.size) }]
          : found.count !== undefined
            ? [{ label: 'Holds', value: `${found.count} ${found.count === 1 ? 'item' : 'items'}` }]
            : []),
        ...(found.at ? [{ label: timeLabel, value: timeAgo(found.at, now) }] : []),
        { label: 'Modified', value: timeAgo(found.modified, now) },
        ...(found.created > 0 && Math.abs(found.created - found.modified) > 60_000
          ? [{ label: 'Created', value: timeAgo(found.created, now) }]
          : []),
        { label: 'Where', value: whereIs(found.path, home) },
      ],
    },
    actions,
  };
}

/**
 * Describes paths in order, previewing only the first few, which means reading them.
 * @param {Array<{ path: string, at?: number }>} entries
 * @returns {Promise<Found[]>}
 */
async function describeAll(entries) {
  const found = await Promise.all(
    entries.map(({ path, at }, index) => describe(path, { at, preview: index < PREVIEWED })),
  );
  return found.filter((each) => each !== undefined);
}

/** What to say when looking through the home folder found nothing. @param {string} platform */
function slowSearchHint(platform) {
  if (platform === 'win32') return 'Install Everything and its es tool for search that finds everything, fast.';
  return 'Searching is faster with locate or fd installed.';
}

/**
 * @param {Context} ctx
 * @returns {Promise<ListView>}
 */
async function searchView(ctx) {
  const search = ++latestSearch;
  stopOlderSearches(search);
  const deadline = Date.now() + BUDGET_MS;
  const query = (ctx.query || ctx.argument || '').trim();
  const base = {
    type: /** @type {const} */ ('list'),
    title: 'Files',
    searchPlaceholder: 'Search files and folders by name…',
    filtering: false,
  };
  /** @type {ListView} */
  let view;
  if (!query) {
    const recent = await recentPaths(ctx.platform, { search, deadline });
    const found = await describeAll(recent.slice(0, SHOWN));
    view = {
      ...base,
      emptyText: 'Type to search your files.',
      sections:
        found.length > 0
          ? [
              {
                title: 'Opened recently',
                items: found.map((each) => fileItem(each, ctx.platform, { timeLabel: 'Opened' })),
              },
            ]
          : [],
    };
  } else {
    const { paths, via } = await searchPaths(query, ctx.platform, { search, deadline });
    const ranked = rankPaths(paths, wordsOf(query), home).slice(0, SHOWN * 2);
    const found = (await describeAll(ranked.map((path) => ({ path })))).slice(0, SHOWN);
    view = {
      ...base,
      emptyText:
        via === 'walk'
          ? `Nothing in your home folder is called “${query}”. ${slowSearchHint(ctx.platform)}`
          : `No file or folder is called “${query}”.`,
      sections:
        found.length > 0
          ? [
              {
                title: FOUND_BY[via] ?? 'Results',
                items: found.map((each) => fileItem(each, ctx.platform, { timeLabel: 'Opened' })),
              },
            ]
          : [],
    };
  }
  if (search === latestSearch) shown.set('search', view);
  return view;
}

/** @param {string} platform */
function downloadsFolder(platform) {
  if (platform !== 'linux') return join(home, 'Downloads');
  let userDirs;
  try {
    userDirs = readFileSync(join(home, '.config', 'user-dirs.dirs'), 'utf8');
  } catch {
    // The usual place, then.
  }
  return linuxDownloads(userDirs, home);
}

/**
 * When a file arrived in Downloads: when it was made there, as browsers create the file when a
 * download starts. Opening a file changes its ctime (macOS notes it was opened), so ctime only
 * stands in where there's no creation time.
 * @param {import('node:fs').Stats} stats
 */
function arrived(stats) {
  return stats.birthtimeMs > 0 ? stats.birthtimeMs : Math.max(stats.mtimeMs, stats.ctimeMs);
}

/**
 * Your downloads, newest first, and the ones still downloading.
 * @param {string} platform
 * @returns {Promise<{ folder: string, done: Array<{ path: string, at: number }>, partial: Array<{ path: string, at: number, size: number }> } | undefined>}
 */
async function listDownloads(platform) {
  const folder = downloadsFolder(platform);
  let entries;
  try {
    entries = await readdir(folder);
  } catch {
    return undefined;
  }
  const listed = await Promise.all(
    entries
      .filter((name) => !(name.startsWith('.') && !isPartialDownload(name)) && name.toLowerCase() !== 'desktop.ini')
      .slice(0, 5000)
      .map(async (name) => {
        const path = join(folder, name);
        try {
          const stats = await stat(path);
          return { path, name, at: arrived(stats), size: stats.size };
        } catch {
          return undefined;
        }
      }),
  );
  const present = listed.filter((each) => each !== undefined).sort((a, b) => b.at - a.at);
  return {
    folder,
    done: present.filter((each) => !isPartialDownload(each.name)),
    partial: present.filter((each) => isPartialDownload(each.name)),
  };
}

/**
 * @param {Context} ctx
 * @returns {Promise<ListView>}
 */
async function downloadsView(ctx) {
  const query = ctx.query.trim();
  const base = {
    type: /** @type {const} */ ('list'),
    title: 'Downloads',
    searchPlaceholder: 'Search your downloads…',
    filtering: false,
  };
  const downloads = await listDownloads(ctx.platform);
  if (!downloads) {
    return {
      ...base,
      emptyText: `There's no Downloads folder at ${whereIs(join(downloadsFolder(ctx.platform), 'x'), home)}.`,
      sections: [],
    };
  }
  const words = wordsOf(query).map(fold);
  /** @param {{ path: string }} each */
  const matches = (each) => words.every((word) => fold(basename(each.path)).includes(word));
  const found = await describeAll(downloads.done.filter(matches).slice(0, DOWNLOADS_SHOWN));

  /** @type {ListSection[]} */
  const sections = [];
  const partial = downloads.partial.filter(matches);
  if (partial.length > 0) {
    sections.push({
      title: 'Still downloading',
      items: partial.map((each) => ({
        id: each.path,
        title: basename(each.path).replace(/\.(crdownload|part|partial|download|opdownload)$/i, ''),
        subtitle: `${formatBytes(each.size)} so far`,
        accessory: timeAgo(each.at, Date.now()),
        icon: { builtin: 'refresh', tint: 'blue' },
        actions: [{ type: 'reveal-path', path: each.path, title: `Show in ${fileManager(ctx.platform)}` }],
      })),
    });
  }
  if (found.length > 0) {
    sections.push({
      title: query ? 'Results' : 'Downloaded',
      items: found.map((each) => fileItem(each, ctx.platform, { timeLabel: 'Downloaded' })),
    });
  }
  if (!query) {
    sections.push({
      title: 'Folder',
      items: [
        {
          id: 'folder',
          title: 'Open Downloads Folder',
          subtitle: whereIs(join(downloads.folder, 'x'), home),
          icon: { builtin: 'folder', tint: 'blue' },
          actions: [{ type: 'open-path', path: downloads.folder, title: `Open in ${fileManager(ctx.platform)}` }],
        },
      ],
    });
  }
  return {
    ...base,
    emptyText: query ? `Nothing in Downloads matches “${query}”.` : 'Your Downloads folder is empty.',
    sections,
  };
}

/**
 * Runs a command until it exits, with what to type into it. It's done when the program exits,
 * not when its output closes: xclip and wl-copy stay behind in the background to hand out
 * the clipboard, holding their output open.
 * @param {{ file: string, args: string[], input?: string, env?: Record<string, string> }} command
 * @param {number} [timeoutMs]
 * @returns {Promise<void>}
 */
function runCommand(command, timeoutMs = BUDGET_MS) {
  return new Promise((resolve, reject) => {
    const child = spawn(command.file, command.args, {
      stdio: [command.input === undefined ? 'ignore' : 'pipe', 'ignore', 'pipe'],
      windowsHide: true,
      env: command.env ? { ...process.env, ...command.env } : process.env,
    });
    let stderr = '';
    child.stderr?.on('data', (data) => {
      stderr += String(data);
    });
    const timer = setTimeout(() => {
      child.kill();
      reject(Object.assign(new Error(`${basename(command.file)} took too long.`), { code: 'ETIMEDOUT' }));
    }, timeoutMs);
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      child.stderr?.destroy();
      if (code === 0) return resolve();
      const said = stderr.trim().split('\n').pop()?.trim();
      reject(new Error(said || `${basename(command.file)} exited with code ${code}.`));
    });
    if (command.input !== undefined) child.stdin?.end(command.input);
  });
}

/**
 * Opens a file with its app, without waiting for the app.
 * @param {string} platform
 * @param {string} path
 * @returns {Promise<void>}
 */
function openFile(platform, path) {
  const { file, args, env } = openCommand(platform, path);
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, {
      // Not on Windows, where it's PowerShell: a detached one has no console, and exits at once.
      detached: platform !== 'win32',
      stdio: 'ignore',
      windowsHide: true,
      ...(env ? { env: { ...process.env, ...env } } : {}),
    });
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
}

/**
 * Why moving to the Trash failed, and what to do about it. The first time on macOS, Finder
 * asks whether Waypoint may control it, and waits for an answer.
 * @param {unknown} error
 * @param {string} platform
 */
function explainTrash(error, platform) {
  const reason = message(error);
  if (/-1743|not authori[sz]ed to send apple events/i.test(reason)) {
    return 'Allow Waypoint to control Finder in System Settings → Privacy & Security → Automation.';
  }
  if (platform === 'darwin' && /** @type {NodeJS.ErrnoException} */ (error)?.code === 'ETIMEDOUT') {
    return 'If macOS asked whether Waypoint may control Finder, allow it, then try again.';
  }
  return reason;
}

/**
 * The list without one item, after it was moved to the Trash.
 * @param {ListView} view
 * @param {string} id
 * @returns {ListView}
 */
function without(view, id) {
  return {
    ...view,
    sections: view.sections
      .map((section) => ({ ...section, items: section.items.filter((item) => item.id !== id) }))
      .filter((section) => section.items.length > 0),
  };
}

/**
 * The actions every file in a list has.
 * @param {'search' | 'downloads'} command
 */
function fileActions(command) {
  /**
   * @param {string} id
   * @param {unknown} payload
   * @param {Context} ctx
   * @returns {Promise<ActionResult | undefined>}
   */
  return async (id, payload, ctx) => {
    if (typeof payload !== 'string') return undefined;
    const name = basename(payload);
    if (id === 'copy-file') {
      const wayland = Boolean(process.env.WAYLAND_DISPLAY);
      const copy = copyFileCommand(ctx.platform, payload, { wayland, programs: programs() });
      if (!copy) {
        return { toast: 'Install wl-clipboard (Wayland) or xclip (X11) to copy files.', toastStyle: 'failure' };
      }
      try {
        await runCommand(copy);
      } catch (error) {
        return { toast: `Couldn't copy “${name}”: ${message(error)}`, toastStyle: 'failure' };
      }
      return { hide: true };
    }
    if (id === 'trash') {
      const trash = trashCommand(ctx.platform, payload, programs());
      if (!trash) {
        return { toast: 'Install gio (GLib) or trash-cli to move files to the Trash.', toastStyle: 'failure' };
      }
      try {
        await runCommand(trash);
      } catch (error) {
        return {
          toast: `Couldn't move “${name}” to the ${trashName(ctx.platform)}: ${explainTrash(error, ctx.platform)}`,
          toastStyle: 'failure',
        };
      }
      const toast = `Moved “${name}” to the ${trashName(ctx.platform)}`;
      // Downloads is quick to list again, and that way matches what's typed now. A search is
      // slow to run again, so the one shown, which is the latest, loses the file instead.
      if (command === 'downloads') return { replace: await downloadsView(ctx), toast };
      const last = shown.get(command);
      if (last) {
        const updated = without(last, payload);
        shown.set(command, updated);
        return { replace: updated, toast };
      }
      return { toast };
    }
    if (id === 'quick-look') {
      // qlmanage shows the Quick Look panel; it's the same one Finder's space bar opens.
      const child = spawn('qlmanage', ['-p', payload], { detached: true, stdio: 'ignore' });
      child.once('error', () => {});
      child.unref();
      return { hide: true };
    }
    return undefined;
  };
}

/** @type {Extension} */
export default {
  commands: {
    search: { view: searchView, onAction: fileActions('search') },
    downloads: { view: downloadsView, onAction: fileActions('downloads') },
    'open-latest-download': {
      async run(ctx) {
        const downloads = await listDownloads(ctx.platform);
        const latest = downloads?.done[0];
        if (!latest) return { toast: 'Your Downloads folder is empty.', toastStyle: 'failure' };
        try {
          await openFile(ctx.platform, latest.path);
        } catch (error) {
          return { toast: `Couldn't open “${basename(latest.path)}”: ${message(error)}`, toastStyle: 'failure' };
        }
        return { hide: true };
      },
    },
  },
};
