import { type Searchable, scoreItem } from './search';

export interface TitleAndText {
  /**
   * How well the search matches, the text counting as matched: what the first words score
   * against the title, plus one for each character of the text.
   */
  score: number;
  /** Matched indices in the title, for highlighting. */
  titlePositions: number[];
  /** What was typed after the title. */
  text: string;
}

function isLower(ch: string): boolean {
  return ch !== ch.toUpperCase() && ch === ch.toLowerCase();
}

function isUpper(ch: string): boolean {
  return ch !== ch.toLowerCase() && ch === ch.toUpperCase();
}

/**
 * Whether the matched letters read as the title's start or its initials, as "github", "gh" and
 * "gs" do for "GitHub Search": the first is the title's first, and each one starts a word, is a
 * capital after a small letter, or follows another matched letter. "ih", scattered through it,
 * doesn't, and nor does "search", which starts later on.
 */
export function isAbbreviation(title: string, positions: readonly number[]): boolean {
  if (positions[0] !== 0) return false;
  const matched = new Set(positions);
  return positions.every((p) => {
    const before = title[p - 1];
    const at = title[p] ?? '';
    // The spaces between words in "gh search" match the title's.
    if (before === undefined || matched.has(p - 1) || /\s/.test(at)) return true;
    return /[\s\-_/.([]/.test(before) || (isLower(before) && isUpper(at));
  });
}

/**
 * Reads a search as an item's title followed by some text: "gh waypoint" is GitHub Search with
 * "waypoint". The first words have to be the title's start or its initials (see `isAbbreviation`);
 * of the ways to split the search at a space, the one whose first words match best wins, the longer
 * one on a tie. Returns `null` when no first words fit, or nothing follows them.
 *
 * The text counts as matched in the score, so a quicklink picked by its initials isn't outranked by
 * something that only matches scattered letters of the whole search, while things the whole search
 * names exactly still come first.
 */
export function matchTitleAndText(rawQuery: string, item: Searchable): TitleAndText | null {
  const query = rawQuery.trim();
  let best: { score: number; titlePositions: number[]; text: string } | null = null;
  for (const gap of query.matchAll(/\s+/g)) {
    const head = query.slice(0, gap.index);
    const text = query.slice(gap.index + gap[0].length);
    const match = scoreItem(head, item);
    if (!match || !isAbbreviation(item.title, match.titlePositions)) continue;
    if (!best || match.score >= best.score) best = { score: match.score, titlePositions: match.titlePositions, text };
  }
  return best && { ...best, score: best.score + best.text.length };
}
