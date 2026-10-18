import { fuzzyMatch } from './fuzzy';

export interface Searchable {
  title: string;
  keywords?: string[];
  /** A command's alias (see `command-aliases.ts`), lowercase. */
  alias?: string;
}

export interface Ranked<T> {
  item: T;
  score: number;
  /** Matched indices in `item.title`, for highlighting. */
  titlePositions: number[];
}

const EXACT_BONUS = 4;
const PREFIX_BONUS = 2;
const KEYWORD_WEIGHT = 0.8;
const MULTI_WORD_WEIGHT = 0.9;
/** Typing an alias whole puts its command first, ahead of any title or keyword, however used. */
const ALIAS_EXACT_SCORE = 1000;
/** Part of one counts as much as an exact title match would, plus a little. */
const ALIAS_PREFIX_BONUS = EXACT_BONUS + 1;

interface TextScore {
  score: number;
  positions: number[];
}

function scoreText(query: string, text: string): TextScore | null {
  const match = fuzzyMatch(query, text);
  if (!match) return null;
  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  let score = match.score;
  if (lowerText === lowerQuery) score += EXACT_BONUS;
  else if (lowerText.startsWith(lowerQuery)) score += PREFIX_BONUS;
  return { score, positions: match.positions };
}

/**
 * Long or multi-line keywords are content (a note's text, a copied paragraph), where loose fuzzy matching
 * finds letters scattered across sentences. Those match only when every word of the query
 * appears in them, and rank below good title matches.
 */
const CONTENT_LENGTH = 64;
const CONTENT_SCORE = 1;
const CONTENT_WORD_START_BONUS = 0.25;

function contentScore(query: string, content: string): number | null {
  const haystack = content.toLowerCase();
  let score = CONTENT_SCORE;
  for (const word of query.toLowerCase().split(/\s+/).filter(Boolean)) {
    const at = haystack.indexOf(word);
    if (at === -1) return null;
    if (at === 0 || /[\s\-_/.,;:([]/.test(haystack[at - 1] as string)) score += CONTENT_WORD_START_BONUS;
  }
  return score;
}

function bestKeywordScore(query: string, keywords: readonly string[]): number | null {
  let best: number | null = null;
  for (const keyword of keywords) {
    let score: number | null;
    if (keyword.length > CONTENT_LENGTH || keyword.includes('\n')) {
      score = contentScore(query, keyword);
    } else {
      const result = scoreText(query, keyword);
      score = result ? result.score * KEYWORD_WEIGHT : null;
    }
    if (score !== null && (best === null || score > best)) best = score;
  }
  return best;
}

/**
 * How well the query matches an alias: whole, or its start. Aliases are short words picked on
 * purpose, so letters scattered through one don't count.
 */
function aliasScore(query: string, alias: string | undefined): number | null {
  if (!alias) return null;
  const lowerQuery = query.toLowerCase();
  if (lowerQuery === alias) return ALIAS_EXACT_SCORE;
  if (!alias.startsWith(lowerQuery)) return null;
  return (fuzzyMatch(query, alias)?.score ?? 0) + ALIAS_PREFIX_BONUS;
}

/** Scores one item against the query, or returns `null` if it doesn't match. */
export function scoreItem(query: string, item: Searchable): { score: number; titlePositions: number[] } | null {
  const q = query.trim();
  if (!q) return { score: 0, titlePositions: [] };
  const keywords = item.keywords ?? [];

  const alias = aliasScore(q, item.alias);
  if (alias !== null) {
    // The title is highlighted when it matches as well, but the alias decides the rank.
    const title = scoreText(q, item.title);
    if (!title || title.score < alias) return { score: alias, titlePositions: title?.positions ?? [] };
  }

  const title = scoreText(q, item.title);
  const keyword = bestKeywordScore(q, keywords);
  if (title && (keyword === null || title.score >= keyword)) {
    return { score: title.score, titlePositions: title.positions };
  }
  if (keyword !== null) return { score: keyword, titlePositions: [] };

  // "chrome google" should still find "Google Chrome": every word has to match the
  // title or a keyword, in any order.
  const words = q.split(/\s+/);
  if (words.length < 2) return null;
  let total = 0;
  const positions = new Set<number>();
  for (const word of words) {
    const wordTitle = scoreText(word, item.title);
    const wordKeyword = bestKeywordScore(word, keywords);
    if (!wordTitle && wordKeyword === null) return null;
    if (wordTitle && (wordKeyword === null || wordTitle.score >= wordKeyword)) {
      total += wordTitle.score;
      for (const p of wordTitle.positions) positions.add(p);
    } else {
      total += wordKeyword as number;
    }
  }
  return { score: total * MULTI_WORD_WEIGHT, titlePositions: [...positions].sort((a, b) => a - b) };
}

/**
 * Filters and sorts items by how well they match the query. `boost` adds to an item's
 * score, e.g. to favour frequently used items. With an empty query every item is kept
 * in its original order.
 */
export function rankItems<T extends Searchable>(
  items: readonly T[],
  query: string,
  boost?: (item: T) => number,
): Ranked<T>[] {
  if (!query.trim()) return items.map((item) => ({ item, score: 0, titlePositions: [] }));

  const ranked: Ranked<T>[] = [];
  for (const item of items) {
    const result = scoreItem(query, item);
    if (result)
      ranked.push({ item, score: result.score + (boost?.(item) ?? 0), titlePositions: result.titlePositions });
  }
  ranked.sort((a, b) => b.score - a.score || a.item.title.localeCompare(b.item.title));
  return ranked;
}
