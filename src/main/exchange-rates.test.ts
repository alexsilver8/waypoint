import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { ECB_DAILY_URL, ExchangeRateStore } from './exchange-rates';

const HOUR = 60 * 60 * 1000;
const xml = (date: string, usd: number) =>
  `<Cube><Cube time='${date}'><Cube currency='USD' rate='${usd}'/><Cube currency='GBP' rate='0.87'/></Cube></Cube>`;

function setup(options: { cached?: unknown; respond?: () => Promise<Response> } = {}) {
  const path = join(mkdtempSync(join(tmpdir(), 'exchange-rates-')), 'exchange-rates.json');
  if (options.cached !== undefined) writeFileSync(path, JSON.stringify(options.cached));
  let now = 100 * 24 * HOUR;
  const fetch = vi.fn(options.respond ?? (async () => new Response(xml('2026-10-16', 1.165))));
  const store = new ExchangeRateStore({ path, fetch, now: () => now });
  return { path, store, fetch, advance: (ms: number) => (now += ms), now: () => now };
}

describe('ExchangeRateStore', () => {
  it('has no rates until it has fetched some', async () => {
    const { store, fetch, path } = setup();
    const change = vi.fn();
    store.on('change', change);
    expect(store.rates).toBeNull();

    await store.refresh();
    expect(fetch).toHaveBeenCalledWith(ECB_DAILY_URL, expect.objectContaining({ signal: expect.any(AbortSignal) }));
    const rates = { date: '2026-10-16', rates: { USD: 1.165, GBP: 0.87 } };
    expect(store.rates).toEqual(rates);
    expect(change).toHaveBeenCalledWith(rates);
    expect(JSON.parse(readFileSync(path, 'utf8'))).toMatchObject(rates);
  });

  it('works offline from what it saved, and fetches again once a day', async () => {
    const first = setup();
    await first.store.refresh();
    const fetchedAt = first.now();

    // Offline: it keeps what it has.
    const failing = vi.fn(async () => {
      throw new Error('getaddrinfo ENOTFOUND');
    });
    let now = fetchedAt + HOUR;
    const store = new ExchangeRateStore({ path: first.path, fetch: failing, now: () => now });
    expect(store.rates?.rates.USD).toBe(1.165);
    await store.refresh();
    expect(failing).not.toHaveBeenCalled();

    now = fetchedAt + 25 * HOUR;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await store.refresh();
    expect(failing).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
    expect(store.rates?.rates.USD).toBe(1.165);
  });

  it('waits an hour before trying again after failing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { store, fetch, advance } = setup({ respond: async () => new Response('busy', { status: 503 }) });
    await store.refresh();
    await store.refresh();
    expect(fetch).toHaveBeenCalledTimes(1);
    advance(HOUR);
    await store.refresh();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(store.rates).toBeNull();
    warn.mockRestore();
  });

  it('fetches once when asked again while fetching', async () => {
    const { store, fetch } = setup();
    await Promise.all([store.refresh(), store.refresh()]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('ignores a cache file that is broken or not rates', async () => {
    for (const cached of ['not json', { date: '2026-10-16', rates: { USD: 'lots' }, fetchedAt: 1 }, { USD: 1 }]) {
      const path = join(mkdtempSync(join(tmpdir(), 'exchange-rates-')), 'exchange-rates.json');
      writeFileSync(path, typeof cached === 'string' ? cached : JSON.stringify(cached));
      const store = new ExchangeRateStore({ path, fetch: vi.fn() });
      expect(store.rates).toBeNull();
    }
  });

  it('rejects an answer that is not rates and keeps the old ones', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { store, fetch, advance } = setup();
    await store.refresh();
    fetch.mockImplementation(async () => new Response('<html>Maintenance</html>'));
    advance(25 * HOUR);
    await store.refresh();
    expect(store.rates?.date).toBe('2026-10-16');
    warn.mockRestore();
  });
});
