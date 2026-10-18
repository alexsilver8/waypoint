// Disk Usage: what's taking up space. Disk Usage lists what's in a folder biggest first,
// starting with your home folder, and opens any folder in it to look inside. Largest Files lists
// the biggest files anywhere in it, and Archives and Installers the zips, disk images and
// installers you may not need any more. The scan carries on in the background, so the lists fill
// in as it goes and open at once afterwards. Type a folder (~/Projects, /Volumes/Backup) to look
// there instead.
import { spawn } from 'node:child_process';
import { accessSync, constants, statSync } from 'node:fs';
import { stat, statfs } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, delimiter, dirname, join, parse } from 'node:path';
import { bySize, LISTED_MIN, Scan } from './scan.js';
import {
  categoryOf,
  displayPath,
  explainTrash,
  formatBytes,
  formatCount,
  formatElapsed,
  formatShare,
  isLeftover,
  kindOf,
  matches,
  parseQuery,
  plural,
  queryFor,
  timeAgo,
  trashCommand,
  unpackedName,
  whereIs,
  wordsOf,
} from './usage.js';

/** @typedef {import('@waypoint-org/api').Extension} Extension */
/** @typedef {import('@waypoint-org/api').ExtensionContext} Context */
/** @typedef {import('@waypoint-org/api').ListItem} ListItem */
/** @typedef {import('@waypoint-org/api').ListSection} ListSection */
/** @typedef {import('@waypoint-org/api').ListView} ListView */
/** @typedef {import('@waypoint-org/api').Action} Action */
/** @typedef {import('@waypoint-org/api').ActionResult} ActionResult */
/** @typedef {import('@waypoint-org/api').Icon} Icon */
/** @typedef {import('./scan.js').Folder} Folder */
/** @typedef {import('./scan.js').File} File */

/**
 * @typedef {object} Shown The list rows are drawn for.
 * @property {Context} ctx
 * @property {string} at The folder the list is of.
 * @property {string} label What that folder is called in the list.
 * @property {number} whole The space it takes, which rows are a share of.
 * @property {boolean} located Rows come from anywhere in it, so they say where they are.
 */

const home = homedir();
const EXTENSION = 'disk-usage';
/** Rows a list shows at most; the rest are added up in one row. */
const SHOWN = 100;
/** How long opening a list waits for its folder's own contents, so it opens with them. */
const FIRST_LOOK_MS = 800;
/** Scans kept to go back to. */
const KEPT = 4;
/** What a folder's preview lists of what's in it. */
const INSIDE = 8;
/** Images bigger than this get a plain icon, rather than being read to be drawn small. */
const BIG_IMAGE = 5_000_000;
const IMAGE = /\.(png|jpe?g|gif|webp|svg|ico|heic|tiff?)$/i;
/** The size things must be to be listed one by one, as it's written: "1 MB". */
const LISTED = formatBytes(LISTED_MIN).replace('.0 ', ' ');
/** Where macOS lets an app into the folders it keeps private, like Mail and Messages. */
const FULL_DISK_ACCESS = 'x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles';

/** Scans by the folder they started in, the one used last at the end. @type {Map<string, Scan>} */
const scans = new Map();

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

/**
 * A folder as a list names it: "Home", "~/Library", "/Volumes/Backup".
 * @param {string} path
 * @param {string} platform
 */
function labelOf(path, platform) {
  const shown = displayPath(path, home, platform);
  return shown === '~' ? 'Home' : shown;
}

/**
 * @template T
 * @param {Promise<T>} promise
 * @param {number} ms
 */
function within(promise, ms) {
  return Promise.race([promise, new Promise((resolve) => setTimeout(resolve, ms))]);
}

/**
 * What a scan leaves alone. Cloud storage on macOS (Google Drive, OneDrive, Dropbox) fetches a
 * folder's contents from the internet when it's listed, so it's only counted when it's asked
 * for. Scanning the whole disk on macOS, /System/Volumes holds your files a second time and
 * /Volumes the other disks, while your files' own volume is joined into the tree.
 * @param {string} root
 * @param {string} platform
 */
