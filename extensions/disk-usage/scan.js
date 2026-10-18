// Adding up the space folders take: a walk through a folder and everything in it that carries on
// in the background after the call that started it has returned, so a list can show it filling
// in. Sizes are what files take on disk, as du counts them: a sparse file counts the blocks it
// uses, a file that's only in iCloud or OneDrive counts nothing, and a file with several hard
// links counts once. Symbolic links aren't followed, and the walk stays on the disk it started
// on. Files and folders too small to matter are added up rather than kept one by one, so a scan
// of a whole home folder stays small.
import { lstat, readdir, stat, statSync } from 'node:fs';
import { basename, isAbsolute, join, relative, sep } from 'node:path';

/** Files and folders smaller than this aren't listed one by one, only added up. */
export const LISTED_MIN = 1_000_000;
/** Files looked at together: enough to keep the disk busy, few enough for other extensions to get a turn. */
const MAX_LOOKS = 32;
/**
 * Folders opened together. macOS holds a folder's opening while it asks whether Waypoint may
 * look inside, and each one held keeps one of Node's few workers waiting, so only two at once.
 */
const MAX_OPENS = 2;
/** Folders kept that couldn't be opened, to say which. */
const MAX_DENIED = 200;
/**
 * Whether files and folders met twice can be told by their inode: a file's hard links, and a
 * folder mounted a second time inside itself. Windows' file IDs are too big for a JavaScript
 * number to hold exactly, so there they aren't compared.
 */
const SAME_BY_INODE = process.platform !== 'win32';
/** Whether names match ignoring case, as they do on macOS and Windows but not Linux. */
const ANY_CASE = process.platform !== 'linux';
/** How long a running scan's sorted list of its biggest files is used before it's sorted again. */
const RESORT_MS = 2000;

/**
 * @typedef {object} Folder
 * @property {string} name
 * @property {Folder | undefined} parent Nothing for the folder a scan started in, and for one
 *   taken out of the scan (moved to the Trash).
 * @property {number} bytes The space everything in it takes, found so far.
 * @property {number} files Files in it, at any depth.
 * @property {number} folders Folders in it, at any depth.
 * @property {number} modified
 * @property {number} own The space the folder itself takes, without what's in it.
 * @property {Map<string, Folder>} children Folders in it big enough to list, or still being counted.
 * @property {File[]} big Files right in it big enough to list.
 * @property {number} smallBytes What everything else right in it takes: smaller files and folders.
 * @property {number} smallCount
 * @property {number} waiting What's left before it's counted: opening it, looking at what's in it,
 *   and counting its folders.
 * @property {number} unlooked What's in it that's still to be looked at, once it's been opened.
 * @property {boolean} opened
 * @property {'cloud' | 'disk' | 'denied'} [skipped] Why it wasn't looked through.
 */

/**
 * @typedef {object} File
 * @property {string} name
 * @property {number} bytes The space it takes on disk.
 * @property {number} size How long it is, which is more for a sparse file.
 * @property {number} modified
 * @property {Folder} folder
 */

/** @typedef {{ scan: Scan, folder: Folder, path: string }} Open */
/** @typedef {{ scan: Scan, folder: Folder, path: string, name: string }} Look */

/** Work from every scan, last in first out, so a folder is finished before the next is begun. */
/** @type {Open[]} */
const opens = [];
/** @type {Look[]} */
const looks = [];
/** Work in the folder on screen, which goes before the rest. @type {Open[]} */
const focusedOpens = [];
/** @type {Look[]} */
const focusedLooks = [];
/** The folder on screen, while it's still being counted. @type {{ scan: Scan, folder: Folder } | undefined} */
let focus;
let opening = 0;
let looking = 0;

/** @param {Open | Look} job */
function isFocused(job) {
  if (job.scan !== focus?.scan) return false;
  for (let each = /** @type {Folder | undefined} */ (job.folder); each; each = each.parent) {
    if (each === focus.folder) return true;
  }
  return false;
}

/** @param {Open} job */
function queueOpen(job) {
  (isFocused(job) ? focusedOpens : opens).push(job);
}

/** @param {Look} job */
function queueLook(job) {
  (isFocused(job) ? focusedLooks : looks).push(job);
}

/**
 * Starts as much waiting work as the limits allow, the folder on screen's first. Each callback
 * is guarded: a throw there would bring down the process every extension runs in.
 */
