import { EventEmitter } from 'node:events';
import { type ExchangeRates, isExchangeRates, parseEcbRates } from '../shared/currencies';
import { readJsonFile, writeJsonFile } from './json-file';

/** The European Central Bank's reference rates, published each working day around 16:00 CET. Free, no key. */
export const ECB_DAILY_URL = 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml';

const HOUR_MS = 60 * 60 * 1000;
const REFRESH_MS = 24 * HOUR_MS;
const RETRY_MS = HOUR_MS;
const TIMEOUT_MS = 15_000;

interface CachedRates extends ExchangeRates {
  /** Epoch milliseconds. */
  fetchedAt: number;
}

export interface ExchangeRateOptions {
  /** Where they're kept between runs, so currencies convert offline. */
  path: string;
  /** Electron's `net.fetch` in the app, which goes through the system's proxy. */
  fetch(url: string, init: { signal: AbortSignal }): Promise<Response>;
  now?: () => number;
}

interface ExchangeRateEvents {
  change: [rates: ExchangeRates];
}

/**
 * The exchange rates the calculator converts currencies with: kept on disk, and fetched again
 * when they're a day old. Without a connection it keeps what it has.
 */
export class ExchangeRateStore extends EventEmitter<ExchangeRateEvents> {
  private cached: CachedRates | undefined;
  private failedAt = Number.NEGATIVE_INFINITY;
  private pending: Promise<void> | undefined;
  private readonly now: () => number;

  constructor(private readonly options: ExchangeRateOptions) {
    super();
    this.now = options.now ?? Date.now;
    let loaded: unknown;
    try {
      loaded = readJsonFile(options.path);
    } catch {
      loaded = undefined;
    }
    const fetchedAt = (loaded as CachedRates | undefined)?.fetchedAt;
    if (isExchangeRates(loaded) && typeof fetchedAt === 'number') {
      this.cached = { date: loaded.date, rates: loaded.rates, fetchedAt };
    }
  }

  /** The latest rates, or `null` before any have been fetched. */
  get rates(): ExchangeRates | null {
    return this.cached ? { date: this.cached.date, rates: this.cached.rates } : null;
  }

  /** Fetches new rates if these are a day old, but not again within the hour after failing. */
  refresh(): Promise<void> {
    const now = this.now();
    if (this.pending) return this.pending;
    if (this.cached && now - this.cached.fetchedAt < REFRESH_MS) return Promise.resolve();
    if (now - this.failedAt < RETRY_MS) return Promise.resolve();
    this.pending = this.fetchRates()
      .catch((error: unknown) => {
        this.failedAt = this.now();
        console.warn(`[exchange-rates] ${error instanceof Error ? error.message : String(error)}`);
      })
      .finally(() => {
        this.pending = undefined;
      });
    return this.pending;
  }

  private async fetchRates(): Promise<void> {
    const response = await this.options.fetch(ECB_DAILY_URL, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!response.ok) throw new Error(`The ECB answered ${response.status}`);
    const rates = parseEcbRates(await response.text());
    if (!rates) throw new Error('The ECB sent something other than its rates');
    this.cached = { ...rates, fetchedAt: this.now() };
    this.emit('change', rates);
    writeJsonFile(this.options.path, this.cached);
  }
}
