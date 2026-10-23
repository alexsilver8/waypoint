/**
 * A small, safe arithmetic evaluator for the inline calculator (no `eval`).
 *
 * Supports + - * / % ^ (power), ! (factorial), parentheses, implicit multiplication
 * ("2pi", "3(4+1)"), × and ÷, constants (pi, e, tau) and common functions
 * (sqrt, cbrt, abs, round, floor, ceil, exp, ln, log, log2, sin, cos, tan, asin,
 * acos, atan, min, max).
 *
 * A `%` with a number after it is the remainder ("10 % 3"); anywhere else it's a percentage:
 * "15% of 80", "20% off 80", "80 + 15%" and "80 - 20%" (a share of what comes before),
 * "80 * 15%" and "50%" on its own.
 */

type Token = { kind: 'number'; value: number } | { kind: 'ident'; value: string } | { kind: 'op'; value: string };

/** Words that follow a percentage rather than start a value of their own. */
const PERCENT_WORDS = new Set(['of', 'off']);

const CONSTANTS: Record<string, number> = { pi: Math.PI, π: Math.PI, e: Math.E, tau: Math.PI * 2 };

const FUNCTIONS: Record<string, (...args: number[]) => number> = {
  sqrt: Math.sqrt,
  cbrt: Math.cbrt,
  abs: Math.abs,
  round: Math.round,
  floor: Math.floor,
  ceil: Math.ceil,
  exp: Math.exp,
  ln: Math.log,
  log: Math.log10,
  log2: Math.log2,
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  min: Math.min,
  max: Math.max,
};

class ParseError extends Error {}

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < input.length) {
    const ch = input[i] as string;
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    const number = /^(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?/.exec(input.slice(i));
    if (number) {
      tokens.push({ kind: 'number', value: Number(number[0]) });
      i += number[0].length;
      continue;
    }
    const ident = /^[a-zA-Zπ][a-zA-Z0-9]*/.exec(input.slice(i));
    if (ident) {
      tokens.push({ kind: 'ident', value: ident[0].toLowerCase() });
      i += ident[0].length;
      continue;
    }
    if ('+-*/%^!(),'.includes(ch)) {
      tokens.push({ kind: 'op', value: ch });
    } else if (ch === '×') {
      tokens.push({ kind: 'op', value: '*' });
    } else if (ch === '÷') {
      tokens.push({ kind: 'op', value: '/' });
    } else if (ch === '−') {
      tokens.push({ kind: 'op', value: '-' });
    } else {
      throw new ParseError(`Unexpected character "${ch}"`);
    }
    i++;
  }
  return tokens;
}

function factorial(n: number): number {
  if (!Number.isInteger(n) || n < 0) throw new ParseError('Factorial needs a non-negative integer');
  if (n > 170) return Number.POSITIVE_INFINITY;
  let result = 1;
  for (let k = 2; k <= n; k++) result *= k;
  return result;
}

class Parser {
  private pos = 0;
  /** Set once something other than a bare number or constant was evaluated. */
  hasOperation = false;
  /**
   * Whether what was last parsed is a percentage on its own ("15%", not "15% of 80" or
   * "2 * 15%"), which "+" and "-" then take as a share of what comes before them.
   */
  private percent = false;

  constructor(private readonly tokens: Token[]) {}

