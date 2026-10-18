// The commands against a home folder made for the test.
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const home = mkdtempSync(join(tmpdir(), 'disk-usage-home-'));
const MB = 1_000_000;
/** @type {import('@waypoint/api').Extension} */
let extension;

/** @param {string} path @param {number} size */
function write(path, size) {
  mkdirSync(join(home, path, '..'), { recursive: true });
  writeFileSync(join(home, path), randomBytes(size));
}

beforeAll(async () => {
  // os.homedir() reads HOME, or USERPROFILE on Windows.
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  write('Library/Caches/cache.db', 7 * MB);
  write('Library/CloudStorage/GoogleDrive/huge.mov', 2 * MB);
  write('Downloads/photos.zip', 5 * MB);
  mkdirSync(join(home, 'Downloads', 'photos'));
  write('Downloads/SteamSetup.exe', 1.5 * MB);
  write('Projects/app/node_modules/big/lib.node', 2.5 * MB);
  write('Projects/movie clip.mov', 1.2 * MB);
  write('notes.txt', 3000);
  extension = (await import('./index.js')).default;
});

afterAll(() => rmSync(home, { recursive: true, force: true }));

/**
 * @param {string} query
 * @param {{ argument?: string, platform?: string }} [options]
 * @returns {any}
 */
const ctx = (query, { argument, platform = process.platform } = {}) => ({ query, argument, platform });

/**
 * A command's list once it's done loading, asking again as the launcher would.
 * @param {string} command
 * @param {string} query
 * @param {{ argument?: string, platform?: string }} [options]
 */
async function settled(command, query, options) {
  let view = await extension.commands[command]?.view?.(ctx(query, options));
  for (let i = 0; i < 200 && view?.loading; i++) {
    await new Promise((resolve) => setTimeout(resolve, 20));
    view = await extension.commands[command]?.view?.(ctx(query, options));
  }
  expect(view?.loading).toBeFalsy();
  return /** @type {import('@waypoint/api').ListView} */ (view);
}

/** @param {import('@waypoint/api').ListView} view */
const titles = (view) => view.sections[0]?.items.map((item) => item.title);

