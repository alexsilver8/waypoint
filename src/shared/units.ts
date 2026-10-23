/**
 * Units the calculator converts between, by hand rather than from a library: a factor to each
 * kind's base unit (meters, kilograms, liters, kelvins, seconds, bytes, meters per second, square
 * meters, pascals, joules, watts, radians), and the names, plurals and symbols people type for them.
 */

export type Dimension =
  | 'length'
  | 'mass'
  | 'volume'
  | 'temperature'
  | 'time'
  | 'data'
  | 'speed'
  | 'area'
  | 'pressure'
  | 'energy'
  | 'power'
  | 'angle';

export interface Unit {
  dimension: Dimension;
  /** How many of the dimension's base unit one of these is. */
  factor: number;
  /** Added after `factor`, for temperatures, which don't start at zero together. */
  offset?: number;
  /** Shown after the number. */
  symbol: string;
  /** Shown after numbers other than 1, for symbols that are words ("2 cups"). */
  plural?: string;
  /** Spelled out, under the answer. */
  name: string;
  /** What people type, in lowercase. */
  aliases: string[];
  /** Matched only as typed, where the case changes the meaning: "Mb" is megabits, "MB" megabytes. */
  exact?: string[];
}

function unit(
  dimension: Dimension,
  factor: number,
  symbol: string,
  name: string,
  aliases: string[],
  extra: Partial<Unit> = {},
): Unit {
  return { dimension, factor, symbol, name, aliases, ...extra };
}

const CELSIUS_ZERO = 273.15;

