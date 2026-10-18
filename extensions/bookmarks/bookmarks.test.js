import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BROWSERS,
  chromeTime,
  dedupe,
  hostOf,
  matchBookmarks,
  parseBookmarks,
  profileNames,
  sameUrl,
  userDataDirs,
  when,
} from './bookmarks.js';

const chrome = /** @type {import('./bookmarks.js').Browser} */ (BROWSERS.find((browser) => browser.id === 'chrome'));

/** Chromium's microseconds since 1601 for a date. @param {number} ms */
const micros = (ms) => String((ms + 11_644_473_600_000) * 1000);

describe('userDataDirs', () => {
  it('finds each system’s place for browser data', () => {
    expect(userDataDirs(chrome, 'darwin', { home: '/Users/alex' })).toEqual([
      join('/Users/alex', 'Library', 'Application Support', 'Google/Chrome'),
    ]);
    expect(userDataDirs(chrome, 'linux', { home: '/home/alex' })).toEqual([
      join('/home/alex', '.config', 'google-chrome'),
      join('/home/alex', '.var/app/com.google.Chrome/config/google-chrome'),
    ]);
    expect(
      userDataDirs(chrome, 'win32', { home: 'C:\\Users\\alex', localAppData: 'C:\\Users\\alex\\AppData\\Local' }),
    ).toEqual([join('C:\\Users\\alex\\AppData\\Local', 'Google\\Chrome\\User Data')]);
    expect(userDataDirs(chrome, 'freebsd', { home: '/home/alex' })).toEqual([]);
  });
});

describe('profileNames', () => {
  it('reads the profiles Local State lists', () => {
    const localState = {
      profile: { info_cache: { Default: { name: 'Alex' }, 'Profile 1': { name: 'Work' }, 'Profile 2': {} } },
    };
    expect(profileNames(localState)).toEqual({ Default: 'Alex', 'Profile 1': 'Work', 'Profile 2': 'Profile 2' });
    expect(profileNames({})).toEqual({});
    expect(profileNames(null)).toEqual({});
  });
});

describe('chromeTime', () => {
  it('turns microseconds since 1601 into milliseconds since 1970', () => {
    expect(chromeTime(micros(Date.UTC(2026, 0, 1)))).toBe(Date.UTC(2026, 0, 1));
    expect(chromeTime('0')).toBeUndefined();
    expect(chromeTime('soon')).toBeUndefined();
    expect(chromeTime(undefined)).toBeUndefined();
  });
});

describe('parseBookmarks', () => {
  const json = {
    roots: {
      bookmark_bar: {
        name: 'Bookmarks bar',
        type: 'folder',
        children: [
          {
            type: 'url',
            name: 'GitHub',
            url: 'https://github.com/',
            date_added: micros(1000),
            date_last_used: micros(5000),
          },
          {
            type: 'folder',
            name: 'Dev',
            children: [
              { type: 'url', name: 'MDN', url: 'https://developer.mozilla.org/en-US/', date_added: micros(2000) },
              { type: 'url', name: 'Pin it', url: 'javascript:alert(1)' },
              { type: 'folder', name: 'Empty', children: [] },
            ],
          },
        ],
      },
      other: {
        name: 'Other bookmarks',
        type: 'folder',
        children: [{ type: 'url', name: '', url: 'http://localhost:3000' }],
      },
      synced: {
        name: 'Mobile bookmarks',
        type: 'folder',
        children: [{ type: 'url', name: 'Settings', url: 'chrome://settings' }],
      },
    },
    version: 1,
  };

  it('reads every web bookmark with its folder', () => {
    expect(parseBookmarks(json)).toEqual([
      { title: 'GitHub', url: 'https://github.com/', folder: 'Bookmarks bar', added: 1000, used: 5000 },
      { title: 'MDN', url: 'https://developer.mozilla.org/en-US/', folder: 'Bookmarks bar › Dev', added: 2000 },
      { title: 'http://localhost:3000', url: 'http://localhost:3000', folder: 'Other bookmarks' },
    ]);
  });

  it('copes with a file it doesn’t understand', () => {
    expect(parseBookmarks(null)).toEqual([]);
    expect(parseBookmarks({ roots: 'nope' })).toEqual([]);
    expect(parseBookmarks({ roots: { bar: { children: [{ type: 'url' }] } } })).toEqual([]);
  });
});

describe('hostOf and sameUrl', () => {
  it('shows the host without www', () => {
    expect(hostOf('https://www.example.com/a?b')).toBe('example.com');
    expect(hostOf('http://localhost:3000/')).toBe('localhost:3000');
    expect(hostOf('not a url')).toBe('not a url');
  });

  it('treats a trailing slash, # or the host’s case as the same page', () => {
    expect(sameUrl('https://GitHub.com/')).toBe(sameUrl('https://github.com'));
    expect(sameUrl('https://example.com/a#')).toBe(sameUrl('https://example.com/a'));
  });

  it('keeps the rest of the address in its case', () => {
    expect(sameUrl('https://youtu.be/dQw4w9WgXcQ')).not.toBe(sameUrl('https://youtu.be/dqw4w9wgxcq'));
  });
});

describe('dedupe', () => {
  it('keeps the one opened last, and where else it is', () => {
    const list = [
      { title: 'GitHub', url: 'https://github.com/', folder: 'Bar', used: 10, source: 'Chrome' },
      { title: 'GitHub', url: 'https://github.com', folder: 'Bar', used: 20, source: 'Brave' },
      { title: 'MDN', url: 'https://developer.mozilla.org', folder: 'Bar', source: 'Chrome' },
    ];
    expect(dedupe(list)).toEqual([
      { title: 'GitHub', url: 'https://github.com', folder: 'Bar', used: 20, source: 'Brave', alsoIn: ['Chrome'] },
      { title: 'MDN', url: 'https://developer.mozilla.org', folder: 'Bar', source: 'Chrome', alsoIn: [] },
    ]);
  });
});

describe('matchBookmarks', () => {
  const list = [
    { title: 'Vercel dashboard', url: 'https://vercel.com/dashboard', folder: 'Bar › Work', used: 30 },
    { title: 'GitHub', url: 'https://github.com', folder: 'Bar', used: 10 },
    { title: 'Pull requests', url: 'https://github.com/pulls', folder: 'Bar › Work', used: 20 },
    { title: 'Docs', url: 'https://example.com/docs', folder: 'Bar' },
  ];

  it('lists everything, most recently opened first, when nothing is typed', () => {
    expect(matchBookmarks(list, ' ').map((bookmark) => bookmark.title)).toEqual([
      'Vercel dashboard',
      'Pull requests',
      'GitHub',
      'Docs',
    ]);
  });

  it('matches every word in the title, address or folder, best titles first', () => {
    expect(matchBookmarks(list, 'github').map((bookmark) => bookmark.title)).toEqual(['GitHub', 'Pull requests']);
    expect(matchBookmarks(list, 'work pull').map((bookmark) => bookmark.title)).toEqual(['Pull requests']);
    expect(matchBookmarks(list, 'dash vercel').map((bookmark) => bookmark.title)).toEqual(['Vercel dashboard']);
    expect(matchBookmarks(list, 'nothing like it')).toEqual([]);
  });
});

describe('when', () => {
  const now = Date.UTC(2026, 9, 18, 12);

  it('says how long ago', () => {
    expect(when(now - 1000, now)).toBe('today');
    expect(when(now - 86_400_000, now)).toBe('yesterday');
    expect(when(now - 3 * 86_400_000, now)).toBe('3 days ago');
    expect(when(Date.UTC(2024, 2, 5), now)).toMatch(/2024/);
  });
});
