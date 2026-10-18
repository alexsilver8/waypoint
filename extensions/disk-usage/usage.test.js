import { describe, expect, it } from 'vitest';
import {
  categoryOf,
  displayPath,
  explainTrash,
  formatBytes,
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

const mac = { home: '/Users/ana', platform: 'darwin' };
const windows = { home: 'C:\\Users\\ana', platform: 'win32' };

describe('parseQuery', () => {
  it('filters by the words typed', () => {
    expect(parseQuery('  Node   Modules ', mac)).toEqual({ trailing: false, words: ['node', 'modules'] });
    expect(parseQuery('', mac)).toEqual({ trailing: false, words: [] });
    expect(parseQuery('“Café”', mac).words).toEqual(['cafe']);
  });

  it('reads a folder from ~ or the top of the disk', () => {
    expect(parseQuery('~', mac)).toEqual({ path: '/Users/ana', trailing: false, words: [] });
    expect(parseQuery('~/Library/', mac)).toEqual({ path: '/Users/ana/Library', trailing: true, words: [] });
    expect(parseQuery('~/Library/Application Support', mac).path).toBe('/Users/ana/Library/Application Support');
    expect(parseQuery('/Volumes/Backup//', mac)).toEqual({ path: '/Volumes/Backup', trailing: true, words: [] });
    expect(parseQuery('/', mac)).toEqual({ path: '/', trailing: true, words: [] });
    expect(parseQuery('~/Projects/../Music', mac).path).toBe('/Users/ana/Music');
  });

  it("doesn't take a word that starts with ~ for a folder", () => {
    expect(parseQuery('~backup', mac)).toEqual({ trailing: false, words: ['~backup'] });
  });

  it('reads Windows folders with either slash', () => {
    expect(parseQuery('~\\Downloads\\', windows)).toEqual({
      path: 'C:\\Users\\ana\\Downloads',
      trailing: true,
      words: [],
    });
    expect(parseQuery('~/Downloads', windows).path).toBe('C:\\Users\\ana\\Downloads');
    expect(parseQuery('D:\\', windows)).toEqual({ path: 'D:\\', trailing: true, words: [] });
    expect(parseQuery('d:/Games/Steam', windows).path).toBe('d:\\Games\\Steam');
    expect(parseQuery('\\\\nas\\share\\films', windows).path).toBe('\\\\nas\\share\\films');
    expect(parseQuery('/etc', windows).words).toEqual(['/etc']);
  });
});

describe('paths as they are shown', () => {
  it('writes your home folder as ~', () => {
    expect(displayPath('/Users/ana', mac.home, 'darwin')).toBe('~');
    expect(displayPath('/Users/ana/Library/Caches', mac.home, 'darwin')).toBe('~/Library/Caches');
    expect(displayPath('/Users/anabel', mac.home, 'darwin')).toBe('/Users/anabel');
    expect(displayPath('C:\\Users\\ana\\Videos', windows.home, 'win32')).toBe('~\\Videos');
    expect(displayPath('c:\\users\\ANA\\Videos', windows.home, 'win32')).toBe('~\\Videos');
    expect(displayPath('/users/ana/Movies', mac.home, 'darwin')).toBe('/users/ana/Movies');
  });

  it('says which folder something is in', () => {
    expect(whereIs('/Users/ana/Downloads/photos.zip', mac.home, 'darwin')).toBe('~/Downloads');
    expect(whereIs('/Users/ana/notes.txt', mac.home, 'darwin')).toBe('~');
    expect(whereIs('/Volumes/Backup/disk.img', mac.home, 'darwin')).toBe('/Volumes/Backup');
  });

  it('types a folder with a slash at the end, so what comes next filters it', () => {
    expect(queryFor('/Users/ana/Library', mac.home, 'darwin')).toBe('~/Library/');
    expect(queryFor('/Users/ana', mac.home, 'darwin')).toBe('~/');
    expect(queryFor('/', mac.home, 'darwin')).toBe('/');
    expect(queryFor('C:\\Users\\ana\\AppData', windows.home, 'win32')).toBe('~\\AppData\\');
    expect(queryFor('D:\\', windows.home, 'win32')).toBe('D:\\');
  });

  it('reads back what it types', () => {
    const typed = queryFor('/Users/ana/Library/Application Support', mac.home, 'darwin');
    expect(parseQuery(typed, mac).path).toBe('/Users/ana/Library/Application Support');
  });
});

describe('numbers', () => {
  it('writes sizes as Finder does', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(999)).toBe('999 B');
    expect(formatBytes(1_500_000)).toBe('1.5 MB');
    expect(formatBytes(245_300_000_000)).toBe('245 GB');
    expect(formatBytes(-5)).toBe('0 B');
  });

  it('writes shares, with a sliver as <1%', () => {
    expect(formatShare(35, 100)).toBe('35%');
    expect(formatShare(1, 1000)).toBe('<1%');
    expect(formatShare(0, 1000)).toBe('0%');
    expect(formatShare(5, 0)).toBe('0%');
    expect(formatShare(120, 100)).toBe('100%');
  });

  it('counts', () => {
    expect(plural(1, 'file')).toBe('1 file');
    expect(plural(1234567, 'file')).toBe('1,234,567 files');
  });

  it('says how long a scan took', () => {
    expect(formatElapsed(400)).toBe('under a second');
    expect(formatElapsed(4200)).toBe('4.2s');
    expect(formatElapsed(12_400)).toBe('12s');
    expect(formatElapsed(125_000)).toBe('2m 05s');
    expect(formatElapsed(3_780_000)).toBe('1h 03m');
  });

  it('says how long ago', () => {
    const now = Date.UTC(2026, 9, 18, 12);
    expect(timeAgo(now - 10_000, now)).toBe('just now');
    expect(timeAgo(now - 5 * 60_000, now)).toBe('5 min ago');
    expect(timeAgo(now - 3 * 3_600_000, now)).toBe('3 hours ago');
    expect(timeAgo(now - 36 * 3_600_000, now)).toBe('yesterday');
  });
});

