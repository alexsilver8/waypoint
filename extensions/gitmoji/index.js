// Gitmoji: search the gitmoji list and paste an emoji (or its :code:) into a commit message.
// The list comes from the gitmojis package; `pnpm run extensions:data` refreshes it.
import { readFileSync } from 'node:fs';
import { asTitle, searchGitmojis } from './search.js';

/** @typedef {import('@waypoint-org/api').Extension} Extension */
/** @typedef {import('@waypoint-org/api').ExtensionContext} Context */
/** @typedef {import('@waypoint-org/api').ListItem} ListItem */
/** @typedef {import('@waypoint-org/api').ListView} ListView */
/** @typedef {import('./search.js').Gitmoji} Gitmoji */

/** @type {{ gitmojis: Gitmoji[] }} */
const { gitmojis } = JSON.parse(readFileSync(new URL('./gitmojis.json', import.meta.url), 'utf8'));
const byCode = new Map(gitmojis.map((gitmoji) => [gitmoji.code, gitmoji]));
const RECENT_LIMIT = 8;
const SEMVER = { major: 'Major', minor: 'Minor', patch: 'Patch' };

/** @param {Context} ctx @returns {string[]} */
function recentCodes(ctx) {
  const stored = ctx.storage.get('recent');
  return Array.isArray(stored)
    ? stored.flatMap((code) => (typeof code === 'string' && byCode.has(code) ? [code] : []))
    : [];
}

/**
 * @param {Gitmoji} gitmoji
 * @param {string} [prefix] Keeps ids unique when a gitmoji is listed twice.
 * @returns {ListItem}
 */
function toItem(gitmoji, prefix = '') {
  const use = (/** @type {string} */ id, /** @type {string} */ text) => ({ code: gitmoji.code, text, id });
  return {
    id: `${prefix}${gitmoji.name}`,
    title: asTitle(gitmoji.description),
    subtitle: gitmoji.code,
    icon: { emoji: gitmoji.emoji },
    ...(gitmoji.semver
      ? { accessory: SEMVER[/** @type {keyof typeof SEMVER} */ (gitmoji.semver)] ?? gitmoji.semver }
      : {}),
    actions: [
      { type: 'callback', id: 'use', title: 'Paste Emoji', payload: use('paste', gitmoji.emoji) },
      { type: 'callback', id: 'use', title: 'Copy Emoji', payload: use('copy', gitmoji.emoji) },
      {
        type: 'callback',
        id: 'use',
        title: 'Paste Code',
        // No shortcut: a key still held when the paste is typed (⇧) would change what the app does.
        payload: use('paste', gitmoji.code),
      },
      {
        type: 'callback',
        id: 'use',
        title: 'Copy Code',
        payload: use('copy', gitmoji.code),
        shortcut: { key: 'c', modifiers: ['mod', 'shift'] },
      },
    ],
  };
}

/**
 * @param {Context} ctx
 * @returns {ListView}
 */
function searchView(ctx) {
  const query = ctx.query.trim();
  const recent = query ? [] : recentCodes(ctx).flatMap((code) => byCode.get(code) ?? []);
  const matches = searchGitmojis(gitmojis, query);
  return {
    type: 'list',
    title: 'Gitmoji',
    searchPlaceholder: 'Search gitmoji…',
    // Recently used ones come first, so this command does its own searching.
    filtering: false,
    emptyText: `No gitmoji for “${query}”.`,
    sections: [
      { title: 'Recently used', items: recent.map((gitmoji) => toItem(gitmoji, 'recent:')) },
      { title: query ? 'Results' : 'All gitmoji', items: matches.map((gitmoji) => toItem(gitmoji)) },
    ],
  };
}

/** @type {Extension} */
export default {
  commands: {
    search: {
      view: searchView,
      onAction(id, payload, ctx) {
        if (id !== 'use' || typeof payload !== 'object' || payload === null || Array.isArray(payload)) return undefined;
        const { code, text, id: how } = /** @type {{ code: string, text: string, id: string }} */ (payload);
        ctx.storage.set('recent', [code, ...recentCodes(ctx).filter((c) => c !== code)].slice(0, RECENT_LIMIT));
        return how === 'paste' ? { paste: text } : { copy: text };
      },
    },
  },
};