  parse(): number {
    const value = this.expression();
    if (this.pos < this.tokens.length) throw new ParseError('Unexpected input');
    return value;
  }

  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }

  private isOp(value: string): boolean {
    const token = this.peek();
    return token?.kind === 'op' && token.value === value;
  }

  private isWord(value: string): boolean {
    const token = this.peek();
    return token?.kind === 'ident' && token.value === value;
  }

  private expect(value: string): void {
    if (!this.isOp(value)) throw new ParseError(`Expected "${value}"`);
    this.pos++;
  }

  /** Whether `token` begins a value: a number, a name or a parenthesis, but not "of" or "off". */
  private startsValue(token: Token | undefined): boolean {
    if (!token) return false;
    if (token.kind === 'number') return true;
    if (token.kind === 'ident') return !PERCENT_WORDS.has(token.value);
    return token.value === '(';
  }

  // expression := term (("+" | "-") term)*
  private expression(): number {
    let value = this.term();
    while (this.isOp('+') || this.isOp('-')) {
      const op = (this.tokens[this.pos++] as Token).value;
      const right = this.term();
      // "80 + 15%" is 80 and 15% of it; "80 - 20%" is 80 less 20% of it.
      const change = this.percent ? value * right : right;
      value = op === '+' ? value + change : value - change;
      this.hasOperation = true;
    }
    return value;
  }

  // term := unary (("*" | "/" | "%") unary | implicit-multiplication unary)* | percentage ("of" | "off") term
  private term(): number {
    let value = this.unary();
    let percent = this.percent;
    for (;;) {
      // "15% of 80" and "20% off 80", of everything up to the next + or -: "10% of 20% of 500".
      if (percent && this.isWord('of')) {
        this.pos++;
        value *= this.term();
        percent = false;
        continue;
      }
      if (percent && this.isWord('off')) {
        this.pos++;
        value = this.term() * (1 - value);
        percent = false;
        continue;
      }
      if (this.isOp('*') || this.isOp('/') || this.isOp('%')) {
        const op = (this.tokens[this.pos++] as Token).value;
        const right = this.unary();
        value = op === '*' ? value * right : op === '/' ? value / right : value % right;
        this.hasOperation = true;
        percent = false;
        continue;
      }
      const next = this.peek();
      // Implicit multiplication ("2pi", "3(4 + 1)") — but not between two bare numbers.
      if (next && (next.kind === 'ident' || (next.kind === 'op' && next.value === '('))) {
        value *= this.unary();
        this.hasOperation = true;
        percent = false;
        continue;
      }
      this.percent = percent;
      return value;
    }
  }

  // unary := ("-" | "+") unary | power
  private unary(): number {
    if (this.isOp('-')) {
      this.pos++;
      return -this.unary();
    }
    if (this.isOp('+')) {
      this.pos++;
      return this.unary();
    }
    return this.power();
  }

  // power := postfix ("^" unary)?     (right-associative, binds tighter than unary minus on its left)
  private power(): number {
    const base = this.postfix();
    if (this.isOp('^')) {
      this.pos++;
      this.hasOperation = true;
      const value = base ** this.unary();
      this.percent = false;
      return value;
    }
    return base;
  }

  // postfix := primary ("!" | "%")*     (a "%" with a value after it is the remainder, read by `term`)
  private postfix(): number {
    let value = this.primary();
    let percent = false;
    for (;;) {
      if (this.isOp('!')) {
        this.pos++;
        value = factorial(value);
        percent = false;
      } else if (this.isOp('%') && !this.startsValue(this.tokens[this.pos + 1])) {
        this.pos++;
        value /= 100;
        percent = true;
      } else {
        break;
      }
      this.hasOperation = true;
    }
    this.percent = percent;
    return value;
  }

  // primary := number | constant | function "(" args ")" | "(" expression ")"
  private primary(): number {
    const token = this.peek();
    if (!token) throw new ParseError('Unexpected end of input');

    if (token.kind === 'number') {
      this.pos++;
      return token.value;
    }

    if (token.kind === 'ident') {
      this.pos++;
      const fn = FUNCTIONS[token.value];
      if (fn && this.isOp('(')) {
        this.pos++;
        const args = [this.expression()];
        while (this.isOp(',')) {
          this.pos++;
          args.push(this.expression());
        }
        this.expect(')');
        this.hasOperation = true;
        return fn(...args);
      }
      const constant = CONSTANTS[token.value];
      if (constant !== undefined) return constant;
      throw new ParseError(`Unknown name "${token.value}"`);
    }

    if (token.value === '(') {
      this.pos++;
      const value = this.expression();
      this.expect(')');
      return value;
    }

    throw new ParseError(`Unexpected "${token.value}"`);
  }
}

/**
 * Evaluates `input` if it is a calculation, or returns `null` if it isn't — including
 * plain numbers and constants on their own, so typing "e" still searches for "Excel".
 */
export function calculate(input: string): number | null {
  return run(input, true);
}

/** Like `calculate`, but a plain number counts too: the amount in "5 km to mi". */
export function evaluate(input: string): number | null {
  return run(input, false);
}

function run(input: string, needsOperation: boolean): number | null {
  const trimmed = input.trim();
  if (!trimmed || !/[\dπ]/.test(trimmed)) return null;
  try {
    const parser = new Parser(tokenize(trimmed));
    const value = parser.parse();
    if ((needsOperation && !parser.hasOperation) || !Number.isFinite(value)) return null;
    // Round away binary floating point noise (0.1 + 0.2 → 0.3) without touching exact integers.
    return Number.isSafeInteger(value) ? value : Number.parseFloat(value.toPrecision(15));
  } catch (error) {
    if (error instanceof ParseError) return null;
    throw error;
  }
}

/** Formats a result for display, with digit grouping. */
export function formatResult(value: number, locale?: string): string {
  if (Math.abs(value) >= 1e21 || (value !== 0 && Math.abs(value) < 1e-9)) return value.toExponential(6);
  return value.toLocaleString(locale ?? 'en-US', { maximumFractionDigits: 10 });
}