function pump() {
  while (looking < MAX_LOOKS) {
    const job = focusedLooks.pop() ?? looks.pop();
    if (!job) break;
    if (job.scan.stopped) continue;
    looking++;
    lstat(job.path, (error, info) => {
      looking--;
      guard(() => job.scan.looked(job, error, info));
      pump();
    });
  }
  // A folder's files are looked at before more folders are opened, so folders get finished one
  // after another, rather than all of them begun and none done.
  while (opening < MAX_OPENS && focusedLooks.length + looks.length < MAX_LOOKS) {
    const job = focusedOpens.pop() ?? opens.pop();
    if (!job) break;
    if (job.scan.stopped) continue;
    opening++;
    readdir(job.path, { withFileTypes: true }, (error, entries) => {
      opening--;
      guard(() => job.scan.opened(job, error, entries));
      pump();
    });
  }
}

/**
 * Makes a folder the one whose work goes first, or none. What was first before goes back on top
 * of the rest, in its order.
 * @param {{ scan: Scan, folder: Folder } | undefined} next
 */
function focusOn(next) {
  for (const job of focusedOpens.splice(0)) opens.push(job);
  for (const job of focusedLooks.splice(0)) looks.push(job);
  focus = next;
  if (!focus) return;
  /**
   * @template {Open | Look} T
   * @param {T[]} jobs
   * @param {T[]} focused
   */
  const take = (jobs, focused) => {
    const rest = jobs.filter((job) => !isFocused(job));
    if (rest.length === jobs.length) return;
    for (const job of jobs) if (isFocused(job)) focused.push(job);
    jobs.length = 0;
    for (const job of rest) jobs.push(job);
  };
  take(opens, focusedOpens);
  take(looks, focusedLooks);
}

/** @param {() => void} work */
function guard(work) {
  try {
    work();
  } catch (error) {
    console.error('[disk-usage]', error);
  }
}

/** @type {boolean | undefined} */
let countsBlocks;

/**
 * What a file takes on disk: its blocks, or its length where the system doesn't count them. Node
 * counts blocks everywhere it can; this checks on a file that's surely there, the program itself.
 * @param {import('node:fs').Stats} info
 */
function onDisk(info) {
  if (countsBlocks === undefined) {
    try {
      countsBlocks = statSync(process.execPath).blocks > 0;
    } catch {
      countsBlocks = process.platform !== 'win32';
    }
  }
  return countsBlocks && typeof info.blocks === 'number' ? info.blocks * 512 : info.size;
}

/**
 * @param {string} name
 * @param {Folder | undefined} parent
 * @returns {Folder}
 */
function newFolder(name, parent) {
  return {
    name,
    parent,
    bytes: 0,
    files: 0,
    folders: 0,
    modified: 0,
    own: 0,
    children: new Map(),
    big: [],
    smallBytes: 0,
    smallCount: 0,
    waiting: 0,
    unlooked: 0,
    opened: false,
  };
}

/**
 * Adds space and files to a folder and every folder it's in.
 * @param {Folder | undefined} folder
 * @param {number} bytes
 * @param {number} files
 */
function grow(folder, bytes, files) {
  for (let each = folder; each; each = each.parent) {
    each.bytes += bytes;
    each.files += files;
  }
}

/**
 * Whether a folder is another one or in it.
 * @param {Folder} folder
 * @param {Folder} other
 */
function isWithin(folder, other) {
  for (let each = /** @type {Folder | undefined} */ (folder); each; each = each.parent) {
    if (each === other) return true;
  }
  return false;
}

/**
 * A path's way down from a scan's folder, one name a step, or nothing when it's outside it.
 * @param {string} from
 * @param {string} path
 */
function stepsTo(from, path) {
  const rel = relative(from, path);
  if (rel === '') return [];
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return undefined;
  return rel.split(sep);
}

/**
 * The biggest files under a folder, sorted again only once the scan has found more: while it
 * runs, at most every couple of seconds, as a list that's filling in asks for them every second.
 * @type {WeakMap<Folder, { version: number, changes: number, at: number, files: File[] }>}
 */
const sortedFiles = new WeakMap();

/** @param {{ bytes: number, name: string }} a @param {{ bytes: number, name: string }} b */
export const bySize = (a, b) => b.bytes - a.bytes || a.name.localeCompare(b.name);

