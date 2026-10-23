/**
 * Conversions for the inline calculator: "5 km to mi", "72 f in c", "3 ft 4 in to cm",
 * "€50 to gbp". The amount can be a calculation ("2*5 km to mi"). Only something with a number
 * and known units on both sides counts, so "go to mail" is still a search.
 */

import { evaluate, formatResult } from './calculator';
import { type Currency, convertCurrency, type ExchangeRates, findCurrency, LEADING_SYMBOL } from './currencies';
import { convertUnit, findUnits, type Unit } from './units';

export type Measure = Unit | Currency;

export interface Conversion {
  amount: number;
  from: Measure;
  to: Measure;
}

/** "to", "in", "into", "as" between words, or "=". */
const CONNECTOR = /\s+(?:to|in|into|as)\s+|\s*=\s*/gi;

/** Where a unit can start: not a digit, space or operator, nor partway through a word. */
const NOT_A_UNIT = /[\d\s.+\-*/%^!(),×÷−]/;

/** One part of "3 ft 4 in" or "1 h 30 min": a plain number and a unit. */
const PART = /(\d+(?:\.\d+)?|\.\d+)\s*([^\d\s.][^\d]*?)\s*(?=\d|\.\d|$)/y;

function measures(text: string): Measure[] {
  const currency = findCurrency(text);
  return currency ? [...findUnits(text), currency] : findUnits(text);
}

/** "2*5 km": the longest unit at the end that leaves a number or calculation before it. */
function single(text: string): { amount: number; units: Measure[] } | null {
  for (let i = 1; i < text.length; i++) {
    if (NOT_A_UNIT.test(text[i] as string) || /\p{L}/u.test(text[i - 1] as string)) continue;
    const units = measures(text.slice(i));
    if (units.length === 0) continue;
    const before = text.slice(0, i);
    const amount = /\d/.test(before) ? evaluate(before) : null;
    if (amount !== null) return { amount, units };
  }
  return null;
}

/** "3 ft 4 in": the parts added up, in the last part's unit. Not for temperatures. */
function compound(text: string): { amount: number; units: Measure[] } | null {
  const parts: { value: number; units: Unit[] }[] = [];
  PART.lastIndex = 0;
  for (let match = PART.exec(text); match; match = PART.exec(text)) {
    parts.push({ value: Number(match[1]), units: findUnits(match[2] as string) });
    if (PART.lastIndex === text.length) break;
  }
  if (parts.length < 2 || PART.lastIndex !== text.length) return null;
  for (const { dimension } of parts[0]?.units ?? []) {
    if (dimension === 'temperature') continue;
    const units = parts.map((part) => part.units.find((unit) => unit.dimension === dimension));
    if (units.some((unit) => !unit)) continue;
    const last = units[units.length - 1] as Unit;
    const base = parts.reduce((sum, part, i) => sum + part.value * (units[i] as Unit).factor, 0);
    return { amount: base / last.factor, units: [last] };
  }
  return null;
}

function quantity(text: string): { amount: number; units: Measure[] } | null {
  const trimmed = text.trim();
  // "€50" reads as "50 €".
  const symbol = LEADING_SYMBOL.exec(trimmed)?.[0];
  const reordered = symbol ? `${trimmed.slice(symbol.length)} ${symbol}` : trimmed;
  return single(reordered) ?? compound(reordered);
}

/** What `input` asks to convert, or `null` if it isn't a conversion. */
export function parseConversion(input: string): Conversion | null {
  const text = input.trim();
  if (!/\d/.test(text)) return null;
  CONNECTOR.lastIndex = 0;
  // Every place a connector could split it, as "5 in in cm" has two.
  let match = CONNECTOR.exec(text);
  while (match) {
    const left = quantity(text.slice(0, match.index));
    const targets = left ? measures(text.slice(match.index + match[0].length)) : [];
    for (const from of left?.units ?? []) {
      const to = targets.find((target) => target.dimension === from.dimension);
      if (left && to) return { amount: left.amount, from, to };
    }
    CONNECTOR.lastIndex = match.index + 1;
    match = CONNECTOR.exec(text);
  }
  return null;
}

/** The converted amount, or `null` for currencies without rates for both. */
export function convert({ amount, from, to }: Conversion, rates: ExchangeRates | null): number | null {
  if (from.dimension === 'currency' || to.dimension === 'currency') {
    if (from.dimension !== 'currency' || to.dimension !== 'currency' || !rates) return null;
    return convertCurrency(amount, from, to, rates);
  }
  return convertUnit(amount, from, to);
}

/**
 * Formats a converted amount like the calculator, but to two decimals (always two for money), or
 * three significant digits below 0.1, since conversions are rarely exact.
 */
export function formatAmount(value: number, measure: Measure, useGrouping = true): string {
  if (Math.abs(value) >= 1e21 || (value !== 0 && Math.abs(value) < 1e-9)) return formatResult(value);
  const money = measure.dimension === 'currency';
  const options: Intl.NumberFormatOptions =
    value === 0 || Math.abs(value) >= 0.1
      ? { maximumFractionDigits: 2, minimumFractionDigits: money ? 2 : 0 }
      : { maximumSignificantDigits: 3 };
  return value.toLocaleString('en-US', { ...options, useGrouping });
}

/** Symbols written against the number: "90°", "30′". */
const ATTACHED = /^[°′″]$/;

/** The unit to write after `formatted`: "3.11 mi", "2 cups", "86.20 EUR", "90°". */
export function withUnit(formatted: string, measure: Measure): string {
  if (measure.dimension === 'currency') return `${formatted} ${measure.code}`;
  const plural = measure.plural && formatted !== '1' ? measure.plural : measure.symbol;
  return ATTACHED.test(plural) ? `${formatted}${plural}` : `${formatted} ${plural}`;
}
