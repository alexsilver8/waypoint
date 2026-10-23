import { describe, expect, it } from 'vitest';
import { convert, formatAmount, parseConversion, withUnit } from './conversion';
import { type Currency, type ExchangeRates, findCurrency } from './currencies';
import { findUnits, type Unit } from './units';

const rates: ExchangeRates = { date: '2026-10-16', rates: { USD: 1.165, GBP: 0.86915, JPY: 176.12 } };

/** What the calculator row would show for `input`. */
function answer(input: string, withRates: ExchangeRates | null = rates): string | null {
  const conversion = parseConversion(input);
  if (!conversion) return null;
  const value = convert(conversion, withRates);
  return value === null ? 'unavailable' : withUnit(formatAmount(value, conversion.to), conversion.to);
}

const unit = (text: string) => findUnits(text)[0] as Unit;

describe('parseConversion', () => {
  it.each([
    ['5 km to mi', '3.11 mi'],
    ['5km in miles', '3.11 mi'],
    ['5 kilometers as miles', '3.11 mi'],
    ['5 km = mi', '3.11 mi'],
    ['5 km into mi', '3.11 mi'],
    ['  5   KM   TO   MI  ', '3.11 mi'],
    ['72 f to c', '22.22 °C'],
    ['72°F in °C', '22.22 °C'],
    ['72 degrees fahrenheit to celsius', '22.22 °C'],
    ['-40 c to f', '-40 °F'],
    ['0 c to k', '273.15 K'],
    ['3 ft 4 in to cm', '101.6 cm'],
    ['5\'10" to cm', '177.8 cm'],
    ['1 h 30 min to min', '90 min'],
    ['1.5 gb in mb', '1,500 MB'],
    ['1 GiB in MB', '1,073.74 MB'],
    ['100 Mb to MB', '12.5 MB'],
    ['90 min to h', '1.5 h'],
    ['2 cups to ml', '473.18 mL'],
    ['1 l to cups', '4.23 cups'],
    ['0.2365882365 l to cups', '1 cup'],
    ['1 kg in lb', '2.2 lb'],
    ['5 pounds to kg', '2.27 kg'],
    ['100 km/h to mph', '62.14 mph'],
    ['1 acre in m2', '4,046.86 m²'],
    ['1000 sq ft to m²', '92.9 m²'],
    ['1 mm to in', '0.0394 in'],
    ['2 days in hours', '48 h'],
    ['1 week to days', '7 days'],
    ['5 in in cm', '12.7 cm'],
    ['1/2 cup to tbsp', '8 tbsp'],
    ['2*5 km to mi', '6.21 mi'],
    ['(1 + 2) kg to g', '3,000 g'],
    ['1e3 m to km', '1 km'],
    ['.5 km to m', '500 m'],
    ['5 km to km', '5 km'],
    ['32 psi to bar', '2.21 bar'],
    ['1 atm in mmHg', '760 mmHg'],
    ['1013 hpa to inhg', '29.91 inHg'],
    ['500 kcal in kj', '2,092 kJ'],
    ['2 kwh to btu', '6,824.28 BTU'],
    ['150 hp to kw', '111.85 kW'],
    ['100 PS in hp', '98.63 hp'],
    ['90 deg to rad', '1.57 rad'],
    ['180 degrees in radians', '3.14 rad'],
    ['1 turn to deg', '360°'],
    ['2 turns in degrees', '720°'],
    ['90° to grad', '100 grad'],
    ['30′ to deg', '0.5°'],
    ["45° 30' to deg", '45.5°'],
    ['1 deg to arcsec', '3,600″'],
  ])('%j = %s', (input, expected) => {
    expect(answer(input)).toBe(expected);
  });

  it.each([
    ['100 usd in eur', '85.84 EUR'],
    ['100 USD to EUR', '85.84 EUR'],
    ['€50 to gbp', '43.46 GBP'],
    ['50€ in £', '43.46 GBP'],
    ['$100 in yen', '15,117.60 JPY'],
    ['US$20 to euros', '17.17 EUR'],
    ['10 pounds to dollars', '13.40 USD'],
    ['2 * 50 eur to usd', '116.50 USD'],
    ['1 jpy to eur', '0.00568 EUR'],
    ['100 usd to chf', 'unavailable'],
  ])('%j = %s', (input, expected) => {
    expect(answer(input)).toBe(expected);
  });

  it('knows currencies before there are rates for them', () => {
    expect(answer('100 usd in eur', null)).toBe('unavailable');
  });

  it.each([
    [''],
    ['in'],
    ['go to mail'],
    ['how to cook rice'],
    ['flights to paris in 2 days'],
    ['2 apples to oranges'],
    ['5 km'],
    ['100 usd'],
    ['5 km to'],
    ['to mi'],
    ['km to mi'],
    ['5 km to kg'],
    ['5 kg in usd'],
    ['10 to 20'],
    ['1 in 3'],
    ['3 in c'],
    ['meet 5 to 6 pm'],
    ['convert 5 km to mi'],
    ['12 * 7'],
    ['1 + 2 = 3'],
    ['10 c 4 f to k'],
    ['192.168.1.1 to mi'],
    ['72 deg to c'],
    ['2 bar to go'],
    ['3 turns to the left'],
    ['open 2 ps in word'],
  ])('%j is not a conversion', (input) => {
    expect(parseConversion(input)).toBeNull();
  });

  it('prefers the meaning that fits what it converts to', () => {
    expect(parseConversion('5 pounds to kg')?.from.dimension).toBe('mass');
    expect(parseConversion('5 pounds to eur')?.from.dimension).toBe('currency');
    expect(parseConversion("5' to cm")?.from.dimension).toBe('length');
    expect(parseConversion("5' to deg")?.from.dimension).toBe('angle');
    expect(parseConversion('72 deg f to c')?.from.dimension).toBe('temperature');
  });
});

