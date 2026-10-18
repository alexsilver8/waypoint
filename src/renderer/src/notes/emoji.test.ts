import { describe, expect, it } from 'vitest';
import data from '../../../../extensions/emoji/emojis.json';
import { EMOJI_TRIGGER, searchEmoji, toEntries } from './emoji';
import { matchAtEnd } from './inline-menu';

const entries = toEntries((data as { emojis: unknown[][] }).emojis);
// Emoji presentation selectors (U+FE0F) aside, which the data keeps.
const find = (query: string) => searchEmoji(entries, query).map((entry) => entry.emoji.replace(/\uFE0F/g, ''));

describe('searchEmoji', () => {
  it('finds emoji by shortcode first, then by name', () => {
    expect(find('smile')[0]).toBe('😄');
    expect(find('+1')[0]).toBe('👍');
    expect(find('tada')[0]).toBe('🎉');
    expect(find('rocket')).toContain('🚀');
  });

  it('matches the start of words', () => {
    expect(find('hear')).toContain('❤');
    expect(find('zzzzzz')).toEqual([]);
  });
});

describe('the emoji trigger', () => {
  it('opens for a colon and two letters at the start of a line or after a space', () => {
    expect(matchAtEnd(':sm', EMOJI_TRIGGER)).toEqual({ offset: 0, query: 'sm' });
    expect(matchAtEnd('nice :+1', EMOJI_TRIGGER)).toEqual({ offset: 5, query: '+1' });
  });

  it('leaves times, URLs and one letter alone', () => {
    expect(matchAtEnd('at 10:30', EMOJI_TRIGGER)).toBeNull();
    expect(matchAtEnd('https://x', EMOJI_TRIGGER)).toBeNull();
    expect(matchAtEnd(':s', EMOJI_TRIGGER)).toBeNull();
  });
});