export const UNITS: readonly Unit[] = [
  unit('length', 1e-9, 'nm', 'Nanometers', ['nm', 'nanometer', 'nanometre']),
  unit('length', 1e-6, 'µm', 'Micrometers', ['µm', 'um', 'micrometer', 'micrometre', 'micron']),
  unit('length', 1e-3, 'mm', 'Millimeters', ['mm', 'millimeter', 'millimetre']),
  unit('length', 1e-2, 'cm', 'Centimeters', ['cm', 'centimeter', 'centimetre']),
  unit('length', 1, 'm', 'Meters', ['m', 'meter', 'metre']),
  unit('length', 1e3, 'km', 'Kilometers', ['km', 'kilometer', 'kilometre']),
  unit('length', 0.0254, 'in', 'Inches', ['in', 'inch', 'inches', '"', '″']),
  unit('length', 0.3048, 'ft', 'Feet', ['ft', 'foot', 'feet', "'", '′']),
  unit('length', 0.9144, 'yd', 'Yards', ['yd', 'yard']),
  unit('length', 1609.344, 'mi', 'Miles', ['mi', 'mile']),
  unit('length', 1852, 'nmi', 'Nautical miles', ['nmi', 'nautical mile']),

  unit('mass', 1e-9, 'µg', 'Micrograms', ['µg', 'ug', 'mcg', 'microgram']),
  unit('mass', 1e-6, 'mg', 'Milligrams', ['mg', 'milligram', 'milligramme']),
  unit('mass', 1e-3, 'g', 'Grams', ['g', 'gr', 'gram', 'gramme']),
  unit('mass', 1, 'kg', 'Kilograms', ['kg', 'kilogram', 'kilogramme', 'kilo']),
  unit('mass', 1e3, 't', 'Tonnes', ['t', 'tonne', 'metric ton']),
  unit('mass', 0.028349523125, 'oz', 'Ounces', ['oz', 'ounce']),
  unit('mass', 0.45359237, 'lb', 'Pounds', ['lb', 'lbs', 'pound']),
  unit('mass', 6.35029318, 'st', 'Stone', ['st', 'stone']),
  unit('mass', 907.18474, 'ton', 'US tons', ['ton', 'short ton', 'us ton'], { plural: 'tons' }),

  unit('volume', 1e-3, 'mL', 'Milliliters', ['ml', 'milliliter', 'millilitre', 'cm3', 'cc']),
  unit('volume', 1e-2, 'cL', 'Centiliters', ['cl', 'centiliter', 'centilitre']),
  unit('volume', 1e-1, 'dL', 'Deciliters', ['dl', 'deciliter', 'decilitre']),
  unit('volume', 1, 'L', 'Liters', ['l', 'liter', 'litre']),
  unit('volume', 1e3, 'm³', 'Cubic meters', ['m3', 'cubic meter', 'cubic metre']),
  unit('volume', 0.00492892159375, 'tsp', 'Teaspoons', ['tsp', 'teaspoon']),
  unit('volume', 0.01478676478125, 'tbsp', 'Tablespoons', ['tbsp', 'tablespoon']),
  unit('volume', 0.0295735295625, 'fl oz', 'Fluid ounces', ['fl oz', 'floz', 'fluid ounce']),
  unit('volume', 0.2365882365, 'cup', 'Cups', ['cup'], { plural: 'cups' }),
  unit('volume', 0.473176473, 'pt', 'Pints', ['pt', 'pint', 'us pint']),
  unit('volume', 0.946352946, 'qt', 'Quarts', ['qt', 'quart']),
  unit('volume', 3.785411784, 'gal', 'Gallons', ['gal', 'gallon', 'us gallon']),
  unit('volume', 0.56826125, 'imp pt', 'Imperial pints', ['imp pt', 'imperial pint', 'uk pint']),
  unit('volume', 4.54609, 'imp gal', 'Imperial gallons', ['imp gal', 'imperial gallon', 'uk gallon']),
  unit('volume', 28.316846592, 'ft³', 'Cubic feet', ['ft3', 'cu ft', 'cubic foot', 'cubic feet']),

  unit('temperature', 1, '°C', 'Celsius', ['c', '°c', 'degc', 'celsius', 'centigrade'], {
    offset: CELSIUS_ZERO,
  }),
  unit('temperature', 5 / 9, '°F', 'Fahrenheit', ['f', '°f', 'degf', 'fahrenheit'], {
    offset: CELSIUS_ZERO - (32 * 5) / 9,
  }),
  unit('temperature', 1, 'K', 'Kelvin', ['k', 'kelvin']),

  unit('time', 1e-3, 'ms', 'Milliseconds', ['ms', 'msec', 'millisecond']),
  unit('time', 1, 's', 'Seconds', ['s', 'sec', 'second']),
  unit('time', 60, 'min', 'Minutes', ['min', 'minute']),
  unit('time', 3600, 'h', 'Hours', ['h', 'hr', 'hour']),
  unit('time', 86_400, 'day', 'Days', ['d', 'day'], { plural: 'days' }),
  unit('time', 604_800, 'week', 'Weeks', ['wk', 'week'], { plural: 'weeks' }),
  // Average Gregorian months and years.
  unit('time', 2_629_746, 'month', 'Months', ['mo', 'month'], { plural: 'months' }),
  unit('time', 31_556_952, 'year', 'Years', ['yr', 'year'], { plural: 'years' }),

  unit('data', 1 / 8, 'bit', 'Bits', ['bit'], { plural: 'bits', exact: ['b'] }),
  unit('data', 1, 'B', 'Bytes', ['byte'], { exact: ['B'] }),
  unit('data', 1e3, 'kB', 'Kilobytes', ['kb', 'kilobyte']),
  unit('data', 1e6, 'MB', 'Megabytes', ['mb', 'megabyte']),
  unit('data', 1e9, 'GB', 'Gigabytes', ['gb', 'gigabyte']),
  unit('data', 1e12, 'TB', 'Terabytes', ['tb', 'terabyte']),
  unit('data', 1e15, 'PB', 'Petabytes', ['pb', 'petabyte']),
  unit('data', 2 ** 10, 'KiB', 'Kibibytes', ['kib', 'kibibyte']),
  unit('data', 2 ** 20, 'MiB', 'Mebibytes', ['mib', 'mebibyte']),
  unit('data', 2 ** 30, 'GiB', 'Gibibytes', ['gib', 'gibibyte']),
  unit('data', 2 ** 40, 'TiB', 'Tebibytes', ['tib', 'tebibyte']),
  unit('data', 2 ** 50, 'PiB', 'Pebibytes', ['pib', 'pebibyte']),
  unit('data', 1e3 / 8, 'kbit', 'Kilobits', ['kbit', 'kilobit'], { exact: ['Kb'] }),
  unit('data', 1e6 / 8, 'Mbit', 'Megabits', ['mbit', 'megabit'], { exact: ['Mb'] }),
  unit('data', 1e9 / 8, 'Gbit', 'Gigabits', ['gbit', 'gigabit'], { exact: ['Gb'] }),
  unit('data', 1e12 / 8, 'Tbit', 'Terabits', ['tbit', 'terabit'], { exact: ['Tb'] }),

  unit('speed', 1, 'm/s', 'Meters per second', ['m/s', 'mps', 'meters per second', 'metres per second']),
  unit('speed', 1 / 3.6, 'km/h', 'Kilometers per hour', [
    'km/h',
    'kmh',
    'kph',
    'kmph',
    'km per hour',
    'kilometers per hour',
    'kilometres per hour',
  ]),
  unit('speed', 0.44704, 'mph', 'Miles per hour', ['mph', 'mi/h', 'miles per hour']),
  unit('speed', 0.3048, 'ft/s', 'Feet per second', ['ft/s', 'feet per second']),
  unit('speed', 1852 / 3600, 'kn', 'Knots', ['kn', 'kt', 'knot']),

  unit('area', 1e-6, 'mm²', 'Square millimeters', ['mm2', 'sq mm', 'square millimeter', 'square millimetre']),
  unit('area', 1e-4, 'cm²', 'Square centimeters', ['cm2', 'sq cm', 'square centimeter', 'square centimetre']),
  unit('area', 1, 'm²', 'Square meters', ['m2', 'sq m', 'sqm', 'square meter', 'square metre']),
  unit('area', 1e4, 'ha', 'Hectares', ['ha', 'hectare']),
  unit('area', 1e6, 'km²', 'Square kilometers', ['km2', 'sq km', 'square kilometer', 'square kilometre']),
  unit('area', 0.00064516, 'in²', 'Square inches', ['in2', 'sq in', 'square inch', 'square inches']),
  unit('area', 0.09290304, 'ft²', 'Square feet', ['ft2', 'sq ft', 'sqft', 'square foot', 'square feet']),
  unit('area', 0.83612736, 'yd²', 'Square yards', ['yd2', 'sq yd', 'square yard']),
  unit('area', 4046.8564224, 'acre', 'Acres', ['ac', 'acre'], { plural: 'acres' }),
  unit('area', 2_589_988.110336, 'mi²', 'Square miles', ['mi2', 'sq mi', 'square mile']),

  unit('pressure', 1, 'Pa', 'Pascals', ['pa', 'pascal']),
  unit('pressure', 1e2, 'hPa', 'Hectopascals', ['hpa', 'hectopascal']),
  unit('pressure', 1e3, 'kPa', 'Kilopascals', ['kpa', 'kilopascal']),
  unit('pressure', 1e6, 'MPa', 'Megapascals', ['mpa', 'megapascal']),
  unit('pressure', 1e5, 'bar', 'Bar', ['bar']),
  unit('pressure', 1e2, 'mbar', 'Millibar', ['mbar', 'millibar']),
  unit('pressure', 6894.757293168, 'psi', 'Pounds per square inch', [
    'psi',
    'lbf/in2',
    'pound per square inch',
    'pounds per square inch',
  ]),
  unit('pressure', 101_325, 'atm', 'Atmospheres', ['atm', 'atmosphere']),
  unit('pressure', 101_325 / 760, 'Torr', 'Torr', ['torr']),
  unit('pressure', 133.322387415, 'mmHg', 'Millimeters of mercury', [
    'mmhg',
    'millimeter of mercury',
    'millimeters of mercury',
    'millimetre of mercury',
    'millimetres of mercury',
  ]),
  unit('pressure', 3386.389, 'inHg', 'Inches of mercury', ['inhg', 'inch of mercury', 'inches of mercury']),

  unit('energy', 1, 'J', 'Joules', ['j', 'joule']),
  unit('energy', 1e3, 'kJ', 'Kilojoules', ['kj', 'kilojoule']),
  unit('energy', 1e6, 'MJ', 'Megajoules', ['mj', 'megajoule']),
  unit('energy', 4.184, 'cal', 'Calories', ['cal', 'calorie']),
  unit('energy', 4184, 'kcal', 'Kilocalories', ['kcal', 'kilocalorie']),
  unit('energy', 3600, 'Wh', 'Watt-hours', ['wh', 'watt hour', 'watt-hour']),
  unit('energy', 3.6e6, 'kWh', 'Kilowatt-hours', ['kwh', 'kilowatt hour', 'kilowatt-hour']),
  unit('energy', 3.6e9, 'MWh', 'Megawatt-hours', ['mwh', 'megawatt hour', 'megawatt-hour']),
  unit('energy', 1055.05585262, 'BTU', 'British thermal units', ['btu', 'british thermal unit']),
  unit('energy', 1.602176634e-19, 'eV', 'Electronvolts', ['ev', 'electronvolt', 'electron volt']),

  unit('power', 1, 'W', 'Watts', ['w', 'watt']),
  unit('power', 1e3, 'kW', 'Kilowatts', ['kw', 'kilowatt']),
  unit('power', 1e6, 'MW', 'Megawatts', ['mw', 'megawatt']),
  unit('power', 745.69987158227, 'hp', 'Horsepower', ['hp', 'bhp', 'horsepower', 'mechanical horsepower']),
  unit('power', 735.49875, 'PS', 'Metric horsepower', ['ps', 'cv', 'metric horsepower']),

  unit('angle', 1, 'rad', 'Radians', ['rad', 'radian']),
  unit('angle', Math.PI / 180, '°', 'Degrees', ['°', 'deg', 'degree']),
  unit('angle', Math.PI / 200, 'grad', 'Gradians', ['grad', 'gon', 'gradian']),
  unit('angle', Math.PI * 2, 'turn', 'Turns', ['turn', 'rev', 'revolution'], { plural: 'turns' }),
  // ′ and ″ are feet and inches too; the caller picks by what they're converted to.
  unit('angle', Math.PI / 10_800, '′', 'Arcminutes', ["'", '′', 'arcmin', 'arcminute', 'minute of arc', 'moa']),
  unit('angle', Math.PI / 648_000, '″', 'Arcseconds', ['"', '″', 'arcsec', 'arcsecond', 'second of arc']),
];

