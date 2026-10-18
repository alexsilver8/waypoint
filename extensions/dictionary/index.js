// Dictionary: type an English word for its definitions, examples and synonyms, from Wiktionary
// through the Free Dictionary API. Also offered under "Use “…” with". On macOS a definition
// opens in the Dictionary app too.
import { capitalise, lookupUrl, parseEntries, wordToLookUp } from './dictionary.js';

/** @typedef {import('@waypoint-org/api').Extension} Extension */
/** @typedef {import('@waypoint-org/api').ExtensionContext} Context */
/** @typedef {import('@waypoint-org/api').ListItem} ListItem */
/** @typedef {import('@waypoint-org/api').ListView} ListView */
/** @typedef {import('@waypoint-org/api').Action} Action */
/** @typedef {import('./dictionary.js').Entry} Entry */

const TIMEOUT_MS = 6000;
/** Waits until typing stops, so half-typed words aren't looked up. */
const SETTLE_MS = 250;

/** Words looked up already; `null` for words with no definition. @type {Map<string, Entry | null>} */
const cache = new Map();
let latestRequest = 0;

/**
 * @param {string} word
 * @returns {Promise<Entry | null>}
 */
async function lookUp(word) {
  const key = word.toLowerCase();
  const cached = cache.get(key);
  if (cached !== undefined) return cached;
  const response = await fetch(lookupUrl(word), {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  // It answers 404, with a message, for words it doesn't have.
  if (response.status === 404) {
    cache.set(key, null);
    return null;
  }
  if (!response.ok) throw new Error(`The dictionary answered ${response.status}`);
  const entry = parseEntries(await response.json()) ?? null;
  if (cache.size > 200) cache.clear();
  cache.set(key, entry);
  return entry;
}

/**
 * @param {Entry} entry
 * @param {import('./dictionary.js').Meaning} meaning
 * @param {import('./dictionary.js').Definition} definition
 * @param {number} index
 * @param {string} platform
 * @returns {ListItem}
 */
function definitionItem(entry, meaning, definition, index, platform) {
  /** @type {Action[]} */
  const actions = [
    { type: 'copy', text: definition.text, title: 'Copy Definition' },
    { type: 'paste', text: definition.text, title: 'Paste Definition' },
    { type: 'copy', text: entry.word, title: 'Copy Word', shortcut: { key: 'c', modifiers: ['mod', 'shift'] } },
  ];
  if (definition.synonyms.length > 0) {
    actions.push({ type: 'copy', text: definition.synonyms.join(', '), title: 'Copy Synonyms' });
  }
  if (platform === 'darwin') {
    actions.push({
      type: 'open-url',
      url: `dict://${encodeURIComponent(entry.word)}`,
      title: 'Open in Dictionary',
      shortcut: { key: 'd', modifiers: ['mod'] },
    });
  }
  if (entry.source) {
    actions.push({
      type: 'open-url',
      url: entry.source,
      title: 'Open in Wiktionary',
      shortcut: { key: 'o', modifiers: ['mod'] },
    });
  }
  return {
    id: `${meaning.partOfSpeech}:${index}`,
    title: definition.text,
    subtitle: definition.example ? `“${definition.example}”` : undefined,
    icon: { builtin: 'text', tint: 'purple' },
    keywords: [meaning.partOfSpeech, ...definition.synonyms],
    detail: {
      title: entry.phonetic ? `${entry.word}  ${entry.phonetic}` : entry.word,
      body: [
        `# ${capitalise(meaning.partOfSpeech)}`,
        definition.text,
        ...(definition.example ? ['', `“${definition.example}”`] : []),
      ].join('\n'),
      metadata: [
        ...(definition.synonyms.length > 0 ? [{ label: 'Synonyms', value: definition.synonyms.join(', ') }] : []),
        ...(definition.antonyms.length > 0 ? [{ label: 'Opposites', value: definition.antonyms.join(', ') }] : []),
        { label: 'From', value: 'Wiktionary' },
      ],
    },
    actions,
  };
}

/**
 * @param {Context} ctx
 * @returns {Promise<ListView>}
 */
async function defineView(ctx) {
  const word = wordToLookUp(ctx.query || ctx.argument || '');
  const base = {
    type: /** @type {const} */ ('list'),
    title: 'Dictionary',
    searchPlaceholder: 'Type an English word…',
    filtering: false,
  };
  if (!word) return { ...base, emptyText: 'Type an English word to see what it means.', sections: [] };

  const ticket = ++latestRequest;
  if (!cache.has(word.toLowerCase())) {
    await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
    if (ticket !== latestRequest) return { ...base, sections: [] };
  }

  /** @type {Entry | null} */
  let entry;
  try {
    entry = await lookUp(word);
  } catch (error) {
    const timedOut = error instanceof Error && error.name === 'TimeoutError';
    return {
      ...base,
      emptyText: timedOut
        ? "The dictionary didn't answer in time. Check your connection and try again."
        : `Couldn't look that up: ${error instanceof Error ? error.message : String(error)}`,
      sections: [],
    };
  }
  if (!entry) return { ...base, emptyText: `No definition of “${word}”. Check the spelling?`, sections: [] };
  const found = entry;
  return {
    ...base,
    title: found.phonetic ? `${found.word}  ${found.phonetic}` : found.word,
    sections: found.meanings.map((meaning) => ({
      title: capitalise(meaning.partOfSpeech),
      items: meaning.definitions.map((definition, index) =>
        definitionItem(found, meaning, definition, index, ctx.platform),
      ),
    })),
  };
}

/** @type {Extension} */
export default {
  commands: {
    define: { view: defineView },
  },
};
