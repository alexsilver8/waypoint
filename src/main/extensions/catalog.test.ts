import { describe, expect, it, vi } from 'vitest';
import { ExtensionCatalog, parseSearch, webAddress } from './catalog';

const found = (name: string, extra: Record<string, unknown> = {}) => ({
  downloads: { monthly: 400, weekly: 100 },
  package: {
    name,
    version: '1.2.0',
    description: `The ${name} extension`,
    publisher: { username: 'alex', email: 'alex@example.com' },
    date: '2026-10-01T10:00:00.000Z',
    license: 'MIT',
    links: {
      npm: `https://www.npmjs.com/package/${name}`,
      repository: `git+https://github.com/alex/${name}.git`,
    },
    ...extra,
  },
});

describe('webAddress', () => {
  it('turns a git address into one for the browser', () => {
    expect(webAddress('git+https://github.com/alex/emoji.git')).toBe('https://github.com/alex/emoji');
    expect(webAddress('https://example.com/docs')).toBe('https://example.com/docs');
  });

  it('gives nothing for addresses that are not https', () => {
    expect(webAddress('git+ssh://git@github.com/alex/emoji.git')).toBeUndefined();
    expect(webAddress('http://example.com')).toBeUndefined();
    expect(webAddress('javascript:alert(1)')).toBeUndefined();
    expect(webAddress('not a url')).toBeUndefined();
    expect(webAddress(42)).toBeUndefined();
  });
});

describe('parseSearch', () => {
  it('reads what npm says about each package', () => {
    expect(parseSearch({ objects: [found('emoji-picker')] })).toEqual([
      {
        name: 'emoji-picker',
        version: '1.2.0',
        description: 'The emoji-picker extension',
        publisher: 'alex',
        date: '2026-10-01T10:00:00.000Z',
        weeklyDownloads: 100,
        license: 'MIT',
        npmUrl: 'https://www.npmjs.com/package/emoji-picker',
        homepage: 'https://github.com/alex/emoji-picker',
      },
    ]);
  });

  it('skips anything without a name or version, and the same package twice', () => {
    const entries = parseSearch({
      objects: [
        found('a'),
        found('a'),
        { package: { name: 'no-version' } },
        { package: { version: '1.0.0' } },
        'junk',
        null,
      ],
    });
    expect(entries.map((entry) => entry.name)).toEqual(['a']);
  });

  it('falls back to the npm page it would have, and leaves out what is missing', () => {
    const [entry] = parseSearch({ objects: [{ package: { name: '@you/tool', version: '0.1.0' } }] });
    expect(entry).toEqual({ name: '@you/tool', version: '0.1.0', npmUrl: 'https://www.npmjs.com/package/@you/tool' });
  });

  it('turns down a response that is not a search', () => {
    expect(() => parseSearch({ error: 'nope' })).toThrow(/unexpected/);
  });
});

describe('ExtensionCatalog', () => {
  const setUp = (respond: () => Response | Promise<Response> = () => Response.json({ objects: [found('x')] })) => {
    let now = 0;
    const fetch = vi.fn(async (_url: string, _init: { signal: AbortSignal }) => respond());
    const catalog = new ExtensionCatalog({ fetch, registry: 'https://registry.test/', now: () => now });
    return { catalog, fetch, later: (ms: number) => (now += ms) };
  };

  it('searches npm for packages with the keyword, most used first when nothing is typed', async () => {
    const { catalog, fetch } = setUp();
    await catalog.search('');
    const first = new URL(String(fetch.mock.calls[0]?.[0]));
    expect(first.origin + first.pathname).toBe('https://registry.test/-/v1/search');
    expect(first.searchParams.get('text')).toBe('keywords:waypoint-extension');
    expect(first.searchParams.get('popularity')).toBe('1.0');

    await catalog.search('  Emoji   Picker ');
    const second = new URL(String(fetch.mock.calls[1]?.[0]));
    expect(second.searchParams.get('text')).toBe('keywords:waypoint-extension emoji picker');
    expect(second.searchParams.has('popularity')).toBe(false);
  });

  it('remembers a search for a while', async () => {
    const { catalog, fetch, later } = setUp();
    expect(await catalog.search('emoji')).toHaveLength(1);
    await catalog.search('Emoji');
    expect(fetch).toHaveBeenCalledTimes(1);
    later(11 * 60 * 1000);
    await catalog.search('emoji');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('says when npm cannot be reached or answers with an error', async () => {
    const offline = setUp(() => Promise.reject(new TypeError('fetch failed')));
    await expect(offline.catalog.search('')).rejects.toThrow(/Couldn’t reach npm/);
    const down = setUp(() => new Response('', { status: 503 }));
    await expect(down.catalog.search('')).rejects.toThrow(/npm answered 503/);
  });

  it('does not remember a search that failed', async () => {
    let fail = true;
    const { catalog, fetch } = setUp(() =>
      fail ? new Response('', { status: 500 }) : Response.json({ objects: [found('x')] }),
    );
    await expect(catalog.search('x')).rejects.toThrow();
    fail = false;
    expect(await catalog.search('x')).toHaveLength(1);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
