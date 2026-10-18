// The command against browser folders made up for the test, in a home folder of its own.
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

const home = mkdtempSync(join(tmpdir(), 'bookmarks-home-'));
/** @type {import('@waypoint/api').Extension} */
let extension;

/** @param {string} path @param {unknown} json */
function writeJson(path, json) {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, JSON.stringify(json));
}

/** @param {string} name @param {string} url */
const bar = (name, url) => ({
  roots: { bookmark_bar: { name: 'Bookmarks bar', children: [{ type: 'url', name, url }] } },
});

beforeAll(async () => {
  // os.homedir() reads HOME, or USERPROFILE on Windows.
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  const chrome = join(home, '.config', 'google-chrome');
  writeJson(join(chrome, 'Local State'), {
    profile: { info_cache: { Default: { name: 'Alex' }, 'Profile 1': { name: 'Work' } } },
  });
  writeJson(join(chrome, 'Default', 'Bookmarks'), bar('Waypoint', 'https://waypoint.alexsilver.dev/'));
  writeJson(join(chrome, 'Profile 1', 'Bookmarks'), bar('Team wiki', 'https://wiki.example.com'));
  writeJson(join(chrome, 'Profile 1', 'AccountBookmarks'), bar('Calendar', 'https://calendar.example.com'));
  // No Local State: the profile folder is found by its name.
  writeJson(
    join(home, '.config', 'BraveSoftware', 'Brave-Browser', 'Default', 'Bookmarks'),
    bar('Wiki again', 'https://wiki.example.com/'),
  );
  extension = (await import('./index.js')).default;
});

/** @param {string} query */
async function search(query) {
  const view = await extension.commands.search?.view?.(/** @type {any} */ ({ query, platform: 'linux' }));
  return view?.sections.flatMap((section) => section.items) ?? [];
}

describe('Search Bookmarks', () => {
  it('finds the bookmarks in every profile and browser, once each', async () => {
    const items = await search('');
    expect(items.map((item) => item.title).sort()).toEqual(['Calendar', 'Team wiki', 'Waypoint']);
    const wiki = items.find((item) => item.title === 'Team wiki');
    expect(wiki?.accessory).toBe('Chrome · Work');
    expect(wiki?.detail?.metadata).toContainEqual({ label: 'Also in', value: 'Brave' });
  });

  it('opens a bookmark in the profile it came from', async () => {
    const [item] = await search('waypoint');
    expect(item?.actions[0]).toEqual({
      type: 'callback',
      id: 'open',
      title: 'Open in Chrome',
      payload: { url: 'https://waypoint.alexsilver.dev/', browser: 'chrome', profile: 'Default' },
    });
    expect(item?.actions[1]).toEqual({
      type: 'open-url',
      url: 'https://waypoint.alexsilver.dev/',
      title: 'Open in Default Browser',
    });
  });

  it('says so when nothing matches', async () => {
    const view = await extension.commands.search?.view?.(/** @type {any} */ ({ query: 'zebra', platform: 'linux' }));
    expect(view?.sections).toEqual([]);
    expect(view?.emptyText).toBe('No bookmark matches “zebra”.');
  });
});
