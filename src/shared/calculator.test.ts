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
    ['15% of 80', 12],
    ['15 % of 80', 12],
    ['12.5% of 80', 10],
    ['15% of (60 + 20)', 12],
    ['80 + 15%', 92],
    ['80 - 20%', 64],
    ['100 - 20% + 5', 85],
    ['200 + 10% - 10%', 198],
    ['(80 + 15%) * 2', 184],
    ['20% off 80', 64],
    ['20% off 80 + 1', 65],
    ['80 * 15%', 12],
    ['15% * 80', 12],
    ['50%', 0.5],
    ['100%', 1],
    ['-50%', -0.5],
    ['10% of 20% of 500', 10],
    ['15% of 80 * 2', 24],
    ['20% off 10% off 100', 72],
    // A number after the % keeps it the remainder.
    ['10 % 3', 1],
    ['10 % 3 + 1', 2],
    ['2 ^ 3 % 5', 3],
    ['10 % (3)', 1],
    ['10 % pi', 10 % Math.PI],
  ])('%s = %d (percentages)', (input, expected) => {
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
    ['%'],
    ['% of 80'],
    ['15% of'],
    ['15 of 80'],
    ['of 80'],
    ['80 off 20%'],
    ['50% off'],
    ['out of office 2'],
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
