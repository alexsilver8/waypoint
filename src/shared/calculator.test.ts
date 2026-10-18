import { describe, expect, it } from 'vitest';
import { calculate, evaluate, formatResult } from './calculator';

describe('calculate', () => {
  it.each([
    ['1 + 2', 3],
    ['2 * 3 + 4', 10],
    ['2 * (3 + 4)', 14],
    ['10 / 4', 2.5],
    ['10 % 4', 2],
    ['2 ^ 10', 1024],
    ['2 ^ 3 ^ 2', 512],
    ['-2 ^ 2', -4],
    ['2 ^ -1', 0.5],
    ['5!', 120],
    ['3 × 4', 12],
    ['8 ÷ 2', 4],
    ['0.1 + 0.2', 0.3],
    ['.5 * 4', 2],
    ['1e3 + 1', 1001],
    ['sqrt(16)', 4],
    ['max(1, 5, 3)', 5],
    ['2pi', Math.PI * 2],
    ['3(4 + 1)', 15],
    ['round(2.5) + floor(1.9)', 4],
    ['log(1000)', 3],
    ['2 ^ 50', 1125899906842624],
    ['18!', 6402373705728000],
    ['1234567890123 + 1', 1234567890124],
  ])('%s = %d', (input, expected) => {
    expect(calculate(input)).toBeCloseTo(expected, 10);
  });

  it.each([
    [''],
    ['42'],
    ['-5'],
    ['e'],
    ['pi'],
    ['excel'],
    ['sin'],
    ['1 +'],
    ['(1 + 2'],
    ['2 apples'],
    ['1.2.3'],
    ['192.168.1.1'],
    ['1 / 0'],
    ['2 3'],
    ['hello 2 + 2'],
  ])('%j is not a calculation', (input) => {
    expect(calculate(input)).toBeNull();
  });
});

describe('evaluate', () => {
  it('takes plain numbers as well as calculations', () => {
    expect(evaluate('42')).toBe(42);
    expect(evaluate('-5')).toBe(-5);
    expect(evaluate('.5')).toBe(0.5);
    expect(evaluate('2 * 5')).toBe(10);
    expect(evaluate('1/2')).toBe(0.5);
  });

  it.each([[''], ['e'], ['pi'], ['5 k'], ['1 +'], ['1 / 0']])('%j is not a number', (input) => {
    expect(evaluate(input)).toBeNull();
  });
});

describe('formatResult', () => {
  it('groups digits', () => {
    expect(formatResult(1234567.5)).toBe('1,234,567.5');
  });

  it('uses exponent notation for very large and very small numbers', () => {
    expect(formatResult(1e25)).toBe('1.000000e+25');
    expect(formatResult(1e-12)).toBe('1.000000e-12');
  });
});