describe('kinds of files', () => {
  it('names them', () => {
    expect(kindOf('photos.zip', false)).toBe('ZIP archive');
    expect(kindOf('backup.tar.gz', false)).toBe('Tar archive');
    expect(kindOf('Sonoma.dmg', false)).toBe('Disk image');
    expect(kindOf('llama-3-8b.Q4_K_M.gguf', false)).toBe('GGUF model');
    expect(kindOf('trip.MOV', false)).toBe('QuickTime movie');
    expect(kindOf('data.parquet', false)).toBe('PARQUET file');
    expect(kindOf('Makefile', false)).toBe('File');
    expect(kindOf('Docker.raw', false)).toBe("Docker's virtual disk");
    expect(kindOf('Projects', true)).toBe('Folder');
    expect(kindOf('Xcode.app', true)).toBe('Application');
    expect(kindOf('Photos Library.photoslibrary', true)).toBe('Photos library');
  });

  it('groups them, for filtering', () => {
    expect(categoryOf('a.7z')).toBe('archive');
    expect(categoryOf('ubuntu.iso')).toBe('disk image');
    expect(categoryOf('Docker.pkg')).toBe('installer');
    expect(categoryOf('clip.mkv')).toBe('video');
    expect(categoryOf('notes.md')).toBeUndefined();
    // Docker keeps its images in it: not something to throw away with the installers.
    expect(categoryOf('Docker.raw')).toBeUndefined();
  });

  it('tells leftovers from programs in use', () => {
    expect(isLeftover('photos.zip', { inDownloads: false })).toBe(true);
    expect(isLeftover('Figma.dmg', { inDownloads: false })).toBe(true);
    expect(isLeftover('code_1.95_amd64.deb', { inDownloads: false })).toBe(true);
    expect(isLeftover('Code.exe', { inDownloads: false })).toBe(false);
    expect(isLeftover('Code.exe', { inDownloads: true })).toBe(true);
    expect(isLeftover('SteamSetup.exe', { inDownloads: false })).toBe(true);
    expect(isLeftover('movie.mp4', { inDownloads: true })).toBe(false);
  });

  it('knows the folder an archive unpacks into', () => {
    expect(unpackedName('photos.zip')).toBe('photos');
    expect(unpackedName('node-v24.tar.xz')).toBe('node-v24');
    expect(unpackedName('Sonoma.dmg')).toBeUndefined();
    expect(unpackedName('notes.txt')).toBeUndefined();
  });

  it('matches every word typed, ignoring case and accents', () => {
    expect(matches(wordsOf('ZIP down'), 'photos.zip ZIP archive ~/Downloads')).toBe(true);
    expect(matches(wordsOf('cafe'), 'Café menu.pdf')).toBe(true);
    expect(matches(wordsOf('video zip'), 'photos.zip ZIP archive')).toBe(false);
    expect(matches([], 'anything')).toBe(true);
  });
});

describe('moving to the Trash', () => {
  it('asks Finder on macOS, so Put Back works', () => {
    const command = trashCommand('darwin', '/Users/ana/big.zip', {});
    expect(command?.file).toBe('osascript');
    expect(command?.args.at(-1)).toBe('/Users/ana/big.zip');
  });

  it('hands Windows the path through the environment', () => {
    const command = trashCommand('win32', 'C:\\Users\\ana\\a, b.zip', {});
    expect(command?.file).toBe('powershell.exe');
    expect(command?.env).toEqual({ WAYPOINT_FILE: 'C:\\Users\\ana\\a, b.zip' });
  });

  it("has Windows ask before deleting for good what the Recycle Bin can't take", () => {
    const command = trashCommand('win32', 'C:\\Users\\ana\\disk.vhdx', {});
    const script = Buffer.from(command?.args.at(-1) ?? '', 'base64').toString('utf16le');
    expect(script).toContain('SHFileOperation');
    // FOF_ALLOWUNDO, FOF_SILENT, FOF_NOCONFIRMATION, FOF_NOERRORUI and FOF_WANTNUKEWARNING.
    expect(script).toContain('$operation.Flags = 0x4454');
  });

  it('uses what Linux has, or says it has nothing', () => {
    expect(trashCommand('linux', '/home/ana/a.zip', { gio: '/usr/bin/gio' })).toEqual({
      file: '/usr/bin/gio',
      args: ['trash', '--', '/home/ana/a.zip'],
    });
    expect(trashCommand('linux', '/home/ana/a.zip', {})).toBeUndefined();
  });

  it('says how to let Waypoint control Finder', () => {
    expect(explainTrash(new Error('Not authorized to send Apple events to Finder. (-1743)'), 'darwin')).toMatch(
      /Automation/,
    );
  });
});
