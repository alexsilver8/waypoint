import { describe, expect, it } from 'vitest';
import {
  copyFileCommand,
  everythingWord,
  fold,
  formatBytes,
  isPartialDownload,
  isTextName,
  kindOf,
  likePattern,
  linuxDownloads,
  looksLikeText,
  openCommand,
  parseLastUsedLine,
  parseRecentlyUsed,
  previewOf,
  rankPaths,
  searchPlan,
  spotlightQuery,
  timeAgo,
  trashCommand,
  WINDOWS_SEARCH_SCRIPT,
  whereIs,
  windowsSearchSql,
  wordsOf,
  xmlText,
} from './files.js';

describe('wordsOf and fold', () => {
  it('splits the query into words, without quotes', () => {
    expect(wordsOf(' "Tax Return" 2025 ')).toEqual(['tax', 'return', '2025']);
  });

  it('compares without case or accents', () => {
    expect(fold('Café Menü')).toBe('cafe menu');
  });
});

describe('searchPlan', () => {
  const options = { home: '/home/alex', limit: 500, programs: {} };

  it('asks Spotlight on macOS for every word, in your folders first', () => {
    const query = 'kMDItemFSName == "*q3*"cd && kMDItemFSName == "*report*"cd';
    expect(searchPlan('darwin', ['q3', 'report'], options)).toEqual([
      {
        id: 'spotlight',
        file: '/usr/bin/mdfind',
        args: ['-onlyin', '/home/alex', query],
        widerArgs: [query],
        trustEmpty: true,
      },
    ]);
  });

  it('escapes what a Spotlight query treats specially', () => {
    expect(spotlightQuery(['a*b', 'say "hi"\\'])).toBe(
      'kMDItemFSName == "*a\\*b*"cd && kMDItemFSName == "*say \\"hi\\"\\\\*"cd',
    );
  });

  it('asks Everything first on Windows when its tool is installed, then Windows Search', () => {
    const plan = searchPlan('win32', ['tax', 'a|b'], { ...options, programs: { 'es.exe': 'C:\\Everything\\es.exe' } });
    expect(plan.map((backend) => backend.id)).toEqual(['everything', 'windows-search']);
    // Without what es or Everything would read as more than text; the ranking checks names.
    expect(plan[0]?.args).toEqual(['-n', '500', 'tax', 'ab']);
    expect(plan[0]?.exportArg).toBe('-export-txt');
    expect(plan[1]?.env?.WAYPOINT_SQL).toContain("System.FileName LIKE '%tax%' AND System.FileName LIKE '%a|b%'");
    expect(searchPlan('win32', ['tax'], options).map((backend) => backend.id)).toEqual(['windows-search']);
    const nothingLeft = searchPlan('win32', ['--'], { ...options, programs: { 'es.exe': 'C:\\es.exe' } });
    expect(nothingLeft.map((backend) => backend.id)).toEqual(['windows-search']);
  });

  it('tries locate, then fd, on Linux', () => {
    const plan = searchPlan('linux', ['notes'], {
      ...options,
      programs: { plocate: '/usr/bin/plocate', fdfind: '/usr/bin/fdfind' },
    });
    expect(plan.map((backend) => [backend.id, backend.file, backend.trustEmpty ?? false])).toEqual([
      ['locate', '/usr/bin/plocate', false],
      ['fd', '/usr/bin/fdfind', true],
    ]);
    expect(plan[0]?.args).toEqual(['-i', '-b', '-A', '-l', '500', '--', 'notes']);
    expect(plan[1]?.args.slice(-3)).toEqual(['--', 'notes', '/home/alex']);
    const both = searchPlan('linux', ['tax', '-2025'], { ...options, programs: { fd: '/usr/bin/fd' } });
    expect(both[0]?.args.slice(-4)).toEqual(['--and=-2025', '--', 'tax', '/home/alex']);
    // Then, for an fd without --and, the longest word alone, reading more for the ranking.
    expect(both[1]?.args.slice(-5)).toEqual(['--max-results', '4000', '--', '-2025', '/home/alex']);
    expect(both[1]?.args).not.toContain('--and=tax');
    expect(both[1]?.limit).toBe(4000);
    expect(searchPlan('linux', ['notes'], options)).toEqual([]);
  });
});