function scanOptions(root, platform) {
  /** @type {Map<string, 'cloud' | 'disk'>} */
  const skips = new Map();
  /** @type {number[]} */
  const devices = [];
  if (platform === 'darwin') {
    skips.set(join(home, 'Library', 'CloudStorage'), 'cloud');
    if (root === '/') {
      skips.set('/System/Volumes', 'disk');
      skips.set('/Volumes', 'disk');
      try {
        devices.push(statSync('/System/Volumes/Data').dev);
      } catch {
        // An older macOS, with one volume.
      }
    }
  }
  return { skip: (/** @type {string} */ path) => skips.get(path), devices };
}

/**
 * Starts scanning a folder afresh. Of the scans kept, the ones used longest ago are forgotten.
 * @param {string} path
 * @param {string} platform
 */
function startScan(path, platform) {
  scans.get(path)?.stop();
  scans.delete(path);
  const scan = new Scan(path, scanOptions(path, platform)).start();
  scans.set(path, scan);
  for (const [key, old] of scans) {
    if (scans.size <= KEPT) break;
    if (old !== scan && !old.running) scans.delete(key);
  }
  return scan;
}

/**
 * The scan to show a path from. One that has the folder comes first, one that's done counting it
 * before one that isn't; then one that's still running and may come to it; then any that covers
 * it. Among equals, the newest.
 * @param {string} path
 * @returns {Scan | undefined}
 */
function scanFor(path) {
  /** @type {Scan | undefined} */
  let best;
  let bestRank = -1;
  for (const scan of scans.values()) {
    if (scan.error || !scan.covers(path)) continue;
    const folder = scan.find(path);
    const rank = folder && !folder.skipped ? (folder.waiting === 0 ? 3 : 2) : scan.mayReach(path) ? 1 : 0;
    if (rank > bestRank || (rank === bestRank && best && scan.started > best.started)) {
      best = scan;
      bestRank = rank;
    }
  }
  if (best) {
    // Used last, so forgotten last.
    scans.delete(best.path);
    scans.set(best.path, best);
  }
  return best;
}

