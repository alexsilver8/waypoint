import { Lexer, type Token } from 'marked';
import { describe, expect, it } from 'vitest';
import contributing from '../../../CONTRIBUTING.md?raw';
import extensionDocs from '../../../docs/extensions.md?raw';
import readme from '../../../README.md?raw';
import { MAX_MARKDOWN } from '../../shared/markdown-limits';
import { inlineCost, parseMarkdown } from './markdown-lexer';

/** Text that once took `marked` seconds to parse, each repeated to the longest a page may be. */
const SLOW = [
  '_a',
  '*a',
  '`a',
  '[a](',
  '\\_',
  '*_',
  '[a]',
  '> - ',
  '- > ',
  '> ',
  '>',
  '1. ',
  '+ ',
  '- a\n  - ',
  '- a\n',
  '|-|\n',
  'a\n=\n',
];

/** Generous, so a busy machine doesn't fail it; without the limits most of these take seconds. */
const BUDGET_MS = 750;

const repeated = (unit: string) => unit.repeat(Math.ceil(MAX_MARKDOWN / unit.length)).slice(0, MAX_MARKDOWN);

function depth(tokens: Token[] | undefined): number {
  let deepest = 0;
  for (const token of tokens ?? []) {
    const inside = 'items' in token ? (token.items as Token[]) : 'tokens' in token ? token.tokens : undefined;
    deepest = Math.max(deepest, (token.type === 'blockquote' || token.type === 'list' ? 1 : 0) + depth(inside));
  }
  return deepest;
}

describe('parseMarkdown', () => {
  it.each(SLOW)('parses a page of %j quickly', (unit) => {
    const source = repeated(unit);
    const start = performance.now();
    const tokens = parseMarkdown(source);
    expect(performance.now() - start).toBeLessThan(BUDGET_MS);
    expect(tokens.length).toBeGreaterThan(0);
  });

  it('parses real pages exactly as marked does', () => {
    for (const [name, source] of Object.entries({ readme, extensionDocs, contributing })) {
      expect(source.length, name).toBeGreaterThan(1000);
      expect(parseMarkdown(source), name).toEqual(new Lexer({ gfm: true }).lex(source));
    }
  });

  it('shows quotes and lists nested too deep as written', () => {
    const tokens = parseMarkdown(`${'> '.repeat(40)}*deep*`);
    expect(depth(tokens)).toBeLessThanOrEqual(16);
    expect(JSON.stringify(tokens)).toContain('*deep*');
    expect(depth(parseMarkdown(`${'> '.repeat(5)}*five*`))).toBe(5);
  });

  it('shows a paragraph that would take too long to parse as written, and parses the rest', () => {
    // 10,000 characters, half of them punctuation.
    const slow = '_a'.repeat(5_000);
    expect([...parseMarkdown(`*em*\n\n${slow}\n\n**bold**`)]).toMatchObject([
      { type: 'paragraph', tokens: [{ type: 'em' }] },
      { type: 'space' },
      { type: 'paragraph', tokens: [{ type: 'text', text: slow }] },
      { type: 'space' },
      { type: 'paragraph', tokens: [{ type: 'strong' }] },
    ]);
  });
});

describe('inlineCost', () => {
  it('grows with the length and the punctuation', () => {
    expect(inlineCost('')).toBe(0);
    expect(inlineCost('plain words')).toBe(11);
    expect(inlineCost('_a_')).toBe(9);
  });
});
