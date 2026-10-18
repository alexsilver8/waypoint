// Emoji: search every emoji by name, keyword or shortcode in a grid, and paste it. Recently used ones
// come first, and a skin tone you pick applies to every emoji that has one. The names and
// keywords come from emojibase; `pnpm run extensions:data` refreshes them.
import { readFileSync } from 'node:fs';
import { asTitle, codePoints, inTone, loadEmojis, searchEmojis } from './search.js';

/** @typedef {import('@waypoint-org/api').Extension} Extension */
/** @typedef {import('@waypoint-org/api').ExtensionContext} Context */
/** @typedef {import('@waypoint-org/api').ListItem} ListItem */
/** @typedef {import('@waypoint-org/api').ListView} ListView */
/** @typedef {import('@waypoint-org/api').Action} Action */
/** @typedef {import('./search.js').Emoji} Emoji */

const data = JSON.parse(readFileSync(new URL('./emojis.json', import.meta.url), 'utf8'));
/** @type {string[]} */
const groups = data.groups;
const emojis = loadEmojis(data);
const byEmoji = new Map(emojis.map((emoji) => [emoji.emoji, emoji]));
const RECENT_LIMIT = 24;
const TONES = ['Default', 'Light', 'Medium-light', 'Medium', 'Medium-dark', 'Dark'];
const WAVE = byEmoji.get('👋');

/** @param {Context} ctx */
function recentEmojis(ctx) {
  const stored = ctx.storage.get('recent');
  return Array.isArray(stored)
    ? stored.flatMap((emoji) => (typeof emoji === 'string' && byEmoji.get(emoji)) || [])
    : [];
}

/** @param {Context} ctx */
function skinTone(ctx) {
  const tone = ctx.storage.get('tone');
  return typeof tone === 'number' && tone >= 0 && tone <= 5 ? tone : 0;
}

/**
 * @param {Emoji} emoji
 * @returns {Action}
 */
function forgetAction(emoji) {
  return {
    type: 'callback',
    id: 'forget',
    title: 'Remove from Recently Used',
    payload: emoji.emoji,
    style: 'destructive',
    shortcut: { key: 'Backspace', modifiers: ['mod'] },
  };
}

/**
 * @param {Emoji} emoji
 * @param {number} tone
 * @param {{ prefix?: string, recent?: boolean }} [options]
 * @returns {ListItem}
 */
function toItem(emoji, tone, { prefix = '', recent = false } = {}) {
  // Nearly two thousand of these go to the launcher at once, so actions carry just the emoji
  // and onAction works out the rest.
  const base = emoji.emoji;
  return {
    id: `${prefix}${base}`,
    title: asTitle(emoji.name),
    ...(emoji.code ? { subtitle: `:${emoji.code}:` } : {}),
    icon: { emoji: inTone(emoji, tone) },
    actions: [
      { type: 'callback', id: 'paste', title: 'Paste Emoji', payload: base },
      { type: 'callback', id: 'copy', title: 'Copy Emoji', payload: base },
      {
        type: 'callback',
        id: 'name',
        title: 'Copy Name',
        payload: base,
        shortcut: { key: 'c', modifiers: ['mod', 'shift'] },
      },
      { type: 'callback', id: 'points', title: 'Copy Code Points', payload: base },
      {
        type: 'callback',
        id: 'tones',
        title: 'Change Skin Tone…',
        shortcut: { key: 't', modifiers: ['mod', 'shift'] },
      },
      ...(recent ? [forgetAction(emoji)] : []),
    ],
  };
}

/**
 * Each category starts with a taste, four rows of the grid with the cell that opens the rest; the
 * whole of one is a keypress away, and search finds all of them.
 */
const COLUMNS = 8;
const CATEGORY_PREVIEW = COLUMNS * 4 - 1;

/**
 * A row that opens a whole category.
 * @param {number} group
 * @param {number} count
 * @returns {ListItem}
 */
function moreItem(group, count) {
  return {
    id: `more:${group}`,
    title: `All ${count}`,
    icon: { builtin: 'sparkles', tint: 'yellow' },
    actions: [{ type: 'callback', id: 'category', title: 'Show All', payload: group }],
  };
}

/**
 * @param {Context} ctx
 * @param {ListView['sections']} sections
 * @returns {ListView}
 */