/** @param {string} path */
async function isFolder(path) {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Where a search looks, and what it filters by. A folder typed into it says where; when what's
 * after its last slash isn't a folder, that filters the folder before it.
 * @param {string} query
 * @param {string} platform
 * @returns {Promise<{ folder: string, words: string[], filter: string, named: boolean } | { missing: string }>}
 *   `filter` is the text the words come from, as typed; `named`, whether the folder was.
 */
async function lookIn(query, platform) {
  const parsed = parseQuery(query, { home, platform });
  if (parsed.path === undefined) return { folder: home, words: parsed.words, filter: query.trim(), named: false };
  if (await isFolder(parsed.path)) return { folder: parsed.path, words: [], filter: '', named: true };
  const parent = dirname(parsed.path);
  if (!parsed.trailing && parent !== parsed.path && (await isFolder(parent))) {
    const filter = basename(parsed.path);
    return { folder: parent, words: wordsOf(filter), filter, named: true };
  }
  return { missing: parsed.path };
}

/**
 * The scan to show a folder from, and the folder in it: nothing yet while a running scan may
 * still come to it. Otherwise a scan of the folder itself starts: it was too small to list, or
 * it's cloud storage or another disk, which are only counted when they're opened. A folder that
 * no scan has been in only starts one when `start` says so, as a whole disk takes a while, and
 * a folder typed on the way to another shouldn't set one off.
 * @param {string} path
 * @param {string} platform
 * @param {{ start: boolean }} options
 * @returns {Promise<{ scan: Scan, folder: Folder | undefined } | { ask: true }>}
 */
async function folderAt(path, platform, { start }) {
  const known = scanFor(path);
  const folder = known?.find(path);
  const elsewhere = folder?.skipped === 'cloud' || folder?.skipped === 'disk';
  if (known && ((folder && !elsewhere) || (!folder && known.mayReach(path)))) {
    known.focus(path);
    return { scan: known, folder };
  }
  if (!known && !start) return { ask: true };
  const scan = startScan(path, platform);
  await within(scan.ready, FIRST_LOOK_MS);
  return { scan, folder: scan.root };
}

/** @param {string} path @returns {Promise<number | undefined>} */
async function freeSpace(path) {
  try {
    const info = await statfs(path);
    return info.bavail * info.bsize;
  } catch {
    return undefined;
  }
}

// ── Actions ──────────────────────────────────────────────────────────────────

/** @param {string} path @returns {Action} */
const copyPath = (path) => ({
  type: 'copy',
  text: path,
  title: 'Copy Path',
  shortcut: { key: 'c', modifiers: ['mod', 'shift'] },
});

/** @param {string} path The folder the list is of. @returns {Action} */
const scanAgain = (path) => ({
  type: 'callback',
  id: 'rescan',
  title: 'Scan Again',
  payload: path,
  shortcut: { key: 'r', modifiers: ['mod'] },
});

/** @param {string} path @param {string} platform @returns {Action} */
const moveToTrash = (path, platform) => ({
  type: 'callback',
  id: 'trash',
  title: `Move to ${trashName(platform)}`,
  payload: path,
  style: 'destructive',
  // ⌘⌫ alone clears the search field as you type, so it needs ⇧ too.
  shortcut: { key: 'Backspace', modifiers: ['mod', 'shift'] },
});

/** @param {string} path @param {string} platform @returns {Action} */
const showContents = (path, platform) => ({
  type: 'open-command',
  ref: { extension: EXTENSION, command: 'usage' },
  argument: queryFor(path, home, platform),
  title: 'Show Contents',
});

// ── Rows ─────────────────────────────────────────────────────────────────────

/**
 * The biggest things in a folder, for its preview.
 * @param {Folder} folder
 * @param {Scan} scan
 */
function insideOf(folder, scan) {
  if (folder.skipped === 'cloud') {
    return "Cloud storage keeps files online until they're opened, and listing its folders can download them, so it isn't counted with the rest. Open it to count it.";
  }
  if (folder.skipped === 'disk') return "It's on another disk, so it isn't counted with this one. Open it to count it.";
  const listed = [
    ...[...folder.children.values()].map((child) => ({
      name: `${child.name}/`,
      bytes: child.bytes,
      // Cloud storage and other disks aren't 0 B, just not looked through yet.
      counted: child.skipped !== 'cloud' && child.skipped !== 'disk',
    })),
    ...folder.big.map((file) => ({ name: file.name, bytes: file.bytes, counted: true })),
  ].sort(bySize);
  const lines = listed
    .slice(0, INSIDE)
    .map((entry) => `- ${entry.name} — ${entry.counted ? formatBytes(entry.bytes) : 'not counted'}`);
  if (listed.length > INSIDE) lines.push(`- …and ${formatCount(listed.length - INSIDE)} more`);
  if (folder.smallCount > 0) {
    lines.push(`- ${plural(folder.smallCount, 'smaller item')} — ${formatBytes(folder.smallBytes)}`);
  }
  if (lines.length > 0) return lines.join('\n');
  if (folder.waiting === 0) return 'Nothing in it takes up space.';
  return scan.running ? 'Scanning…' : 'Not counted: scanning stopped first.';
}

/**
 * @param {Scan} scan
 * @param {Folder} folder
 * @param {Shown} shown
 * @returns {ListItem}
 */
function folderItem(scan, folder, shown) {
  const { platform } = shown.ctx;
  const path = scan.pathOf(folder);
  // Still to be counted, or never counted if the scan stopped.
  const partial = folder.waiting > 0;
  const manager = fileManager(platform);
  const share = formatShare(folder.bytes, shown.whole);
  const kind = kindOf(folder.name, true);
  const elsewhere = folder.skipped === 'cloud' || folder.skipped === 'disk';
  const subtitle =
    folder.skipped === 'cloud'
      ? 'Cloud storage, not counted'
      : folder.skipped === 'disk'
        ? 'On another disk, not counted'
        : `${share} · ${plural(folder.files, 'file')}${partial ? ' so far' : ''}`;
  /** @type {Icon} */
  const icon =
    folder.skipped === 'cloud'
      ? { emoji: '☁️' }
      : folder.skipped === 'disk'
        ? { builtin: 'hard-drive', tint: 'gray' }
        : { path };
  const now = Date.now();
  return {
    id: path,
    title: folder.name,
    subtitle,
    accessory: elsewhere ? '—' : formatBytes(folder.bytes),
    icon,
    detail: {
      title: folder.name,
      body: insideOf(folder, scan),
      metadata: [
        ...(kind !== 'Folder' ? [{ label: 'Kind', value: kind }] : []),
        ...(elsewhere
          ? []
          : [
              { label: 'Size on disk', value: `${formatBytes(folder.bytes)}${partial ? ' so far' : ''}` },
              { label: 'Share', value: `${share} of ${shown.label}` },
              { label: 'Files', value: formatCount(folder.files) },
              { label: 'Folders', value: formatCount(folder.folders) },
            ]),
        ...(folder.modified > 0 ? [{ label: 'Modified', value: timeAgo(folder.modified, now) }] : []),
        { label: 'Where', value: whereIs(path, home, platform) },
      ],
    },
    actions: [
      showContents(path, platform),
      { type: 'open-path', path, title: `Open in ${manager}` },
      { type: 'reveal-path', path, title: `Show in ${manager}` },
      copyPath(path),
      scanAgain(shown.at),
      moveToTrash(path, platform),
    ],
  };
}

/**
 * @param {Scan} scan
 * @param {File} file
 * @param {Shown} shown
 * @param {{ unpacked?: string }} [extra] `unpacked`: the folder next to an archive that it may
 *   have been unpacked into.
 * @returns {ListItem}
 */
function fileItem(scan, file, shown, { unpacked } = {}) {
  const { platform } = shown.ctx;
  const folder = scan.pathOf(file.folder);
  const path = join(folder, file.name);
  const kind = kindOf(file.name, false);
  const share = formatShare(file.bytes, shown.whole);
  const manager = fileManager(platform);
  const where = whereIs(path, home, platform);
  // Sparse files take less than their length, and the smallest files a little more.
  const differs = Math.abs(file.size - file.bytes) > Math.max(file.size, file.bytes) / 10;
  /** @type {Action[]} */
  const actions = [
    { type: 'reveal-path', path, title: `Show in ${manager}` },
    { type: 'open-path', path, title: 'Open' },
  ];
  if (platform === 'darwin') {
    actions.push({
      type: 'callback',
      id: 'quick-look',
      title: 'Quick Look',
      payload: path,
      shortcut: { key: 'y', modifiers: ['mod'] },
    });
  }
  if (shown.located) actions.push({ ...showContents(folder, platform), title: 'Show Folder in Disk Usage' });
  actions.push(copyPath(path), scanAgain(shown.at), moveToTrash(path, platform));
  return {
    id: path,
    title: file.name,
    subtitle: shown.located ? (unpacked ? `${where} · unpacked beside it` : where) : `${share} · ${kind}`,
    accessory: formatBytes(file.bytes),
    // A big image would be read whole to draw it small.
    icon: IMAGE.test(file.name) && file.size > BIG_IMAGE ? { builtin: 'file', tint: 'purple' } : { path },
    detail: {
      title: file.name,
      body: unpacked ? `There's a folder called “${unpacked}” next to it, so it may have been unpacked already.` : '',
      metadata: [
        { label: 'Kind', value: kind },
        { label: 'Size on disk', value: formatBytes(file.bytes) },
        ...(differs ? [{ label: 'Size', value: formatBytes(file.size) }] : []),
        { label: 'Share', value: `${share} of ${shown.label}` },
        { label: 'Modified', value: timeAgo(file.modified, Date.now()) },
        { label: 'Where', value: where },
      ],
    },
    actions,
  };
}

/**
 * A folder no scan has been in, typed into the search: it's scanned when asked, as a whole disk
 * takes a while.
 * @param {string} path
 * @param {string} label
 * @param {Context} ctx
 * @returns {ListItem}
 */
function askItem(path, label, ctx) {
  const disk = parse(path).root === path;
  return {
    id: 'scan-here',
    title: `Scan ${label}`,
    subtitle: disk ? 'Counts everything on the disk, which takes a while' : 'Counts everything in it',
    icon: { builtin: 'hard-drive', tint: 'blue' },
    actions: [
      { type: 'callback', id: 'scan', title: 'Scan', payload: path },
      { type: 'open-path', path, title: `Open in ${fileManager(ctx.platform)}` },
    ],
  };
}

/**
 * The folders a scan wasn't allowed to open, and how to let it: all of them, or the one `path`
 * when that's the folder the list is of.
 * @param {Scan} scan
 * @param {Context} ctx
 * @param {string} [path]
 * @returns {ListItem}
 */
function deniedItem(scan, ctx, path) {
  const mac = ctx.platform === 'darwin';
  const paths = path ? [path] : scan.denied;
  const listed = paths.slice(0, 50).map((each) => `- ${displayPath(each, home, ctx.platform)}`);
  const count = path ? 1 : scan.deniedCount;
  const more = count - listed.length;
  const title = `Couldn't look in ${path ? basename(path) : plural(count, 'folder')}`;
  const why = mac
    ? "macOS keeps some folders private, like Mail and Messages, and other apps' data, until you let an app in. Turn on Waypoint under Privacy & Security → Full Disk Access, then scan again."
    : "Waypoint isn't allowed to open them, so what's in them isn't counted.";
  /** @type {Action[]} */
  const actions = [];
  if (mac) actions.push({ type: 'open-url', url: FULL_DISK_ACCESS, title: 'Open Full Disk Access Settings' });
  actions.push({ type: 'copy', text: paths.join('\n'), title: path ? 'Copy Path' : 'Copy Paths' });
  actions.push(scanAgain(path ?? scan.path));
  return {
    id: 'denied',
    title,
    subtitle: mac ? `Give Waypoint Full Disk Access to count ${count === 1 ? 'it' : 'them'}` : 'Not allowed in',
    icon: { builtin: 'lock', tint: 'orange' },
    detail: {
      title,
      body: [why, '', ...listed, ...(more > 0 ? [`- …and ${formatCount(more)} more`] : [])].join('\n'),
    },
    actions,
  };
}

/**
 * How far the scan has got, and the folders it couldn't open.
 * @param {Scan} scan
 * @param {Context} ctx
 * @param {string} at The folder the list is of.
 * @returns {Promise<ListItem[]>}
 */
async function scanItems(scan, ctx, at) {
  const now = Date.now();
  // Counting one folder again, the rest being done already.
  const label = labelOf(scan.rescanning ? scan.pathOf(scan.rescanning) : scan.path, ctx.platform);
  const took = formatElapsed((scan.finished ?? now) - scan.started);
  const free = await freeSpace(scan.path);
  const manager = fileManager(ctx.platform);
  const metadata = [
    { label: 'Folder', value: displayPath(scan.path, home, ctx.platform) },
    { label: 'Size on disk', value: formatBytes(scan.root.bytes) },
    { label: 'Files', value: formatCount(scan.root.files) },
    { label: 'Folders', value: formatCount(scan.root.folders) },
    { label: scan.running ? 'Scanning for' : 'Took', value: took },
    ...(free !== undefined ? [{ label: 'Free on this disk', value: formatBytes(free) }] : []),
  ];
  /** @type {Action} */
  const open = { type: 'open-path', path: scan.path, title: `Open in ${manager}` };
  /** @type {ListItem[]} */
  const items = [
    scan.running
      ? {
          id: 'scan',
          title: `Scanning ${label}…`,
          subtitle: `${plural(scan.root.files, 'file')} · ${formatBytes(scan.root.bytes)} so far`,
          accessory: now - scan.started >= 1000 ? took : undefined,
          icon: { builtin: 'refresh', tint: 'blue' },
          detail: { title: `Scanning ${label}`, body: '', metadata },
          actions: [{ type: 'callback', id: 'stop', title: 'Stop Scanning', payload: scan.path }, open],
        }
      : {
          id: 'scan',
          title: scan.stopped ? 'Stopped scanning' : `Scanned ${timeAgo(scan.finished ?? now, now)}`,
          subtitle: `${plural(scan.root.files, 'file')} in ${plural(scan.root.folders, 'folder')} · took ${took}`,
          accessory: free !== undefined ? `${formatBytes(free)} free` : undefined,
          icon: { builtin: 'hard-drive', tint: 'gray' },
          detail: { title: label, body: '', metadata },
          actions: [scanAgain(at), open],
        },
  ];
  if (scan.deniedCount > 0) items.push(deniedItem(scan, ctx));
  return items;
}

// ── Lists ────────────────────────────────────────────────────────────────────

/**
 * The parts of a list every command shares: where it looks, and what to say when it can't.
 * @param {Context} ctx
 * @param {Omit<ListView, 'sections'>} base
 * @returns {Promise<{ view: ListView } | { scan: Scan, folder: Folder, words: string[], filter: string, at: string, label: string }>}
 */
async function scanned(ctx, base) {
  const query = (ctx.query || ctx.argument || '').trim();
  const where = await lookIn(query, ctx.platform);
  if ('missing' in where) {
    const shown = displayPath(where.missing, home, ctx.platform);
    return { view: { ...base, sections: [], emptyText: `There's no folder at ${shown}.` } };
  }
  const label = labelOf(where.folder, ctx.platform);
  // A folder typed into the search waits to be asked for; one opened from a row doesn't.
  const typed = where.named && ctx.query.trim() !== '';
  const found = await folderAt(where.folder, ctx.platform, { start: !typed });
  if ('ask' in found) return { view: { ...base, sections: [{ items: [askItem(where.folder, label, ctx)] }] } };
  const { scan, folder } = found;
  if (scan.error) return { view: { ...base, sections: [], emptyText: `Couldn't look in ${label}: ${scan.error}` } };
  if (!folder) {
    // The scan hasn't come to it yet; it's looked in next.
    return { view: { ...base, loading: true, sections: [], emptyText: `Scanning ${label}…` } };
  }
  if (folder.skipped === 'denied') {
    return {
      view: { ...base, loading: scan.running, sections: [{ items: [deniedItem(scan, ctx, where.folder)] }] },
    };
  }
  return { scan, folder, words: where.words, filter: where.filter, at: where.folder, label };
}

/**
 * @param {Context} ctx
 * @returns {Promise<ListView>}
 */
async function usageView(ctx) {
  /** @type {Omit<ListView, 'sections'>} */
  const base = {
    type: 'list',
    title: 'Disk Usage',
    searchPlaceholder: 'Filter, or type a folder like ~/Projects…',
    filtering: false,
  };
  const opened = await scanned(ctx, base);
  if ('view' in opened) return opened.view;
  const { scan, folder, words, filter, at, label } = opened;
  // Still to be counted, or never counted if the scan stopped.
  const partial = folder.waiting > 0;
  /** @type {Shown} */
  const shown = { ctx, at, label, whole: folder.bytes, located: false };
  const entries = [
    ...[...folder.children.values()]
      .filter((child) => matches(words, `${child.name} ${kindOf(child.name, true)}`))
      .map((child) => ({ name: child.name, bytes: child.bytes, child })),
    ...folder.big
      .filter((file) => matches(words, `${file.name} ${kindOf(file.name, false)} ${categoryOf(file.name) ?? ''}`))
      .map((file) => ({ name: file.name, bytes: file.bytes, file })),
  ].sort(bySize);
  /** @type {ListItem[]} */
  const items = entries
    .slice(0, SHOWN)
    .map((entry) => ('child' in entry ? folderItem(scan, entry.child, shown) : fileItem(scan, entry.file, shown)));
  const rest = entries.slice(SHOWN);
  if (rest.length > 0) {
    items.push({
      id: 'more',
      title: `${formatCount(rest.length)} more`,
      subtitle: 'Type to find one',
      accessory: formatBytes(rest.reduce((sum, entry) => sum + entry.bytes, 0)),
      icon: { builtin: 'folder', tint: 'gray' },
      actions: [{ type: 'open-path', path: at, title: `Open in ${fileManager(ctx.platform)}` }, scanAgain(at)],
    });
  }
  if (words.length === 0 && folder.smallCount > 0) {
    items.push({
      id: 'smaller',
      title: plural(folder.smallCount, 'smaller item'),
      subtitle: `Each under ${LISTED}`,
      accessory: formatBytes(folder.smallBytes),
      icon: { builtin: 'file', tint: 'gray' },
      actions: [{ type: 'open-path', path: at, title: `Open in ${fileManager(ctx.platform)}` }, scanAgain(at)],
    });
  }
  return {
    ...base,
    loading: scan.running,
    emptyText:
      words.length > 0
        ? `Nothing in ${label} matches “${filter}”${partial ? ' yet' : ''}.`
        : partial
          ? `Scanning ${label}…`
          : `Nothing in ${label} takes up space.`,
    sections: await listed(scan, ctx, at, {
      title: `${label} · ${formatBytes(folder.bytes)}${partial ? ' so far' : ''}`,
      items,
      stopped: partial && !scan.running && words.length === 0,
      label,
    }),
  };
}

/**
 * A list's sections: its rows, then how the scan's going. With no rows, nothing, so the list says
 * why instead; but a folder the scan stopped before counting still offers to scan again.
 * @param {Scan} scan
 * @param {Context} ctx
 * @param {string} at
 * @param {{ title: string, items: ListItem[], stopped: boolean, label: string }} rows
 * @returns {Promise<ListSection[]>}
 */
async function listed(scan, ctx, at, { title, items, stopped, label }) {
  if (items.length > 0)
    return [
      { title, items },
      { title: 'Scan', items: await scanItems(scan, ctx, at) },
    ];
  if (stopped)
    return [{ title: `${label} wasn't counted before scanning stopped`, items: await scanItems(scan, ctx, at) }];
  return [];
}

/**
 * The folders next to archives that they may have been unpacked into.
 * @param {Scan} scan
 * @param {File[]} files
 * @returns {Promise<Map<File, string>>}
 */
async function unpackedFolders(scan, files) {
  /** @type {Map<File, string>} */
  const found = new Map();
  await Promise.all(
    files.map(async (file) => {
      const name = unpackedName(file.name);
      if (name && (await isFolder(join(scan.pathOf(file.folder), name)))) found.set(file, name);
    }),
  );
  return found;
}

/**
 * Largest Files, or with `leftovers` Archives and Installers: the biggest files anywhere in a
 * folder, biggest first.
 * @param {Context} ctx
 * @param {boolean} leftovers
 * @returns {Promise<ListView>}
 */
async function filesView(ctx, leftovers) {
  /** @type {Omit<ListView, 'sections'>} */
  const base = {
    type: 'list',
    title: leftovers ? 'Archives and Installers' : 'Largest Files',
    searchPlaceholder: leftovers
      ? 'Filter, or type a folder like ~/Downloads…'
      : 'Filter by name or kind (zip, video…), or type a folder…',
    filtering: false,
  };
  const opened = await scanned(ctx, base);
  if ('view' in opened) return opened.view;
  const { scan, folder, words, filter, at, label } = opened;
  const partial = folder.waiting > 0;
  const downloads = scan.find(join(home, 'Downloads'));
  /** @type {File[]} */
  const found = [];
  for (const file of scan.filesIn(folder)) {
    if (leftovers && !isLeftover(file.name, { inDownloads: file.folder === downloads })) continue;
    if (words.length > 0) {
      const where = displayPath(scan.pathOf(file.folder), home, ctx.platform);
      if (!matches(words, `${file.name} ${kindOf(file.name, false)} ${categoryOf(file.name) ?? ''} ${where}`)) continue;
    }
    found.push(file);
    // They come biggest first.
    if (found.length === SHOWN) break;
  }
  const unpacked = leftovers ? await unpackedFolders(scan, found) : new Map();
  /** @type {Shown} */
  const shown = { ctx, at, label, whole: folder.bytes, located: true };
  const items = found.map((file) => fileItem(scan, file, shown, { unpacked: unpacked.get(file) }));
  const what = leftovers ? 'Archives, disk images and installers' : 'Largest files';
  const yet = partial ? ' yet' : '';
  return {
    ...base,
    loading: scan.running,
    emptyText:
      words.length > 0
        ? `Nothing in ${label} matches “${filter}”${yet}.`
        : leftovers
          ? `No archives, disk images or installers of ${LISTED} or more in ${label}${yet}.`
          : `No files of ${LISTED} or more in ${label}${yet}.`,
    sections: await listed(scan, ctx, at, {
      title: `${what} in ${label}${partial ? ' so far' : ''}`,
      items,
      stopped: partial && !scan.running && words.length === 0,
      label,
    }),
  };
}

// ── Doing things ─────────────────────────────────────────────────────────────

/**
 * Where a program is, looking where things install as well as PATH: an app started from the
 * Dock or Start menu gets a short PATH.
 * @param {string} name
 */
function findProgram(name) {
  const dirs = [...(process.env.PATH ?? '').split(delimiter), '/usr/bin', '/usr/local/bin', '/bin', '/snap/bin'];
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

/** The Linux programs that move things to the Trash, looked for once. */
function programs() {
  if (!foundPrograms) {
    const names = process.platform === 'linux' ? ['gio', 'kioclient5', 'trash-put'] : [];
    foundPrograms = Object.fromEntries(names.map((name) => [name, findProgram(name)]));
  }
  return foundPrograms;
}

/**
 * Runs a command until it exits.
 * @param {{ file: string, args: string[], env?: Record<string, string> }} command
 * @param {number} [timeoutMs]
 * @returns {Promise<void>}
 */
function runCommand(command, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const child = spawn(command.file, command.args, {
      stdio: ['ignore', 'ignore', 'pipe'],
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
      if (code === 0) return resolve();
      const said = stderr.trim().split('\n').pop()?.trim();
      reject(new Error(said || `${basename(command.file)} exited with code ${code}.`));
    });
  });
}