describe('windowsSearchScript', () => {
  it('escapes what SQL and LIKE patterns treat specially', () => {
    expect(likePattern("it's 100%_[x]")).toBe("it''s 100[%][_][[]x]");
    const sql = windowsSearchSql(['budget', "o'brien"], 300);
    expect(sql).toContain("SELECT TOP 300 System.ItemPathDisplay FROM SYSTEMINDEX WHERE SCOPE='file:'");
    expect(sql).toContain("System.FileName LIKE '%budget%' AND System.FileName LIKE '%o''brien%'");
  });

  it('reads the query from the environment, so nothing typed is run as PowerShell', () => {
    expect(WINDOWS_SEARCH_SCRIPT).toContain('$records.Open($env:WAYPOINT_SQL, $connection)');
    const plan = searchPlan('win32', ['$(calc)'], { home: 'C:\\Users\\alex', limit: 10, programs: {} });
    expect(Buffer.from(plan[0]?.args.at(-1) ?? '', 'base64').toString('utf16le')).not.toContain('calc');
  });

  it('leaves out what Everything reads as operators, and es as options', () => {
    expect(everythingWord('plain')).toBe('plain');
    expect(everythingWord('ext:pdf')).toBe('extpdf');
    expect(everythingWord('-draft')).toBe('draft');
    expect(everythingWord('/x')).toBe('x');
    expect(everythingWord('!-x')).toBe('x');
    expect(everythingWord('say"')).toBe('say');
    expect(everythingWord('--')).toBe('');
    expect(everythingWord('re-draft!')).toBe('re-draft');
  });
});

describe('rankPaths', () => {
  const home = '/Users/alex';

  it('keeps names holding every word, best matches and your own folders first', () => {
    const paths = [
      '/Users/alex/Library/Caches/report.txt',
      '/Users/alex/Documents/Old/annual report draft.docx',
      '/Users/alex/Documents/report.pdf',
      '/System/Library/report.plist',
      '/Users/alex/Desktop/report 2025.pdf',
      '/Users/alex/Documents/report.pdf',
      '/Users/alex/Documents/notes.txt',
    ];
    expect(rankPaths(paths, ['report'], home)).toEqual([
      '/Users/alex/Documents/report.pdf',
      '/Users/alex/Desktop/report 2025.pdf',
      '/Users/alex/Documents/Old/annual report draft.docx',
      '/Users/alex/Library/Caches/report.txt',
      '/System/Library/report.plist',
    ]);
  });

  it('matches every word, in any order, ignoring accents', () => {
    const paths = ['/Users/alex/Café menu.pdf', '/Users/alex/menu.pdf'];
    expect(rankPaths(paths, ['menu', 'cafe'], home)).toEqual(['/Users/alex/Café menu.pdf']);
  });
});

describe('downloads', () => {
  it('spots files still downloading', () => {
    expect(isPartialDownload('movie.mp4.crdownload')).toBe(true);
    expect(isPartialDownload('archive.zip.part')).toBe(true);
    expect(isPartialDownload('installer.dmg.download')).toBe(true);
    expect(isPartialDownload('.com.google.Chrome.x1y2z3')).toBe(true);
    expect(isPartialDownload('report.pdf')).toBe(false);
  });

  it('finds the Downloads folder in user-dirs.dirs', () => {
    expect(linuxDownloads('XDG_DOWNLOAD_DIR="$HOME/Téléchargements"\n', '/home/alex')).toBe(
      '/home/alex/Téléchargements',
    );
    expect(linuxDownloads('XDG_DOWNLOAD_DIR="/data/dl"', '/home/alex')).toBe('/data/dl');
    expect(linuxDownloads(undefined, '/home/alex')).toBe('/home/alex/Downloads');
  });
});

describe('recent files', () => {
  it('reads GTK’s recently used list, latest first', () => {
    const xml = `<?xml version="1.0"?>
<xbel version="1.0">
  <bookmark href="file:///home/alex/notes%20old.txt" added="2026-01-01T10:00:00Z" modified="2026-01-02T10:00:00Z" visited="2026-01-03T10:00:00Z">
  </bookmark>
  <bookmark href="https://example.com" added="2026-02-01T10:00:00Z"></bookmark>
  <bookmark href="file:///home/alex/R&amp;D.pdf" added="2026-03-01T10:00:00Z" modified="2026-03-01T10:00:00Z" visited="2026-03-05T10:00:00Z"></bookmark>
  <bookmark href="file:///home/alex/Alex&#39;s%20CV.pdf" visited="2026-02-01T10:00:00Z"></bookmark>
</xbel>`;
    expect(parseRecentlyUsed(xml)).toEqual([
      { path: '/home/alex/R&D.pdf', at: Date.parse('2026-03-05T10:00:00Z') },
      { path: "/home/alex/Alex's CV.pdf", at: Date.parse('2026-02-01T10:00:00Z') },
      { path: '/home/alex/notes old.txt', at: Date.parse('2026-01-03T10:00:00Z') },
    ]);
    expect(xmlText('a &lt;b&gt; &#x27;c&#39; &amp;amp;')).toBe("a <b> 'c' &amp;");
  });

  it('reads Spotlight’s last-used dates', () => {
    expect(parseLastUsedLine('/Users/alex/Plan.key   kMDItemLastUsedDate = 2026-10-17 09:30:00 +0000')).toEqual({
      path: '/Users/alex/Plan.key',
      at: Date.parse('2026-10-17T09:30:00Z'),
    });
    expect(parseLastUsedLine('/Users/alex/Plan.key   kMDItemLastUsedDate = (null)')).toEqual({
      path: '/Users/alex/Plan.key',
    });
    expect(parseLastUsedLine('/Users/alex/Plan.key')).toEqual({ path: '/Users/alex/Plan.key' });
  });
});

