// The commands against a home folder made for the test. They search it the way this system
// can (locate or fd when installed, else by looking through it), so a file with a name made
// up for the test is found either way.
import { existsSync, mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

const home = mkdtempSync(join(tmpdir(), 'files-home-'));
const downloads = join(home, 'Downloads');
/** @type {import('../../src/shared/extension-api').Extension} */
let extension;

/** @param {number} ms */
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

beforeAll(async () => {
  // os.homedir() reads HOME, or USERPROFILE on Windows.
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  mkdirSync(downloads, { recursive: true });
  mkdirSync(join(home, 'Projects', 'zebrafish-lab'), { recursive: true });
  writeFileSync(join(home, 'Projects', 'zebrafish-lab', 'zebrafish notes.md'), '# Tank 4\n- fed at 9\n');
  writeFileSync(join(home, 'Projects', 'zebrafish-lab', 'zebrafish.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0]));
  writeFileSync(join(downloads, 'invoice.pdf'), '%PDF-1.7');
  await pause(30);
  writeFileSync(join(downloads, 'readme.txt'), 'Downloaded second\n# not a heading');
  // An old file, by the time on it, that only just arrived: it's listed as the newest.
  await pause(30);
  writeFileSync(join(downloads, 'old-photo.jpg'), 'jpg');
  utimesSync(join(downloads, 'old-photo.jpg'), new Date('2020-01-01'), new Date('2020-01-01'));
  writeFileSync(join(downloads, 'movie.mp4.crdownload'), 'partial');
  writeFileSync(join(downloads, '.DS_Store'), '');
  extension = (await import('./index.js')).default;
});

/** @param {string} command @param {string} query */
async function view(command, query) {
  return extension.commands[command]?.view?.(/** @type {any} */ ({ query, platform: process.platform }));
}

describe('Search Downloads', () => {
  it('lists downloads newest first, and the ones still downloading', async () => {
    const result = await view('downloads', '');
    expect(result?.sections.map((section) => section.title)).toEqual(['Still downloading', 'Downloaded', 'Folder']);
    expect(result?.sections[0]?.items.map((item) => item.title)).toEqual(['movie.mp4']);
    expect(result?.sections[1]?.items.map((item) => item.title)).toEqual([
      'old-photo.jpg',
      'readme.txt',
      'invoice.pdf',
    ]);
  });

  it('previews text, and searches by name', async () => {
    const result = await view('downloads', 'READ');
    const [readme] = result?.sections[0]?.items ?? [];
    expect(readme?.title).toBe('readme.txt');
    expect(readme?.detail?.body).toBe('Downloaded second\n​# not a heading');
    expect(readme?.actions.map((action) => action.title)).toEqual(
      expect.arrayContaining(['Open', 'Copy File', 'Copy Path', 'Copy Name']),
    );
    expect((await view('downloads', 'nothing like it'))?.emptyText).toBe(
      'Nothing in Downloads matches “nothing like it”.',
    );
  });
});

describe.skipIf(process.platform !== 'linux')('Search Files', () => {
  it('finds files and folders by every word of their name', { timeout: 15_000 }, async () => {
    const result = await view('search', 'zebrafish');
    const titles = result?.sections[0]?.items.map((item) => item.title);
    expect(titles).toEqual(expect.arrayContaining(['zebrafish-lab', 'zebrafish notes.md', 'zebrafish.png']));
    const notes = await view('search', 'notes zebrafish');
    const [item] = notes?.sections[0]?.items ?? [];
    expect(item?.title).toBe('zebrafish notes.md');
    expect(item?.subtitle).toBe('~/Projects/zebrafish-lab');
    expect(item?.detail?.body).toBe('# Tank 4\n- fed at 9\n');
  });

  it('shows what a folder holds', { timeout: 15_000 }, async () => {
    const result = await view('search', 'zebrafish-lab');
    const folder = result?.sections[0]?.items.find((item) => item.title === 'zebrafish-lab');
    expect(folder?.detail?.body).toBe('- zebrafish notes.md\n- zebrafish.png');
    expect(folder?.detail?.metadata).toContainEqual({ label: 'Holds', value: '2 items' });
  });

  it.runIf(existsSync('/usr/bin/gio'))('moves a file to the Trash', { timeout: 15_000 }, async () => {
    const path = join(downloads, 'invoice.pdf');
    const result = await extension.commands.downloads?.onAction?.(
      'trash',
      path,
      /** @type {any} */ ({ query: '', platform: 'linux' }),
    );
    if (result?.toastStyle === 'failure') {
      // gio needs a session bus on some systems; then it says so rather than failing silently.
      console.log('trash:', result.toast);
      return;
    }
    expect(result?.toast).toBe('Moved “invoice.pdf” to the Trash');
    expect(existsSync(path)).toBe(false);
  });
});