describe('Disk Usage', () => {
  it('lists your home folder biggest first, adding up the small things', async () => {
    const view = await settled('usage', '');
    expect(view.sections.map((section) => section.title?.replace(/\d.*/, ''))).toEqual(['Home · ', 'Scan']);
    expect(titles(view)).toEqual(['Library', 'Downloads', 'Projects', '1 smaller item']);
    const [library] = view.sections[0]?.items ?? [];
    expect(library?.accessory).toMatch(/^\d+(\.\d)? MB$/);
    expect(library?.subtitle).toMatch(/^\d+% · 2 files$/);
    expect(library?.detail?.body).toMatch(/^- Caches\/ — 7\.\d MB\n- CloudStorage\/ — 2\.\d MB/);
    expect(library?.actions.map((action) => action.title)).toEqual([
      'Show Contents',
      expect.stringMatching(/^Open in /),
      expect.stringMatching(/^Show in /),
      'Copy Path',
      'Scan Again',
      expect.stringMatching(/^Move to /),
    ]);
    expect(library?.actions[0]).toMatchObject({
      type: 'open-command',
      ref: { extension: 'disk-usage', command: 'usage' },
      argument: process.platform === 'win32' ? '~\\Library\\' : '~/Library/',
    });
    const [scan] = view.sections[1]?.items ?? [];
    expect(scan?.title).toBe('Scanned just now');
    expect(scan?.subtitle).toMatch(/^7 files in \d+ folders · took /);
  });

  it('opens a folder, and filters it by what comes after the slash', async () => {
    const opened = await settled('usage', '', { argument: '~/Projects/' });
    expect(opened.sections[0]?.title).toMatch(/^~.Projects · 3\.\d MB$/);
    expect(titles(opened)).toEqual(['app', 'movie clip.mov']);
    expect(opened.sections[0]?.items[1]?.subtitle).toMatch(/^\d+% · QuickTime movie$/);
    expect(titles(await settled('usage', '~/Projects/MOV'))).toEqual(['movie clip.mov']);
    expect(titles(await settled('usage', 'down'))).toEqual(['Downloads']);
    expect((await settled('usage', 'zebra')).emptyText).toBe('Nothing in Home matches “zebra”.');
    expect((await settled('usage', '~/Nowhere/')).emptyText).toMatch(/^There's no folder at ~.Nowhere\.$/);
  });

  it("leaves cloud storage alone on macOS until it's opened", async () => {
    const mac = { platform: 'darwin' };
    await extension.commands.usage?.onAction?.('rescan', home, ctx('', mac));
    const library = await settled('usage', '~/Library/', mac);
    const cloud = library.sections[0]?.items.find((item) => item.title === 'CloudStorage');
    expect(cloud).toMatchObject({ subtitle: 'Cloud storage, not counted', accessory: '—', icon: { emoji: '☁️' } });
    expect(titles(await settled('usage', '~/Library/CloudStorage/', mac))).toEqual(['GoogleDrive']);
  });

  it('counts a folder again', async () => {
    await settled('usage', '~/Projects/');
    write('Projects/new.iso', 3 * MB);
    const result = await extension.commands.usage?.onAction?.('rescan', join(home, 'Projects'), ctx('~/Projects/'));
    expect(result?.replace).toBeDefined();
    expect(titles(await settled('usage', '~/Projects/'))).toEqual(['new.iso', 'app', 'movie clip.mov']);
    rmSync(join(home, 'Projects', 'new.iso'));
    await extension.commands.usage?.onAction?.('rescan', join(home, 'Projects'), ctx('~/Projects/'));
    expect(titles(await settled('usage', '~/Projects/'))).toEqual(['app', 'movie clip.mov']);
  });
});

describe('a folder typed outside your home folder', () => {
  it('is scanned when asked, not on the way to another', async () => {
    const outside = mkdtempSync(join(tmpdir(), 'disk-usage-outside-'));
    try {
      writeFileSync(join(outside, 'big.bin'), randomBytes(2 * MB));
      const typed = await extension.commands.usage?.view?.(ctx(`${outside}/`));
      expect(typed?.sections[0]?.items.map((item) => item.id)).toEqual(['scan-here']);
      expect(typed?.sections[0]?.items[0]?.title).toMatch(/^Scan .*disk-usage-outside-/);
      const result = await extension.commands.usage?.onAction?.('scan', outside, ctx(`${outside}/`));
      expect(result?.replace).toBeDefined();
      expect(titles(await settled('usage', `${outside}/`))).toEqual(['big.bin']);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});

describe('Largest Files', () => {
  it('lists the biggest files anywhere, saying where they are', async () => {
    const view = await settled('largest-files', '');
    expect(view.sections[0]?.title).toBe('Largest files in Home');
    expect(titles(view)?.slice(0, 3)).toEqual(['cache.db', 'photos.zip', 'lib.node']);
    const zip = view.sections[0]?.items[1];
    expect(zip?.subtitle).toBe(process.platform === 'win32' ? '~\\Downloads' : '~/Downloads');
    expect(zip?.actions.map((action) => action.title)).toContain('Show Folder in Disk Usage');
    expect(zip?.detail?.metadata).toContainEqual({ label: 'Kind', value: 'ZIP archive' });
  });

  it('filters by name, kind or folder', async () => {
    expect(titles(await settled('largest-files', 'zip'))).toEqual(['photos.zip']);
    expect(titles(await settled('largest-files', 'video'))).toContain('movie clip.mov');
    expect(titles(await settled('largest-files', 'node_modules'))).toEqual(['lib.node']);
    expect(titles(await settled('largest-files', '~/Downloads/'))).toEqual(['photos.zip', 'SteamSetup.exe']);
  });
});

describe('Archives and Installers', () => {
  it('lists archives, disk images and installers, and the ones unpacked already', async () => {
    const view = await settled('archives', '');
    expect(titles(view)).toEqual(['photos.zip', 'SteamSetup.exe']);
    expect(view.sections[0]?.items[0]?.subtitle).toMatch(/Downloads · unpacked beside it$/);
    expect(view.sections[0]?.items[0]?.detail?.body).toBe(
      "There's a folder called “photos” next to it, so it may have been unpacked already.",
    );
  });
});

describe.runIf(process.platform === 'linux' && existsSync('/usr/bin/gio'))('moving to the Trash', () => {
  it('takes it out of the list and the sizes, and says how to free the space', async () => {
    const before = await settled('usage', '~/Downloads/');
    const path = join(home, 'Downloads', 'photos.zip');
    const result = await extension.commands.usage?.onAction?.(
      'trash',
      path,
      ctx('~/Downloads/', { platform: 'linux' }),
    );
    if (result?.toastStyle === 'failure') {
      // gio needs a session bus on some systems; then it says so rather than failing silently.
      console.log('trash:', result.toast);
      return;
    }
    expect(result?.toast).toMatch(/^Moved “photos.zip” to the Trash. Empty it to free 5\.\d MB$/);
    expect(existsSync(path)).toBe(false);
    expect(result?.replace?.sections[0]?.items.map((item) => item.title)).not.toContain('photos.zip');
    expect(result?.replace?.sections[0]?.title).not.toBe(before.sections[0]?.title);
  });
});