describe('copying and moving to the Trash', () => {
  it('copies the file itself on each system', () => {
    expect(copyFileCommand('darwin', '/Users/alex/a b.pdf', { wayland: false, programs: {} })?.args.at(-1)).toBe(
      '/Users/alex/a b.pdf',
    );
    expect(copyFileCommand('win32', 'C:\\a.pdf', { wayland: false, programs: {} })?.env).toEqual({
      WAYPOINT_FILE: 'C:\\a.pdf',
    });
    expect(
      copyFileCommand('linux', '/home/alex/a b.pdf', { wayland: true, programs: { 'wl-copy': '/usr/bin/wl-copy' } }),
    ).toEqual({
      file: '/usr/bin/wl-copy',
      args: ['--type', 'text/uri-list'],
      input: 'file:///home/alex/a%20b.pdf\r\n',
    });
    expect(copyFileCommand('linux', '/a', { wayland: false, programs: {} })).toBeUndefined();
  });

  it('moves to the Trash through Finder, the Recycle Bin, or gio', () => {
    expect(trashCommand('darwin', '/Users/alex/x', {})?.args).toContain(
      'tell application "Finder" to delete (POSIX file (item 1 of argv) as alias)',
    );
    expect(trashCommand('win32', 'C:\\x', {})?.env).toEqual({ WAYPOINT_FILE: 'C:\\x' });
    expect(trashCommand('linux', '/home/alex/x', { gio: '/usr/bin/gio' })).toEqual({
      file: '/usr/bin/gio',
      args: ['trash', '--', '/home/alex/x'],
    });
    expect(trashCommand('linux', '/home/alex/x', {})).toBeUndefined();
  });

  it('opens files on Windows without Explorer, which splits paths at commas', () => {
    expect(openCommand('win32', 'C:\\a, b.pdf')).toMatchObject({
      file: 'powershell.exe',
      env: { WAYPOINT_FILE: 'C:\\a, b.pdf' },
    });
    expect(openCommand('darwin', '/a.pdf')).toEqual({ file: 'open', args: ['/a.pdf'] });
  });
});

describe('describing files', () => {
  it('names kinds of file', () => {
    expect(kindOf('Report.PDF', false)).toBe('PDF document');
    expect(kindOf('archive.tar.zst', false)).toBe('ZST file');
    expect(kindOf('Makefile', false)).toBe('File');
    expect(kindOf('Projects', true)).toBe('Folder');
    expect(kindOf('Safari.app', true)).toBe('Application');
  });

  it('knows text files by name', () => {
    expect(isTextName('index.ts')).toBe(true);
    expect(isTextName('Dockerfile')).toBe(true);
    expect(isTextName('.env.local')).toBe(true);
    expect(isTextName('photo.jpg')).toBe(false);
  });

  it('tells text from binary', () => {
    expect(looksLikeText(Buffer.from('hello\nwörld'))).toBe(true);
    // The first byte of ö, where the file's start was cut off.
    expect(looksLikeText(Buffer.from('wö').subarray(0, 2))).toBe(true);
    expect(looksLikeText(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]))).toBe(false);
  });

  it('previews code as written and Markdown as Markdown', () => {
    expect(previewOf('#!/bin/sh\n# comment\n- item', 'run.sh')).toBe('#!/bin/sh\n\u200b# comment\n\u200b- item');
    expect(previewOf('# Title\n- item', 'notes.md')).toBe('# Title\n- item');
    expect(previewOf('1\n2\n3', 'a.txt', 2)).toBe('1\n2');
  });

  it('formats sizes, times and places', () => {
    expect(formatBytes(980)).toBe('980 B');
    expect(formatBytes(1_400_000)).toBe('1.4 MB');
    expect(formatBytes(250_000_000)).toBe('250 MB');
    const now = Date.UTC(2026, 9, 18, 12);
    expect(timeAgo(now - 30_000, now)).toBe('just now');
    expect(timeAgo(now - 3 * 3_600_000, now)).toBe('3 hours ago');
    expect(timeAgo(now - 86_400_000, now)).toBe('yesterday');
    expect(whereIs('/Users/alex/Documents/a.pdf', '/Users/alex')).toBe('~/Documents');
    expect(whereIs('/Users/alex/a.pdf', '/Users/alex')).toBe('~');
    expect(whereIs('/tmp/a.pdf', '/Users/alex')).toBe('/tmp');
  });
});