export class Scan {
  /**
   * @param {string} path The folder to scan, absolute.
   * @param {object} [options]
   * @param {(path: string) => 'cloud' | 'disk' | undefined} [options.skip] Folders not to look
   *   through, and why.
   * @param {number[]} [options.devices] More disks to carry on onto, besides the one it starts on.
   */
  constructor(path, { skip = () => undefined, devices = [] } = {}) {
    this.path = path;
    this.root = newFolder(basename(path) || path, undefined);
    this.skip = skip;
    this.extraDevices = devices;
    /** @type {Set<number>} */
    this.devices = new Set();
    this.started = Date.now();
    /** @type {number | undefined} When it finished, or was stopped. */
    this.finished = undefined;
    this.stopped = false;
    /** @type {string | undefined} Why it couldn't start. */
    this.error = undefined;
    /** @type {string[]} Folders it wasn't allowed to open. */
    this.denied = [];
    this.deniedCount = 0;
    /** Goes up whenever there are more files to list, or fewer. */
    this.version = 0;
    /** Goes up whenever files are taken away or the scan finishes, which lists show at once. */
    this.changes = 0;
    /**
     * Folders met, by disk and inode, so one mounted a second time inside itself isn't walked
     * forever. Only needed while walking.
     * @type {Map<number, Set<number>>}
     */
    this.folderInodes = new Map();
    /**
     * Files with more than one hard link, by disk and inode: where each was counted, and in which
     * pass, so it counts once even when a folder is counted again.
     * @type {Map<number, Map<number, { folder: Folder, pass: number }>>}
     */
    this.links = new Map();
    /** Goes up each time a folder is counted again. */
    this.pass = 0;
    /** @type {Folder | undefined} A folder being counted again, when that's all that's running. */
    this.rescanning = undefined;
    /** Looks left at what's right in the folder it started in, until it's listed. */
    this.rootLeft = -1;
    /** @type {() => void} */
    this.markReady = () => {};
    /** Settles once the folder it started in is listed, with its folders still being counted. */
    this.ready = new Promise((resolve) => {
      this.markReady = () => resolve(undefined);
    });
  }

  get running() {
    return this.finished === undefined;
  }

  /** Starts the scan, and returns it. */
  start() {
    // The folder itself may be a link, like /tmp on macOS; what it points to is scanned.
    stat(this.path, (error, info) =>
      guard(() => {
        if (this.stopped) return;
        if (error || !info.isDirectory()) {
          this.error = error ? error.message : 'Not a folder.';
          this.finish();
          return;
        }
        this.devices = new Set([info.dev, ...this.extraDevices]);
        this.firstFolderSight(info);
        this.root.modified = info.mtimeMs;
        this.root.own = onDisk(info);
        grow(this.root, this.root.own, 0);
        this.root.waiting = 1;
        queueOpen({ scan: this, folder: this.root, path: this.path });
        pump();
      }),
    );
    return this;
  }

  stop() {
    if (!this.running) return;
    this.stopped = true;
    if (focus?.scan === this) focusOn(undefined);
    this.finish();
  }

  /** @param {Open} job @param {NodeJS.ErrnoException | null} error @param {import('node:fs').Dirent[]} entries */
  opened({ folder, path }, error, entries) {
    if (this.stopped) return;
    folder.opened = true;
    if (error) {
      if (error.code === 'EACCES' || error.code === 'EPERM') {
        folder.skipped = 'denied';
        this.deniedCount++;
        if (this.denied.length < MAX_DENIED) this.denied.push(path);
      }
    } else {
      let count = 0;
      for (const entry of entries) {
        // Links aren't followed; sockets and devices take no space.
        if (entry.isSymbolicLink() || entry.isFIFO() || entry.isSocket()) continue;
        if (entry.isBlockDevice() || entry.isCharacterDevice()) continue;
        folder.waiting++;
        count++;
        queueLook({ scan: this, folder, path: join(path, entry.name), name: entry.name });
      }
      folder.unlooked = count;
      if (folder === this.root) this.rootLeft = count;
    }
    if (folder === this.root && this.rootLeft <= 0) this.markReady();
    this.settle(folder);
  }

  /** @param {Look} job @param {NodeJS.ErrnoException | null} error @param {import('node:fs').Stats} info */
  looked({ folder, path, name }, error, info) {
    if (this.stopped) return;
    if (!error) {
      if (info.isDirectory()) this.addFolder(folder, path, name, info);
      else if (info.isFile()) this.addFile(folder, name, info);
    }
    folder.unlooked--;
    if (folder === this.root && --this.rootLeft === 0) this.markReady();
    this.settle(folder);
  }