function listView(ctx, sections) {
  return {
    type: 'list',
    title: 'Emoji',
    searchPlaceholder: 'Search emoji by name, keyword or :shortcode:…',
    layout: 'grid',
    columns: COLUMNS,
    // Recently used come first and nearly two thousand emoji need a quick search of their own.
    filtering: false,
    emptyText: `No emoji for “${ctx.query.trim()}”.`,
    sections,
  };
}

/**
 * Recently used emoji and a taste of each category; or the best matches for what's typed.
 * @param {Context} ctx
 * @returns {ListView}
 */
function searchView(ctx) {
  const tone = skinTone(ctx);
  const query = ctx.query.trim();
  if (query) {
    return listView(ctx, [
      { title: 'Results', items: searchEmojis(emojis, query).map((emoji) => toItem(emoji, tone)) },
    ]);
  }
  return listView(ctx, [
    {
      title: 'Recently used',
      items: recentEmojis(ctx).map((emoji) => toItem(emoji, tone, { prefix: 'recent:', recent: true })),
    },
    ...groups.map((title, group) => {
      const all = emojis.filter((emoji) => emoji.group === group);
      const items = all.slice(0, CATEGORY_PREVIEW).map((emoji) => toItem(emoji, tone));
      if (all.length > CATEGORY_PREVIEW) items.push(moreItem(group, all.length));
      return { title, items };
    }),
  ]);
}

/**
 * Every emoji in one category.
 * @param {Context} ctx
 * @param {number} group
 * @returns {ListView}
 */
function categoryView(ctx, group) {
  const tone = skinTone(ctx);
  return listView(ctx, [
    {
      title: groups[group],
      items: emojis.filter((emoji) => emoji.group === group).map((emoji) => toItem(emoji, tone)),
    },
  ]);
}

/**
 * The skin tones to pick from, shown with a waving hand.
 * @param {Context} ctx
 * @returns {ListView}
 */
function tonesView(ctx) {
  const current = skinTone(ctx);
  return {
    type: 'list',
    title: 'Skin Tone',
    searchPlaceholder: 'Pick the skin tone emoji should use…',
    sections: [
      {
        items: TONES.map((name, tone) => ({
          id: `tone:${tone}`,
          title: name,
          icon: { emoji: WAVE ? inTone(WAVE, tone) : '👋' },
          ...(tone === current ? { accessory: 'Current' } : {}),
          actions: [{ type: 'callback', id: 'tone', title: 'Use This Skin Tone', payload: tone }],
        })),
      },
    ],
  };
}

/** @type {Extension} */
export default {
  commands: {
    search: {
      view: searchView,
      onAction(id, payload, ctx) {
        const emoji = typeof payload === 'string' ? byEmoji.get(payload) : undefined;
        if ((id === 'paste' || id === 'copy') && emoji) {
          const recent = [
            emoji.emoji,
            ...recentEmojis(ctx)
              .map((e) => e.emoji)
              .filter((e) => e !== emoji.emoji),
          ];
          ctx.storage.set('recent', recent.slice(0, RECENT_LIMIT));
          const text = inTone(emoji, skinTone(ctx));
          return id === 'paste' ? { paste: text } : { copy: text };
        }
        if (id === 'name' && emoji) return { copy: asTitle(emoji.name) };
        if (id === 'points' && emoji) return { copy: codePoints(inTone(emoji, skinTone(ctx))) };
        if (id === 'forget' && typeof payload === 'string') {
          const recent = recentEmojis(ctx)
            .map((e) => e.emoji)
            .filter((e) => e !== payload);
          ctx.storage.set('recent', recent);
          return { replace: searchView(ctx) };
        }
        if (id === 'tones') return { replace: tonesView(ctx), clearSearch: true };
        if (id === 'category' && typeof payload === 'number' && groups[payload]) {
          return { replace: categoryView({ ...ctx, query: '' }, payload), clearSearch: true };
        }
        if (id === 'tone' && typeof payload === 'number') {
          ctx.storage.set('tone', payload);
          return {
            replace: searchView({ ...ctx, query: '' }),
            clearSearch: true,
            toast: `Skin tone: ${TONES[payload]}`,
          };
        }
        return undefined;
      },
    },
  },
};