describe('formatAmount', () => {
  it('rounds to two decimals and groups digits', () => {
    expect(formatAmount(3.10686, unit('mi'))).toBe('3.11');
    expect(formatAmount(1234567.891, unit('m'))).toBe('1,234,567.89');
    expect(formatAmount(1234567.891, unit('m'), false)).toBe('1234567.89');
    expect(formatAmount(1.5, unit('h'))).toBe('1.5');
    expect(formatAmount(0, unit('m'))).toBe('0');
  });

  it('keeps three significant digits below 0.1', () => {
    expect(formatAmount(0.0393701, unit('in'))).toBe('0.0394');
    expect(formatAmount(-0.0012345, unit('in'))).toBe('-0.00123');
  });

  it('always shows cents for money', () => {
    const euros = findCurrency('eur') as Currency;
    expect(formatAmount(86.2, euros)).toBe('86.20');
    expect(formatAmount(3, euros)).toBe('3.00');
    expect(withUnit('3.00', euros)).toBe('3.00 EUR');
  });

  it('uses exponent notation like the calculator for extreme amounts', () => {
    expect(formatAmount(1e25, unit('m'))).toBe('1.000000e+25');
    expect(formatAmount(1e-12, unit('m'))).toBe('1.000000e-12');
  });
});

describe('withUnit', () => {
  it('uses plurals where the symbol is a word', () => {
    expect(withUnit('1', unit('cup'))).toBe('1 cup');
    expect(withUnit('2', unit('cup'))).toBe('2 cups');
    expect(withUnit('2', unit('km'))).toBe('2 km');
  });

  it('writes degrees, arcminutes and arcseconds against the number', () => {
    expect(withUnit('90', unit('deg'))).toBe('90°');
    expect(withUnit('30', unit('arcmin'))).toBe('30′');
    expect(withUnit('22.22', unit('°C'))).toBe('22.22 °C');
  });
});
