// The scanner against folders made for the test.
import { randomBytes } from 'node:crypto';
import {
  chmodSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { LISTED_MIN, Scan } from './scan.js';

const roots = /** @type {string[]} */ ([]);
afterAll(() => {
  for (const root of roots) {
    try {
      chmodSync(join(root, 'Private'), 0o755);
    } catch {
      // Not made in this one.
    }
    rmSync(root, { recursive: true, force: true });
  }
});

/**
 * A folder holding the files given, by path, and how big each is.
 * @param {Record<string, number>} files
 */
function makeFolder(files) {
  const root = mkdtempSync(join(tmpdir(), 'disk-usage-'));
  roots.push(root);
  for (const [path, size] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(join(full, '..'), { recursive: true });
    if (path.endsWith('/')) mkdirSync(full, { recursive: true });
    else writeFileSync(full, randomBytes(size));
  }
  return root;
}

/** @param {Scan} scan */
async function finished(scan) {
  scan.start();
  for (let i = 0; i < 500 && scan.running; i++) await new Promise((resolve) => setTimeout(resolve, 10));
  expect(scan.running).toBe(false);
  return scan;
}

/**
 * What everything in a folder takes on disk, counted the way du does it, to check against.
 * @param {string} dir
 * @param {Set<string>} [seen]
 */
function du(dir, seen = new Set()) {
  const own = lstatSync(dir);
  let bytes = own.blocks * 512;
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const info = lstatSync(path);
    if (info.isDirectory()) bytes += du(path, seen);
    else if (info.isFile()) {
      const key = `${info.dev}:${info.ino}`;
      if (seen.has(key)) continue;
      seen.add(key);
      bytes += info.blocks * 512;
    }
  }
  return bytes;
}

const MB = LISTED_MIN;
const blocks = process.platform !== 'win32';

