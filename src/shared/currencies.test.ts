import { describe, expect, it } from 'vitest';
import {
  CURRENCIES,
  convertCurrency,
  type ExchangeRates,
  findCurrency,
  formatRatesDate,
  isExchangeRates,
  LEADING_SYMBOL,
  parseEcbRates,
} from './currencies';

const ECB_XML = `<?xml version="1.0" encoding="UTF-8"?>
<gesmes:Envelope xmlns:gesmes="http://www.gesmes.org/xml/2002-08-01" xmlns="http://www.ecb.int/vocabulary/2002-08-01/eurofxref">
	<gesmes:subject>Reference rates</gesmes:subject>
	<gesmes:Sender>
		<gesmes:name>European Central Bank</gesmes:name>
	</gesmes:Sender>
	<Cube>
		<Cube time='2026-10-16'>
			<Cube currency='USD' rate='1.1650'/>
			<Cube currency='JPY' rate='176.12'/>
			<Cube currency='GBP' rate='0.86915'/>
		</Cube>
	</Cube>
</gesmes:Envelope>`;

const rates: ExchangeRates = { date: '2026-10-16', rates: { USD: 1.165, JPY: 176.12, GBP: 0.86915 } };

const currency = (text: string) => {
  const found = findCurrency(text);
  if (!found) throw new Error(`No currency "${text}"`);
  return found;
};

describe('findCurrency', () => {
  it.each([
    ['usd', 'USD'],
    ['USD', 'USD'],
    ['$', 'USD'],
    ['dollars', 'USD'],
    ['€', 'EUR'],
    ['euros', 'EUR'],
    ['£', 'GBP'],
    ['pounds', 'GBP'],
    ['¥', 'JPY'],
    ['CHF', 'CHF'],
    ['swiss  francs', 'CHF'],
    ['R$', 'BRL'],
  ])('%j is %s', (text, code) => {
    expect(currency(text).code).toBe(code);
  });

  it.each([['km'], ['mail'], ['xyz'], ['']])('%j is no currency', (text) => {
    expect(findCurrency(text)).toBeUndefined();
  });

  it('gives each alias to one currency', () => {
    const aliases = CURRENCIES.flatMap((c) => c.aliases);
    expect(new Set(aliases).size).toBe(aliases.length);
  });
});

describe('LEADING_SYMBOL', () => {
  it.each([
    ['€50', '€'],
    ['$100', '$'],
    ['US$20', 'US$'],
    ['£ 5', '£'],
  ])('finds %j', (text, symbol) => {
    expect(LEADING_SYMBOL.exec(text)?.[0]).toBe(symbol);
  });

  it('ignores amounts without one', () => {
    expect(LEADING_SYMBOL.exec('50 eur')).toBeNull();
  });
});

describe('convertCurrency', () => {
  it('converts through the euro', () => {
    expect(convertCurrency(100, currency('usd'), currency('eur'), rates)).toBeCloseTo(85.836909871, 6);
    expect(convertCurrency(50, currency('eur'), currency('gbp'), rates)).toBeCloseTo(43.4575, 6);
    expect(convertCurrency(100, currency('usd'), currency('jpy'), rates)).toBeCloseTo(15_117.596566524, 4);
    expect(convertCurrency(7, currency('eur'), currency('eur'), rates)).toBe(7);
  });

  it('gives null without a rate', () => {
    expect(convertCurrency(1, currency('usd'), currency('chf'), rates)).toBeNull();
  });
});

describe('parseEcbRates', () => {
  it("reads the ECB's daily file", () => {
    expect(parseEcbRates(ECB_XML)).toEqual(rates);
  });

  it('accepts double quotes', () => {
    expect(parseEcbRates(`<Cube time="2026-10-16"><Cube currency="USD" rate="1.1"/></Cube>`)).toEqual({
      date: '2026-10-16',
      rates: { USD: 1.1 },
    });
  });

  it.each([[''], ['<html>Service unavailable</html>'], ["<Cube time='2026-10-16'></Cube>"]])(
    'gives null for %j',
    (xml) => {
      expect(parseEcbRates(xml)).toBeNull();
    },
  );
});

describe('isExchangeRates', () => {
  it('accepts rates', () => {
    expect(isExchangeRates(rates)).toBe(true);
    expect(isExchangeRates({ ...rates, fetchedAt: 1 })).toBe(true);
  });

  it.each([
    [null],
    ['rates'],
    [{ rates: {} }],
    [{ date: 'yesterday', rates: {} }],
    [{ date: '2026-10-16' }],
    [{ date: '2026-10-16', rates: { USD: '1.1' } }],
    [{ date: '2026-10-16', rates: { USD: -1 } }],
    [{ date: '2026-10-16', rates: { usd: 1 } }],
  ])('rejects %j', (value) => {
    expect(isExchangeRates(value)).toBe(false);
  });
});

describe('formatRatesDate', () => {
  it('writes the day out', () => {
    expect(formatRatesDate('2026-10-16')).toBe('Oct 16, 2026');
  });
});
