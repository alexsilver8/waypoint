import type { Editor } from '@tiptap/core';
import { dismissInlineMenu, type InlineMatch, inlineMatch, menuPluginKey } from './inline-menu';

/**
 * The inline emoji picker, as in Raycast Notes: a colon at the start of a line or after a
 * space, then two or more letters (:sm, :+1), offers emoji whose name or shortcode starts so.
 * The emoji come from the Emoji extension's data, loaded the first time the picker opens.
 */

export const emojiKey = menuPluginKey('emoji');

export const EMOJI_TRIGGER = /(^|\s):([\p{L}\p{N}_+-]{2,30})$/u;

export interface EmojiEntry {
  emoji: string;
  name: string;
  /** GitHub shortcode without colons, or ''. */
  code: string;
  nameWords: string[];
  tags: string[];
}

const words = (text: string) =>
  text
    .toLowerCase()
    .split(/[^\p{L}\p{N}+-]+/u)
    .filter((word) => word && word !== '-' && word !== '+');

/** The rows of emojis.json: [emoji, name, group, extra search words, shortcode, skin tones]. */
export function toEntries(rows: unknown[][]): EmojiEntry[] {
  return rows.map(([emoji, name, , tags, code]) => ({
    emoji: String(emoji),
    name: String(name),
    code: typeof code === 'string' ? code : '',
    nameWords: words(String(name)),
    tags: words(typeof tags === 'string' ? tags : ''),
  }));
}

let loading: Promise<EmojiEntry[]> | undefined;

export function loadEmoji(): Promise<EmojiEntry[]> {
  loading ??= import('../../../../extensions/emoji/emojis.json').then((data) =>
    toEntries((data.default as { emojis: unknown[][] }).emojis),
  );
  return loading;
}

/** Emoji for what's typed after the colon, best first: shortcodes, then names, then other words. */
export function searchEmoji(entries: EmojiEntry[], query: string, limit = 8): EmojiEntry[] {
  const terms = words(query.replace(/_/g, ' '));
  const whole = query.toLowerCase();
  if (terms.length === 0) return [];
  const scored: Array<{ entry: EmojiEntry; score: number; order: number }> = [];
  entries.forEach((entry, order) => {
    let score = entry.code === whole ? 20 : entry.code.startsWith(whole) ? 12 : 0;
    for (const term of terms) {
      if (entry.nameWords.includes(term)) score += 8;
      else if (entry.nameWords.some((word) => word.startsWith(term))) score += 6;
      else if (entry.tags.some((tag) => tag.startsWith(term))) score += 3;
      else if (!entry.code.startsWith(whole)) return;
    }
    scored.push({ entry, score, order });
  });
  return scored
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .slice(0, limit)
    .map(({ entry }) => entry);
}

export function emojiState(editor: Editor): InlineMatch | null {
  return inlineMatch(editor, emojiKey);
}

export function dismissEmoji(editor: Editor): void {
  dismissInlineMenu(editor, emojiKey);
}