  /**
   * @param {Folder} parent
   * @param {string} path
   * @param {string} name
   * @param {import('node:fs').Stats} info
   */
  addFolder(parent, path, name, info) {
    // The same folder again, mounted a second time: it's counted where it was met first.
    if (!this.firstFolderSight(info)) return;
    const folder = newFolder(name, parent);
    folder.modified = info.mtimeMs;
    parent.children.set(name, folder);
    for (let each = /** @type {Folder | undefined} */ (parent); each; each = each.parent) each.folders++;
    const skipped = this.skip(path) ?? (this.devices.has(info.dev) ? undefined : 'disk');
    if (skipped) {
      // Listed for what it is, but not looked through.
      folder.skipped = skipped;
      return;
    }
    // A folder takes a little space itself, as du counts too.
    folder.own = onDisk(info);
    grow(folder, folder.own, 0);
    folder.waiting = 1;
    parent.waiting++;
    queueOpen({ scan: this, folder, path });
  }

  /**
   * @param {Folder} folder
   * @param {string} name
   * @param {import('node:fs').Stats} info
   */
  addFile(folder, name, info) {
    if (SAME_BY_INODE && info.nlink > 1 && !this.firstLinkSight(folder, info)) return;
    const bytes = onDisk(info);
    grow(folder, bytes, 1);
    if (bytes >= LISTED_MIN) {
      folder.big.push({ name, bytes, size: info.size, modified: info.mtimeMs, folder });
      this.version++;
    } else {
      folder.smallBytes += bytes;
      folder.smallCount++;
    }
  }

  /**
   * Whether a folder is met for the first time on this walk, by its inode where that can tell.
   * @param {import('node:fs').Stats} info
   */
  firstFolderSight(info) {
    if (!SAME_BY_INODE) return true;
    let inodes = this.folderInodes.get(info.dev);
    if (!inodes) {
      inodes = new Set();
      this.folderInodes.set(info.dev, inodes);
    }
    if (inodes.has(info.ino)) return false;
    inodes.add(info.ino);
    return true;
  }

  /**
   * Whether a file with several hard links is to be counted here: it hasn't been counted yet, or
   * only in the folder being counted again, before it was.
   * @param {Folder} folder
   * @param {import('node:fs').Stats} info
   */
  firstLinkSight(folder, info) {
    let byInode = this.links.get(info.dev);
    if (!byInode) {
      byInode = new Map();
      this.links.set(info.dev, byInode);
    }
    const counted = byInode.get(info.ino);
    if (counted) {
      const before = counted.pass < this.pass;
      if (!(before && this.rescanning && isWithin(counted.folder, this.rescanning))) return false;
    }
    byInode.set(info.ino, { folder, pass: this.pass });
    return true;
  }

  /** One piece of a folder's work is done. @param {Folder} folder */
  settle(folder) {
    folder.waiting--;
    if (folder.waiting > 0) return;
    if (focus?.folder === folder) focusOn(undefined);
    if (folder === this.root || folder === this.rescanning) {
      this.finish();
      return;
    }
    const parent = folder.parent;
    // Gone to the Trash while it was being counted.
    if (!parent) return;
    if (folder.bytes < LISTED_MIN) {
      // Too small to list on its own: it's added up with the other small things.
      parent.children.delete(folder.name);
      parent.smallBytes += folder.bytes;
      parent.smallCount++;
    }
    this.settle(parent);
  }

  finish() {
    this.finished = Date.now();
    this.rescanning = undefined;
    this.folderInodes = new Map();
    this.version++;
    this.changes++;
    this.markReady();
  }

  /**
   * A folder's folder by name, ignoring case where the system does.
   * @param {Folder} folder
   * @param {string} name
   */
  child(folder, name) {
    const exact = folder.children.get(name);
    if (exact || !ANY_CASE) return exact;
    const lower = name.toLowerCase();
    for (const child of folder.children.values()) if (child.name.toLowerCase() === lower) return child;
    return undefined;
  }

  /**
   * The folder at a path, if the scan has come to it and it's big enough to list.
   * @param {string} path
   * @returns {Folder | undefined}
   */
  find(path) {
    const steps = stepsTo(this.path, path);
    if (!steps) return undefined;
    let folder = this.root;
    for (const name of steps) {
      const next = this.child(folder, name);
      if (!next) return undefined;
      folder = next;
    }
    return folder;
  }

  /** @param {string} path Whether the path is the scanned folder, or in it. */
  covers(path) {
    return stepsTo(this.path, path) !== undefined;
  }

  /**
   * Whether the scan may yet come to a folder it hasn't found: the nearest folder it's in that
   * the scan has is still being listed. A folder too small to list, or in one the scan left
   * alone, never turns up.
   * @param {string} path
   */
  mayReach(path) {
    const steps = stepsTo(this.path, path);
    if (!this.running || !steps) return false;
    let folder = this.root;
    for (const name of steps) {
      const next = this.child(folder, name);
      if (!next) return !folder.skipped && !(folder.opened && folder.unlooked === 0);
      folder = next;
    }
    return true;
  }

