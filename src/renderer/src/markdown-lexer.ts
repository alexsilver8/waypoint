/**
 * Markdown parsed by `marked`, with a limit on how much work it may do, so no page takes long to
 * draw however it's written. Two kinds of text make `marked` slow, seconds for a page, because it
 * parses some of it again for everything it could turn out to be:
 *
 * - Quotes and lists nested in each other (`> - > - …`): each level parses all it holds again.
 *   Past `MAX_DEPTH` levels, what's inside shows as written.
 * - Inline text full of delimiters (`_a_a_a…`, `` `a`a`a… ``, `[a]([a](…`): for each one it looks
 *   through the rest of the paragraph for where it ends. That work is about the paragraph's length
 *   times its punctuation, counted across the page; a paragraph that would take the count past
 *   `INLINE_BUDGET` shows as written.
 *
 * Ordinary pages come nowhere near either: all of Waypoint's README counts about 1,000,000.
 */
import { Lexer, type Token, type Tokens, type TokensList } from 'marked';

const MAX_DEPTH = 16;
const INLINE_BUDGET = 20_000_000;

function isPunctuation(code: number): boolean {
  return (
    (code >= 33 && code <= 47) ||
    (code >= 58 && code <= 64) ||
    (code >= 91 && code <= 96) ||
    (code >= 123 && code <= 126)
  );
}

/** About how much work parsing `text` inline is, at worst. */
export function inlineCost(text: string): number {
  let punctuation = 0;
  for (let i = 0; i < text.length; i++) if (isPunctuation(text.charCodeAt(i))) punctuation++;
  return text.length * (punctuation + 1);
}

const asText = (text: string): Tokens.Text => ({ type: 'text', raw: text, text });

class BoundedLexer extends Lexer {
  private depth = 0;
  private inlineDepth = 0;
  private spent = 0;

  override blockTokens(src: string, tokens?: Token[], lastParagraphClipped?: boolean): Token[];
  override blockTokens(src: string, tokens?: TokensList, lastParagraphClipped?: boolean): TokensList;
  override blockTokens(src: string, tokens: Token[] = [], lastParagraphClipped = false): Token[] {
    if (this.depth >= MAX_DEPTH) {
      tokens.push({ type: 'paragraph', raw: src, text: src, tokens: [asText(src)] } satisfies Tokens.Paragraph);
      return tokens;
    }
    this.depth++;
    try {
      return super.blockTokens(src, tokens, lastParagraphClipped);
    } finally {
      this.depth--;
    }
  }

  override inlineTokens(src: string, tokens: Token[] = []): Token[] {
    // Emphasis, links and the like parse what's in them again; that's counted with their paragraph.
    if (this.inlineDepth === 0) {
      const cost = inlineCost(src);
      if (this.spent + cost > INLINE_BUDGET) {
        tokens.push(asText(src));
        return tokens;
      }
      this.spent += cost;
    }
    this.inlineDepth++;
    try {
      return super.inlineTokens(src, tokens);
    } finally {
      this.inlineDepth--;
    }
  }
}

/** CommonMark with GitHub's tables, task lists and strikethrough, as tokens to draw. */
export function parseMarkdown(source: string): Token[] {
  try {
    return new BoundedLexer({ gfm: true }).lex(source);
  } catch {
    // Should never happen, but a page that shows as written beats one that doesn't show at all.
    return [{ type: 'paragraph', raw: source, text: source, tokens: [asText(source)] }];
  }
}
