// MDN Web Docs: search the docs as you type and open the page. Also offered under
// "Use “…” with", so anything typed into the launcher can be looked up.
import { parseResults, searchUrl } from './mdn.js';

/** @typedef {import('@waypoint/api').Extension} Extension */
/** @typedef {import('@waypoint/api').ExtensionContext} Context */
/** @typedef {import('@waypoint/api').ListView} ListView */
/** @typedef {import('./mdn.js').Doc} Doc */

const PLACEHOLDER = 'Search MDN Web Docs…';
const TIMEOUT_MS = 6000;
/** @type {Map<string, Doc[]>} */
const cache = new Map();

/**
 * @param {string} query
 * @returns {Promise<Doc[]>}
 */
async function search(query) {
  const key = query.trim().toLowerCase();
  const cached = cache.get(key);
  if (cached) return cached;
  const response = await fetch(searchUrl(query), {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`MDN answered ${response.status}`);
  const docs = parseResults(await response.json());
  if (cache.size > 100) cache.clear();
  cache.set(key, docs);
  return docs;
}

/**
 * @param {Context} ctx
 * @returns {Promise<ListView>}
 */
async function searchView(ctx) {
  const query = (ctx.query || ctx.argument || '').trim();
  const base = { type: /** @type {const} */ ('list'), title: 'MDN', searchPlaceholder: PLACEHOLDER, filtering: false };
  if (!query) return { ...base, emptyText: 'Type to search MDN Web Docs.', sections: [] };

  /** @type {Doc[]} */
  let docs = [];
  let problem = '';
  try {
    docs = await search(query);
  } catch (error) {
    problem =
      error instanceof Error && error.name === 'TimeoutError'
        ? "MDN didn't answer in time. Check your connection and try again."
        : `Couldn't search MDN: ${error instanceof Error ? error.message : String(error)}`;
  }

  return {
    ...base,
    emptyText: problem || `Nothing on MDN for “${query}”.`,
    sections: [
      {
        items: docs.map((doc) => ({
          id: doc.url,
          title: doc.title,
          subtitle: doc.area,
          icon: { builtin: 'globe', tint: 'blue' },
          detail: {
            title: doc.title,
            body: doc.summary || 'No summary for this page.',
            metadata: [
              { label: 'Section', value: doc.area || 'MDN' },
              { label: 'Page', value: doc.url.replace(/^https:\/\//, '') },
            ],
          },
          actions: [
            { type: 'open-url', url: doc.url, title: 'Open in Browser' },
            { type: 'copy', text: doc.url, title: 'Copy URL' },
            {
              type: 'copy',
              text: `[${doc.title}](${doc.url})`,
              title: 'Copy as Markdown Link',
              shortcut: { key: 'c', modifiers: ['mod', 'shift'] },
            },
          ],
        })),
      },
    ],
  };
}

/** @type {Extension} */
export default {
  commands: {
    search: { view: searchView },
  },
};