/**
 * Counts a folder again. A folder in a scan that's over is counted again in place; the folder a
 * scan started in, or one it doesn't have, gets a new scan.
 * @param {string} path
 * @param {string} platform
 * @returns {Scan | undefined} Nothing when a scan that has it is still running.
 */
function scanAgainAt(path, platform) {
  const scan = scanFor(path);
  const folder = scan?.find(path);
  if (scan?.running) return undefined;
  if (scan && folder && folder !== scan.root && scan.rescan(folder)) return scan;
  return startScan(scan && folder === scan.root ? scan.path : path, platform);
}

/**
 * The actions of a list's rows.
 * @param {(ctx: Context) => Promise<ListView>} view The list, to show again afterwards.
 */
function actions(view) {
  /**
   * @param {string} id
   * @param {unknown} payload
   * @param {Context} ctx
   * @returns {Promise<ActionResult | undefined>}
   */
  return async (id, payload, ctx) => {
    if (typeof payload !== 'string') return undefined;
    if (id === 'rescan') {
      const scan = scanAgainAt(payload, ctx.platform);
      if (!scan) return { toast: "Still scanning: it's up to date once it's done" };
      await within(scan.ready, FIRST_LOOK_MS);
      return { replace: await view(ctx) };
    }
    if (id === 'scan') {
      const scan = startScan(payload, ctx.platform);
      await within(scan.ready, FIRST_LOOK_MS);
      return { replace: await view(ctx) };
    }
    if (id === 'stop') {
      scans.get(payload)?.stop();
      return { replace: await view(ctx), toast: 'Stopped scanning' };
    }
    if (id === 'trash') {
      const name = basename(payload);
      const where = trashName(ctx.platform);
      const command = trashCommand(ctx.platform, payload, programs());
      if (!command) {
        return { toast: 'Install gio (GLib) or trash-cli to move files to the Trash.', toastStyle: 'failure' };
      }
      try {
        await runCommand(command);
      } catch (error) {
        return {
          toast: `Couldn't move “${name}” to the ${where}: ${explainTrash(error, ctx.platform)}`,
          toastStyle: 'failure',
        };
      }
      let freed = 0;
      for (const scan of scans.values()) freed = Math.max(freed, scan.remove(payload)?.bytes ?? 0);
      // It's still on the disk until the Trash is emptied.
      const toast =
        freed >= LISTED_MIN
          ? `Moved “${name}” to the ${where}. Empty it to free ${formatBytes(freed)}`
          : `Moved “${name}” to the ${where}`;
      return { replace: await view(ctx), toast };
    }
    if (id === 'quick-look') {
      // qlmanage shows the Quick Look panel; it's the same one Finder's space bar opens.
      const child = spawn('qlmanage', ['-p', payload], { detached: true, stdio: 'ignore' });
      child.once('error', (error) => console.error('[disk-usage] Quick Look:', message(error)));
      child.unref();
      return { hide: true };
    }
    return undefined;
  };
}

/** @param {Context} ctx */
const largestView = (ctx) => filesView(ctx, false);
/** @param {Context} ctx */
const leftoversView = (ctx) => filesView(ctx, true);

/** @type {Extension} */
export default {
  commands: {
    usage: { view: usageView, onAction: actions(usageView) },
    'largest-files': { view: largestView, onAction: actions(largestView) },
    archives: { view: leftoversView, onAction: actions(leftoversView) },
  },
};