  /**
   * Counts what's in a folder next: the folder on screen shouldn't wait for the rest of the
   * disk. When the scan hasn't come to the folder yet, the nearest folder it's in goes first.
   * @param {string} path
   */
  focus(path) {
    const steps = stepsTo(this.path, path);
    if (!this.running || !steps) return;
    /** @type {Folder | undefined} */
    let target = this.root;
    for (const name of steps) {
      const next = this.child(target, name);
      if (!next) break;
      target = next;
    }
    if (target.waiting === 0 || (focus?.scan === this && focus.folder === target)) return;
    focusOn({ scan: this, folder: target });
    pump();
  }

  /** @param {Folder} folder */
  pathOf(folder) {
    /** @type {string[]} */
    const names = [];
    for (let each = folder; each !== this.root && each.parent; each = each.parent) names.push(each.name);
    return join(this.path, ...names.reverse());
  }

  /**
   * Every file big enough to list in a folder and the folders in it, biggest first.
   * @param {Folder} folder
   * @returns {File[]}
   */
  filesIn(folder) {
    const cached = sortedFiles.get(folder);
    const fresh = cached?.version === this.version || (this.running && Date.now() - (cached?.at ?? 0) < RESORT_MS);
    if (cached && cached.changes === this.changes && fresh) return cached.files;
    /** @type {File[]} */
    const files = [];
    const stack = [folder];
    for (let each = stack.pop(); each; each = stack.pop()) {
      // One at a time: a folder of photos can hold more than spreading into push() takes.
      for (const file of each.big) files.push(file);
      for (const child of each.children.values()) stack.push(child);
    }
    files.sort(bySize);
    sortedFiles.set(folder, { version: this.version, changes: this.changes, at: Date.now(), files });
    return files;
  }

  /**
   * Takes a file or folder out of the scan, after it's been moved to the Trash.
   * @param {string} path
   * @returns {{ bytes: number } | undefined} The space it took, if the scan had it.
   */
  remove(path) {
    const folder = path === this.path ? undefined : this.find(join(path, '..'));
    if (!folder) return undefined;
    const name = basename(path);
    const child = this.child(folder, name);
    if (child) {
      grow(folder, -child.bytes, -child.files);
      for (let each = /** @type {Folder | undefined} */ (folder); each; each = each.parent) {
        each.folders -= child.folders + 1;
      }
      folder.children.delete(child.name);
      child.parent = undefined;
      // Being counted again, it was all that was left to do. Otherwise its folder was waiting
      // for it to be counted, and needn't any more.
      if (child === this.rescanning) this.finish();
      else if (child.waiting > 0) this.settle(folder);
      this.version++;
      this.changes++;
      return { bytes: child.bytes };
    }
    const index = folder.big.findIndex((file) => file.name === name);
    if (index < 0) return undefined;
    const [file] = folder.big.splice(index, 1);
    grow(folder, -(file?.bytes ?? 0), -1);
    this.version++;
    this.changes++;
    return { bytes: file?.bytes ?? 0 };
  }

  /**
   * Counts a folder again from scratch, once the scan is over. Returns false when it can't, and
   * a scan should be started for the folder instead: while it's running, once it was stopped,
   * for the folder it started in, and for one it was told to leave alone.
   * @param {Folder} folder
   */
  rescan(folder) {
    if (this.running || this.stopped || folder === this.root || !folder.parent) return false;
    // Cloud storage and other disks get a scan of their own.
    if (folder.skipped === 'cloud' || folder.skipped === 'disk') return false;
    grow(folder.parent, -folder.bytes, -folder.files);
    for (let each = /** @type {Folder | undefined} */ (folder.parent); each; each = each.parent) {
      each.folders -= folder.folders;
    }
    const path = this.pathOf(folder);
    const inside = path + sep;
    const before = this.denied.length;
    this.denied = this.denied.filter((denied) => denied !== path && !denied.startsWith(inside));
    this.deniedCount -= before - this.denied.length;
    const { modified, own } = folder;
    Object.assign(folder, newFolder(folder.name, folder.parent), { modified, own, waiting: 1 });
    delete folder.skipped;
    grow(folder, own, 0);
    this.pass++;
    this.rescanning = folder;
    this.started = Date.now();
    this.finished = undefined;
    this.version++;
    this.changes++;
    queueOpen({ scan: this, folder, path });
    pump();
    return true;
  }
}
