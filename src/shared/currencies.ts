/**
 * The currencies the calculator converts between: the ones the European Central Bank publishes
 * daily reference rates for, against the euro.
 */

export interface Currency {
  dimension: 'currency';
  /** ISO 4217, as the ECB names it. */
  code: string;
  name: string;
  /** What people type, in lowercase. */
  aliases: string[];
}

/** The ECB's reference rates for one day. */
export interface ExchangeRates {
  /** The day they're for, as YYYY-MM-DD. */
  date: string;
  /** How much of each currency one euro buys, by code. */
  rates: Record<string, number>;
}

function currency(code: string, name: string, aliases: string[] = []): Currency {
  return { dimension: 'currency', code, name, aliases: [code.toLowerCase(), ...aliases] };
}

export const CURRENCIES: readonly Currency[] = [
  currency('EUR', 'Euros', ['€', 'euro']),
  currency('USD', 'US dollars', ['$', 'us$', 'dollar', 'us dollar', 'buck']),
  currency('GBP', 'British pounds', ['£', 'pound', 'pound sterling', 'sterling', 'quid']),
  currency('JPY', 'Japanese yen', ['¥', 'yen']),
  currency('CNY', 'Chinese yuan', ['yuan', 'renminbi', 'rmb']),
  currency('CHF', 'Swiss francs', ['franc', 'swiss franc']),
  currency('CAD', 'Canadian dollars', ['c$', 'canadian dollar']),
  currency('AUD', 'Australian dollars', ['a$', 'australian dollar']),
  currency('NZD', 'New Zealand dollars', ['nz$', 'new zealand dollar']),
  currency('HKD', 'Hong Kong dollars', ['hk$', 'hong kong dollar']),
  currency('SGD', 'Singapore dollars', ['s$', 'singapore dollar']),
  currency('SEK', 'Swedish kronor', ['swedish krona', 'swedish kronor']),
  currency('NOK', 'Norwegian kroner', ['norwegian krone', 'norwegian kroner']),
  currency('DKK', 'Danish kroner', ['danish krone', 'danish kroner']),
  currency('ISK', 'Icelandic krónur', ['icelandic krona', 'icelandic króna']),
  currency('PLN', 'Polish złoty', ['zł', 'zloty', 'złoty']),
  currency('CZK', 'Czech koruny', ['kč', 'koruna', 'czech koruna']),
  currency('HUF', 'Hungarian forints', ['forint']),
  currency('RON', 'Romanian lei', ['lei', 'leu']),
  currency('TRY', 'Turkish lira', ['₺', 'lira', 'turkish lira']),
  currency('ILS', 'Israeli shekels', ['₪', 'nis', 'shekel', 'sheqel']),
  currency('INR', 'Indian rupees', ['₹', 'rupee', 'indian rupee']),
  currency('IDR', 'Indonesian rupiah', ['rupiah']),
  currency('KRW', 'South Korean won', ['₩', 'won']),
  currency('BRL', 'Brazilian reais', ['r$', 'real', 'reais', 'brazilian real']),
  currency('MXN', 'Mexican pesos', ['peso', 'mexican peso']),
  currency('PHP', 'Philippine pesos', ['₱', 'philippine peso']),
  currency('MYR', 'Malaysian ringgit', ['ringgit']),
  currency('THB', 'Thai baht', ['฿', 'baht']),
  currency('ZAR', 'South African rand', ['rand']),
];

const BY_ALIAS = new Map(CURRENCIES.flatMap((currency) => currency.aliases.map((alias) => [alias, currency] as const)));

/** A currency symbol written before the amount, as in "€50" or "US$20". */
export const LEADING_SYMBOL = /^(?:(?:us|c|a|nz|hk|s|r)\$|[$€£¥₹₩₺₪₱฿])/i;

/** The currency `text` names, by code, symbol or name, plurals too ("dollars"). */
export function findCurrency(text: string): Currency | undefined {
  const lower = text.trim().replace(/\s+/g, ' ').toLowerCase();
  return BY_ALIAS.get(lower) ?? (lower.endsWith('s') ? BY_ALIAS.get(lower.slice(0, -1)) : undefined);
}

/** Converts between two currencies through the euro, or `null` without a rate for either. */
export function convertCurrency(amount: number, from: Currency, to: Currency, rates: ExchangeRates): number | null {
  const rate = (code: string) => (code === 'EUR' ? 1 : rates.rates[code]);
  const fromRate = rate(from.code);
  const toRate = rate(to.code);
  if (!fromRate || !toRate) return null;
  return (amount / fromRate) * toRate;
}

/**
 * Reads the ECB's daily reference rates
 * (https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml), or `null` if `xml` isn't them.
 */
export function parseEcbRates(xml: string): ExchangeRates | null {
  const date = /<Cube\s+time=["'](\d{4}-\d{2}-\d{2})["']/.exec(xml)?.[1];
  if (!date) return null;
  const rates: Record<string, number> = {};
  for (const [, code, rate] of xml.matchAll(/<Cube\s+currency=["']([A-Z]{3})["']\s+rate=["']([\d.]+)["']/g)) {
    const value = Number(rate);
    if (code && Number.isFinite(value) && value > 0) rates[code] = value;
  }
  return Object.keys(rates).length > 0 ? { date, rates } : null;
}

/** Whether `value` is a well-formed `ExchangeRates`, for what's read back from disk. */
export function isExchangeRates(value: unknown): value is ExchangeRates {
  const candidate = value as ExchangeRates | null | undefined;
  if (typeof candidate?.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(candidate.date)) return false;
  const { rates } = candidate;
  if (typeof rates !== 'object' || rates === null) return false;
  return Object.entries(rates).every(
    ([code, rate]) => /^[A-Z]{3}$/.test(code) && typeof rate === 'number' && Number.isFinite(rate) && rate > 0,
  );
}

/** The day the rates are for, as "Oct 16, 2026". */
export function formatRatesDate(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}