function index(units: readonly Unit[], key: (unit: Unit) => readonly string[]): Map<string, Unit[]> {
  const map = new Map<string, Unit[]>();
  for (const unit of units) {
    for (const alias of key(unit)) map.set(alias, [...(map.get(alias) ?? []), unit]);
  }
  return map;
}

const BY_ALIAS = index(UNITS, (unit) => unit.aliases);
const BY_EXACT = index(UNITS, (unit) => unit.exact ?? []);

/**
 * Tidies a unit as typed for looking up: one space between words, "²" and "^2" as "2", "sq."
 * as "sq", and no "degrees" before a temperature.
 */
export function normalizeUnit(text: string): string {
  return text
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\^?²|\^2/g, '2')
    .replace(/\^?³|\^3/g, '3')
    .replace(/\b(sq|cu|fl|imp)\./gi, '$1')
    .replace(/^deg(ree)?s? (?=\S)/i, '');
}

/**
 * The units `text` can mean, most likely first: "pound" is a mass here and a currency elsewhere,
 * so the caller picks by what it's converted to. Plurals work too ("miles", "lbs").
 */
export function findUnits(text: string): Unit[] {
  const normalized = normalizeUnit(text);
  const exact = BY_EXACT.get(normalized);
  if (exact) return exact;
  const lower = normalized.toLowerCase();
  const found = BY_ALIAS.get(lower);
  if (found) return found;
  // "miles", "hours", "square feet per…" — not "ms", which is a unit of its own above.
  if (lower.length > 2 && lower.endsWith('s')) return BY_ALIAS.get(lower.slice(0, -1)) ?? [];
  return [];
}

/** Converts `value` from one unit to another of the same dimension. */
export function convertUnit(value: number, from: Unit, to: Unit): number {
  const base = value * from.factor + (from.offset ?? 0);
  return (base - (to.offset ?? 0)) / to.factor;
}
