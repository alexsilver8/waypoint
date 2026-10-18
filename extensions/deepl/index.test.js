// The command with DeepL's API stood in for, so no key or connection is needed.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import extension from './index.js';

const KEY = '1a2b3c4d-5e6f-4a1b-8c9d-0e1f2a3b4c5d:fx';
const command = /** @type {import('@waypoint/api').CommandImplementation<any>} */ (extension.commands.translate);

/** @type {Map<string, any>} */
let data;
/** @type {Array<{ url: string, body: any }>} */
let requests;

/** @param {string} query */
const ctx = (query) => ({
  query,
  platform: 'darwin',
  storage: {
    get: (/** @type {string} */ key) => data.get(key),
    set: (/** @type {string} */ key, /** @type {any} */ value) => data.set(key, value),
    remove: (/** @type {string} */ key) => data.delete(key),
  },
});

/** A pretend DeepL: Spanish and English are told apart by one word. */
function fakeDeepL(/** @type {{ status?: number }} */ { status = 200 } = {}) {
  return vi.fn(async (/** @type {string} */ url, /** @type {RequestInit} */ init) => {
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    requests.push({ url, body });
    if (status !== 200) return new Response('{}', { status });
    if (url.endsWith('/v2/usage')) return Response.json({ character_count: 10, character_limit: 500_000 });
    const text = body.text[0];
    const source = text.includes('hola') ? 'ES' : 'EN';
    const translated = body.target_lang.startsWith('EN')
      ? text.replace('hola', 'hello')
      : `[${body.target_lang}] ${text}`;
    return Response.json({ translations: [{ detected_source_language: source, text: translated }] });
  });
}

beforeEach(() => {
  data = new Map();
  requests = [];
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Translate', () => {
  it('asks for a key first, and saves one that works', async () => {
    vi.stubGlobal('fetch', fakeDeepL());
    const view = await command.view?.(ctx(KEY));
    expect(view?.sections[0]?.items.map((item) => item.title)).toEqual(['Save This Key', 'Get a DeepL API Key']);
    const result = await command.onAction?.('save-key', KEY, ctx(KEY));
    expect(data.get('key')).toBe(KEY);
    expect(result?.toast).toBe('Connected to DeepL. 10 of 500,000 characters used');
    expect(requests[0]?.url).toBe('https://api-free.deepl.com/v2/usage');
    expect(data.get('server')).toBe('https://api-free.deepl.com');
  });

  it('tries the other server when a key is refused on the one its ending points to', async () => {
    const key = '1a2b3c4d-5e6f-4a1b-8c9d-0e1f2a3b4c5d:dp';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (/** @type {string} */ url) => {
        requests.push({ url, body: undefined });
        return url.startsWith('https://api-free.deepl.com')
          ? Response.json({ character_count: 0, character_limit: 1_000_000 })
          : new Response('{}', { status: 403 });
      }),
    );
    const result = await command.onAction?.('save-key', key, ctx(key));
    expect(requests.map((request) => request.url)).toEqual([
      'https://api.deepl.com/v2/usage',
      'https://api-free.deepl.com/v2/usage',
    ]);
    expect(data.get('server')).toBe('https://api-free.deepl.com');
    expect(result?.toast).toBe('Connected to DeepL. 0 of 1,000,000 characters used');
  });

  it("doesn't save a key DeepL turns down", async () => {
    vi.stubGlobal('fetch', fakeDeepL({ status: 403 }));
    const result = await command.onAction?.('save-key', KEY, ctx(KEY));
    expect(result).toEqual({ toast: "DeepL didn't accept your key.", toastStyle: 'failure' });
    expect(data.has('key')).toBe(false);
  });

  it('translates into your language', async () => {
    vi.stubGlobal('fetch', fakeDeepL());
    data.set('key', KEY);
    data.set('target', 'EN-GB');
    const view = await command.view?.(ctx('hola amigo'));
    const [translation] = view?.sections[0]?.items ?? [];
    expect(view?.sections[0]?.title).toBe('Spanish → British English');
    expect(translation?.title).toBe('hello amigo');
    expect(translation?.actions[0]).toEqual({ type: 'copy', text: 'hello amigo', title: 'Copy Translation' });
    expect(requests).toEqual([
      { url: 'https://api-free.deepl.com/v2/translate', body: { text: ['hola amigo'], target_lang: 'EN-GB' } },
    ]);
  });

  it('uses the second language for text already in yours', async () => {
    vi.stubGlobal('fetch', fakeDeepL());
    data.set('key', KEY);
    data.set('target', 'EN-US');
    data.set('second', 'DE');
    const view = await command.view?.(ctx('good morning'));
    expect(view?.sections[0]?.title).toBe('English → German');
    expect(view?.sections[0]?.items[0]?.title).toBe('[DE] good morning');
  });

  it('only asks DeepL once typing has stopped', async () => {
    vi.stubGlobal('fetch', fakeDeepL());
    data.set('key', KEY);
    const [first, second] = await Promise.all([command.view?.(ctx('hola')), command.view?.(ctx('hola amigos'))]);
    expect(first?.sections).toEqual([]);
    expect(second?.sections[0]?.items[0]?.title).toBe('hello amigos');
    expect(requests).toHaveLength(1);
  });

  it('goes back to the translation, in the language picked', async () => {
    vi.stubGlobal('fetch', fakeDeepL());
    data.set('key', KEY);
    const picker = await command.onAction?.('choose', { which: 'target', text: 'hello' }, ctx('hello'));
    expect(picker?.push?.sections[0]?.items.length).toBeGreaterThan(20);
    const result = await command.onAction?.('pick', { which: 'target', code: 'FR', text: 'hello' }, ctx('fre'));
    expect(data.get('target')).toBe('FR');
    expect(result?.pop).toBe(true);
    expect(result?.replace?.sections[0]?.items[0]?.title).toBe('[FR] hello');
  });

  it('takes a pasted key as a new key, not text to translate', async () => {
    const fetch = fakeDeepL();
    vi.stubGlobal('fetch', fetch);
    data.set('key', KEY);
    const other = '9f8e7d6c-5b4a-4321-8765-0fedcba98765:fx';
    const view = await command.view?.(ctx(other));
    expect(view?.sections[0]?.items.map((item) => item.title)).toEqual([
      'Use This Key Instead',
      'Get a DeepL API Key',
      'Use Another DeepL Key',
    ]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('asks for a key again when DeepL stops accepting it', async () => {
    vi.stubGlobal('fetch', fakeDeepL({ status: 403 }));
    data.set('key', KEY);
    const view = await command.view?.(ctx('hola'));
    expect(view?.searchPlaceholder).toBe('Paste a DeepL API key…');
    expect(view?.sections[0]?.title).toBe("DeepL didn't accept your key.");
    // It can be replaced or forgotten from here.
    const key = view?.sections[0]?.items.find((item) => item.id === 'key');
    expect(key?.actions.map((action) => action.title)).toEqual(['Use Another Key', 'Forget DeepL Key']);
  });
});