describe('Scan', () => {
  it('adds up what folders hold, listing big things and adding up the rest', async () => {
    const root = makeFolder({
      'movie.mov': 3 * MB,
      'notes.txt': 2000,
      'Projects/app/bundle.js': 2 * MB,
      'Projects/app/src/index.js': 500,
      'Projects/tiny/readme.md': 100,
      'Empty/': 0,
    });
    const scan = await finished(new Scan(root));
    expect(scan.root.files).toBe(5);
    expect(scan.root.folders).toBe(5);
    if (blocks) expect(scan.root.bytes).toBe(du(root));
    expect(scan.root.big.map((file) => file.name)).toEqual(['movie.mov']);
    expect(scan.root.big[0]?.bytes).toBeGreaterThanOrEqual(3 * MB);
    // Too small to list on their own: notes.txt and the empty folder.
    expect(scan.root.smallCount).toBe(2);
    expect([...scan.root.children.keys()]).toEqual(['Projects']);
    const projects = scan.find(join(root, 'Projects'));
    expect(projects?.files).toBe(3);
    expect([...(projects?.children.keys() ?? [])]).toEqual(['app']);
    expect(scan.find(join(root, 'Projects', 'app'))?.big.map((file) => file.name)).toEqual(['bundle.js']);
    expect(scan.filesIn(scan.root).map((file) => file.name)).toEqual(['movie.mov', 'bundle.js']);
    expect(scan.pathOf(/** @type {any} */ (scan.find(join(root, 'Projects', 'app'))))).toBe(
      join(root, 'Projects', 'app'),
    );
  });

  it.skipIf(process.platform === 'win32')(
    "counts a file's hard links once, doesn't follow links, and counts a sparse file's blocks",
    async () => {
      const root = makeFolder({ 'data.bin': 2 * MB, 'elsewhere/': 0 });
      linkSync(join(root, 'data.bin'), join(root, 'elsewhere', 'same data.bin'));
      symlinkSync(join(root, 'data.bin'), join(root, 'link.bin'));
      symlinkSync(root, join(root, 'loop'));
      writeFileSync(join(root, 'sparse.img'), '');
      // 200 MB long, nothing written.
      const { truncateSync } = await import('node:fs');
      truncateSync(join(root, 'sparse.img'), 200 * MB);
      const scan = await finished(new Scan(root));
      expect(scan.root.files).toBe(2);
      expect(scan.root.bytes).toBe(du(root));
      expect(scan.root.bytes).toBeLessThan(10 * MB);
      expect(scan.filesIn(scan.root).map((file) => file.name)).toEqual(['data.bin']);
    },
  );

  it('lists a folder it was told to leave alone, without looking inside', async () => {
    const root = makeFolder({ 'CloudStorage/Drive/huge.mov': 2 * MB, 'kept.bin': 2 * MB });
    const scan = await finished(
      new Scan(root, { skip: (path) => (path === join(root, 'CloudStorage') ? 'cloud' : undefined) }),
    );
    const cloud = scan.find(join(root, 'CloudStorage'));
    expect(cloud?.skipped).toBe('cloud');
    expect(cloud?.bytes).toBe(0);
    expect(scan.root.files).toBe(1);
  });

  it('finds folders by path, ignoring case when it must', async () => {
    const root = makeFolder({ 'Library/Caches/big.db': 2 * MB });
    const scan = await finished(new Scan(root));
    expect(scan.find(root)).toBe(scan.root);
    expect(scan.find(join(root, 'Library', 'Caches'))?.name).toBe('Caches');
    // Linux tells names apart by case; macOS and Windows don't.
    expect(scan.find(join(root, 'library', 'caches'))?.name).toBe(process.platform === 'linux' ? undefined : 'Caches');
    expect(scan.find(join(root, 'Nope'))).toBeUndefined();
    expect(scan.find(join(root, '..'))).toBeUndefined();
    expect(scan.covers(join(root, 'Library'))).toBe(true);
    expect(scan.covers(join(root, '..', 'other'))).toBe(false);
  });

  it('takes out what was moved to the Trash, from every folder it was in', async () => {
    const root = makeFolder({ 'a/b/big.zip': 3 * MB, 'a/b/also.bin': 2 * MB, 'a/keep.bin': 2 * MB });
    const scan = await finished(new Scan(root));
    const total = scan.root.bytes;
    const zip = scan.find(join(root, 'a', 'b'))?.big.find((file) => file.name === 'big.zip');
    const removed = scan.remove(join(root, 'a', 'b', 'big.zip'));
    expect(removed?.bytes).toBe(zip?.bytes);
    expect(scan.root.bytes).toBe(total - (zip?.bytes ?? 0));
    expect(scan.find(join(root, 'a'))?.files).toBe(2);
    const b = scan.find(join(root, 'a', 'b'));
    expect(scan.remove(join(root, 'a', 'b'))?.bytes).toBe(b?.bytes);
    expect(scan.find(join(root, 'a', 'b'))).toBeUndefined();
    expect(scan.root.files).toBe(1);
    expect(scan.root.folders).toBe(1);
    expect(scan.filesIn(scan.root).map((file) => file.name)).toEqual(['keep.bin']);
    expect(scan.remove(join(root, 'never there.bin'))).toBeUndefined();
  });

  it('counts a folder again once it has changed', async () => {
    const root = makeFolder({ 'Downloads/old.dmg': 3 * MB, 'Music/song.flac': 2 * MB });
    const scan = await finished(new Scan(root));
    rmSync(join(root, 'Downloads', 'old.dmg'));
    writeFileSync(join(root, 'Downloads', 'new.zip'), randomBytes(2 * MB));
    writeFileSync(join(root, 'Downloads', 'other.zip'), randomBytes(2 * MB));
    const downloads = /** @type {import('./scan.js').Folder} */ (scan.find(join(root, 'Downloads')));
    expect(scan.rescan(downloads)).toBe(true);
    expect(scan.running).toBe(true);
    for (let i = 0; i < 500 && scan.running; i++) await new Promise((resolve) => setTimeout(resolve, 10));
    expect(scan.running).toBe(false);
    expect(downloads.big.map((file) => file.name).sort()).toEqual(['new.zip', 'other.zip']);
    expect(scan.root.files).toBe(3);
    if (blocks) expect(scan.root.bytes).toBe(du(root));
    // The folder it started in is scanned afresh instead.
    expect(scan.rescan(scan.root)).toBe(false);
  });

  it('counts the folder on screen first', async () => {
    /** @type {Record<string, number>} */
    const files = {};
    for (let folder = 0; folder < 8; folder++) {
      // Each big enough to be listed when it's done.
      files[`folder ${folder}/big.bin`] = MB + 1000;
      for (let file = 0; file < 300; file++) files[`folder ${folder}/file ${file}.txt`] = 10;
    }
    const root = makeFolder(files);
    const scan = new Scan(root).start();
    await scan.ready;
    // Whichever comes up last otherwise.
    const target = join(root, 'folder 0');
    scan.focus(target);
    /** @type {string[]} */
    const done = [];
    while (scan.running) {
      for (const [name, folder] of scan.root.children)
        if (folder.waiting === 0 && !done.includes(name)) done.push(name);
      await new Promise((resolve) => setImmediate(resolve));
    }
    // Two folders may have been opened before it was asked for.
    expect(done.indexOf('folder 0')).toBeLessThanOrEqual(2);
    expect(done.indexOf('folder 0')).toBeGreaterThanOrEqual(0);
  });

  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
    "says which folders it wasn't allowed to open",
    async () => {
      const root = makeFolder({ 'Private/secret.bin': 2 * MB, 'open.bin': 2 * MB });
      chmodSync(join(root, 'Private'), 0o000);
      const scan = await finished(new Scan(root));
      expect(scan.deniedCount).toBe(1);
      expect(scan.denied).toEqual([join(root, 'Private')]);
      expect(scan.root.files).toBe(1);
    },
  );

  it('counts a hard link once when a folder is counted again', async () => {
    if (process.platform === 'win32') return;
    const root = makeFolder({ 'store/data.bin': 2 * MB, 'app/node_modules/': 0, 'app/own.bin': 2 * MB });
    linkSync(join(root, 'store', 'data.bin'), join(root, 'app', 'node_modules', 'data.bin'));
    const scan = await finished(new Scan(root));
    const total = scan.root.bytes;
    expect(total).toBe(du(root));
    for (const name of ['app', 'store']) {
      expect(scan.rescan(/** @type {import('./scan.js').Folder} */ (scan.find(join(root, name))))).toBe(true);
      for (let i = 0; i < 500 && scan.running; i++) await new Promise((resolve) => setTimeout(resolve, 10));
      expect(scan.root.bytes).toBe(total);
    }
  });

  it('takes out a folder moved to the Trash while it was being counted again', async () => {
    const root = makeFolder({ 'a/b/c.bin': 2 * MB, 'a/d.bin': 2 * MB, 'e.bin': 2 * MB });
    const scan = await finished(new Scan(root));
    const before = scan.root.bytes;
    const a = /** @type {import('./scan.js').Folder} */ (scan.find(join(root, 'a')));
    expect(scan.rescan(a)).toBe(true);
    expect(scan.remove(join(root, 'a'))).toBeDefined();
    expect(scan.running).toBe(false);
    for (let i = 0; i < 50; i++) await new Promise((resolve) => setTimeout(resolve, 10));
    expect(scan.root.waiting).toBe(0);
    expect(scan.root.files).toBe(1);
    expect(scan.root.folders).toBe(0);
    expect(scan.root.bytes).toBeLessThan(before);
  });

  it('knows whether it may still come to a folder it has not found', async () => {
    const root = makeFolder({ 'Big/data.bin': 2 * MB, 'small/notes.txt': 100 });
    const scan = new Scan(root).start();
    // Nothing's been listed yet.
    expect(scan.mayReach(join(root, 'small'))).toBe(true);
    await finished(scan);
    expect(scan.find(join(root, 'Big'))).toBeDefined();
    // Too small to list: it never turns up.
    expect(scan.find(join(root, 'small'))).toBeUndefined();
    expect(scan.mayReach(join(root, 'small'))).toBe(false);
    // A name that starts with two dots is still in it.
    expect(scan.covers(join(root, '..data'))).toBe(true);
    expect(scan.covers(join(root, '..', 'elsewhere'))).toBe(false);
  });

  it('stops, and says why it could not start', async () => {
    const root = makeFolder({ 'a/b/c/d.bin': 100 });
    const scan = new Scan(root).start();
    scan.stop();
    expect(scan.running).toBe(false);
    expect(scan.stopped).toBe(true);
    await scan.ready;
    // What it never finished is counted by a new scan, not this one.
    expect(scan.rescan(scan.root)).toBe(false);
    const missing = await finished(new Scan(join(root, 'not here')));
    expect(missing.error).toBeTruthy();
  });
});
