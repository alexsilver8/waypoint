import { describe, expect, it } from 'vitest';
import { convertUnit, findUnits, normalizeUnit, UNITS } from './units';

const one = (text: string) => {
  const [unit] = findUnits(text);
  if (!unit) throw new Error(`No unit "${text}"`);
  return unit;
};
const convert = (value: number, from: string, to: string) => convertUnit(value, one(from), one(to));

describe('findUnits', () => {
  it.each([
    ['km', 'km'],
    ['kilometres', 'km'],
    ['Miles', 'mi'],
    ['mi', 'mi'],
    ['inches', 'in'],
    ['"', 'in'],
    ["'", 'ft'],
    ['feet', 'ft'],
    ['lbs', 'lb'],
    ['pounds', 'lb'],
    ['cups', 'cup'],
    ['fl. oz', 'fl oz'],
    ['°F', '°F'],
    ['degrees celsius', '°C'],
    ['deg f', '°F'],
    ['hrs', 'h'],
    ['mins', 'min'],
    ['ms', 'ms'],
    ['m²', 'm²'],
    ['m^2', 'm²'],
    ['sq  ft', 'ft²'],
    ['square feet', 'ft²'],
    ['km/h', 'km/h'],
    ['miles per hour', 'mph'],
    ['GiB', 'GiB'],
    ['gb', 'GB'],
    ['GB', 'GB'],
    ['Gb', 'Gbit'],
    ['B', 'B'],
    ['b', 'bit'],
    ['bytes', 'B'],
    ['psi', 'psi'],
    ['PSI', 'psi'],
    ['pounds per square inch', 'psi'],
    ['bars', 'bar'],
    ['mbar', 'mbar'],
    ['kPa', 'kPa'],
    ['mmHg', 'mmHg'],
    ['inches of mercury', 'inHg'],
    ['atmospheres', 'atm'],
    ['kJ', 'kJ'],
    ['Calories', 'cal'],
    ['kcal', 'kcal'],
    ['kWh', 'kWh'],
    ['kilowatt hours', 'kWh'],
    ['BTU', 'BTU'],
    ['Btu', 'BTU'],
    ['eV', 'eV'],
    ['W', 'W'],
    ['kilowatts', 'kW'],
    ['hp', 'hp'],
    ['horsepower', 'hp'],
    ['PS', 'PS'],
    ['rad', 'rad'],
    ['radians', 'rad'],
    ['deg', '°'],
    ['degrees', '°'],
    ['°', '°'],
    ['grad', 'grad'],
    ['turns', 'turn'],
    ['arcmin', '′'],
    ['arcseconds', '″'],
  ])('%j is %s', (text, symbol) => {
    expect(one(text).symbol).toBe(symbol);
  });

  it('gives ′ and ″ as feet and inches first, and as arcminutes and arcseconds too', () => {
    expect(findUnits("'").map((unit) => unit.symbol)).toEqual(['ft', '′']);
    expect(findUnits('″').map((unit) => unit.symbol)).toEqual(['in', '″']);
  });

  it.each([['apples'], ['go'], [''], ['to'], ['kms per apple']])('%j is no unit', (text) => {
    expect(findUnits(text)).toEqual([]);
  });

  it('gives each alias to one unit per dimension, stored as looked up', () => {
    const seen = new Set<string>();
    for (const unit of UNITS) {
      for (const alias of [...unit.aliases, ...(unit.exact ?? [])]) {
        const key = `${unit.dimension}:${alias}`;
        expect(seen.has(key), key).toBe(false);
        seen.add(key);
        expect(normalizeUnit(alias)).toBe(alias);
      }
    }
  });
});

describe('convertUnit', () => {
  it.each([
    [5, 'km', 'mi', 3.106855961],
    [1, 'mi', 'km', 1.609344],
    [12, 'in', 'ft', 1],
    [1, 'nmi', 'm', 1852],
    [1, 'kg', 'lb', 2.204622622],
    [16, 'oz', 'lb', 1],
    [14, 'lb', 'st', 1],
    [2, 'cups', 'ml', 473.176473],
    [1, 'gal', 'l', 3.785411784],
    [3, 'tsp', 'tbsp', 1],
    [1, 'imp gal', 'l', 4.54609],
    [72, 'f', 'c', 22.222222222],
    [-40, 'c', 'f', -40],
    [100, 'c', 'k', 373.15],
    [0, 'k', 'f', -459.67],
    [90, 'min', 'h', 1.5],
    [1, 'day', 's', 86_400],
    [1, 'year', 'day', 365.2425],
    [1.5, 'gb', 'mb', 1500],
    [1, 'gib', 'mib', 1024],
    [1, 'gb', 'gib', 0.931322575],
    [8, 'bit', 'B', 1],
    [100, 'Mb', 'MB', 12.5],
    [100, 'km/h', 'mph', 62.137119224],
    [1, 'kn', 'km/h', 1.852],
    [1, 'ha', 'm2', 10_000],
    [1, 'acre', 'sq ft', 43_560],
    [1, 'sq mi', 'km2', 2.589988110336],
    [32, 'psi', 'bar', 2.206322334],
    [1, 'bar', 'kpa', 100],
    [1, 'atm', 'psi', 14.695948775],
    [1, 'atm', 'mmhg', 759.999892],
    [1, 'atm', 'torr', 760],
    [29.92, 'inhg', 'hpa', 1013.207589],
    [1013.25, 'hpa', 'mbar', 1013.25],
    [1, 'mpa', 'bar', 10],
    [500, 'kcal', 'kj', 2092],
    [1, 'kwh', 'j', 3_600_000],
    [1, 'mwh', 'kwh', 1000],
    [1, 'btu', 'j', 1055.05585262],
    [1, 'kcal', 'cal', 1000],
    [1, 'wh', 'cal', 860.420650096],
    [150, 'hp', 'kw', 111.854980737],
    [100, 'ps', 'hp', 98.632007],
    [1, 'kw', 'hp', 1.34102209],
    [1, 'mw', 'w', 1_000_000],
    [90, 'deg', 'rad', Math.PI / 2],
    [Math.PI, 'rad', 'deg', 180],
    [1, 'turn', 'deg', 360],
    [400, 'grad', 'deg', 360],
    [1, 'deg', 'arcmin', 60],
    [1, 'arcmin', 'arcsec', 60],
    [1, 'rev', 'rad', Math.PI * 2],
  ])('%d %s = %d %s', (value, from, to, expected) => {
    expect(convert(value, from, to)).toBeCloseTo(expected, 6);
  });

  it('converts electronvolts, which are too small for the table above', () => {
    expect(convert(1, 'j', 'ev') / 1e18).toBeCloseTo(6.241509074, 6);
    expect(convert(1e18, 'ev', 'j')).toBeCloseTo(0.1602176634, 9);
  });

  it('converts every unit of a kind to every other and back', () => {
    for (const from of UNITS) {
      for (const to of UNITS) {
        if (from.dimension !== to.dimension) continue;
        const there = convertUnit(12.5, from, to);
        expect(Number.isFinite(there), `${from.symbol} to ${to.symbol}`).toBe(true);
        expect(convertUnit(there, to, from), `${from.symbol} to ${to.symbol} and back`).toBeCloseTo(12.5, 6);
      }
    }
  });
});
