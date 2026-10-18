// The Free Dictionary API (dictionaryapi.dev), which serves English definitions from
// Wiktionary, and turning what it answers into something the list can show. Kept free of side
// effects so it can be tested without a connection.

export const API = 'https://api.dictionaryapi.dev/api/v2/entries/en/';

/**
 * @typedef {object} Definition
 * @property {string} text
 * @property {string} [example]
 * @property {string[]} synonyms
 * @property {string[]} antonyms
 *
 * @typedef {object} Meaning
 * @property {string} partOfSpeech "noun", "verb"…
 * @property {Definition[]} definitions
 *
 * @typedef {object} Entry
 * @property {string} word
 * @property {string} [phonetic] Like "/həˈləʊ/".
 * @property {Meaning[]} meanings The entry's parts of speech, each once.
 * @property {string} [source] The Wiktionary page.
 */

/**
 * The word to look up: the text without spaces at its ends, quotes around it or punctuation
 * after it, so a word copied from a sentence works.
 * @param {string} text
 */
export function wordToLookUp(text) {
  return text
    .trim()
    .replace(/^["'“‘]+|["'”’.,!?;:]+$/g, '')
    .trim();
}

/** @param {string} word */
export function lookupUrl(word) {
  return `${API}${encodeURIComponent(word)}`;
}

/** @param {unknown} value */
function strings(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === 'string' && item.trim()) : [];
}

/**
 * The API answers with an entry for each sense of the word (etymology), each with meanings.
 * They're merged into one entry, with each part of speech once.
 * @param {unknown} json
 * @returns {Entry | undefined}
 */
export function parseEntries(json) {
  if (!Array.isArray(json) || json.length === 0) return undefined;
  /** @type {Map<string, Meaning>} */
  const meanings = new Map();
  let word = '';
  /** @type {string | undefined} */
  let phonetic;
  /** @type {string | undefined} */
  let source;
  for (const entry of json) {
    if (typeof entry !== 'object' || entry === null) continue;
    const raw = /** @type {any} */ (entry);
    if (!word && typeof raw.word === 'string') word = raw.word;
    if (!phonetic) {
      phonetic =
        (typeof raw.phonetic === 'string' && raw.phonetic) ||
        strings(Array.isArray(raw.phonetics) ? raw.phonetics.map((/** @type {any} */ p) => p?.text) : [])[0] ||
        undefined;
    }
    if (!source) source = strings(raw.sourceUrls)[0];
    for (const meaning of Array.isArray(raw.meanings) ? raw.meanings : []) {
      const partOfSpeech = typeof meaning?.partOfSpeech === 'string' ? meaning.partOfSpeech : 'other';
      const shared = { synonyms: strings(meaning?.synonyms), antonyms: strings(meaning?.antonyms) };
      const definitions = (Array.isArray(meaning?.definitions) ? meaning.definitions : []).flatMap(
        (/** @type {any} */ definition) => {
          if (typeof definition?.definition !== 'string' || !definition.definition.trim()) return [];
          return [
            {
              text: definition.definition.trim(),
              ...(typeof definition.example === 'string' && definition.example.trim()
                ? { example: definition.example.trim() }
                : {}),
              synonyms: [...new Set([...strings(definition.synonyms), ...shared.synonyms])],
              antonyms: [...new Set([...strings(definition.antonyms), ...shared.antonyms])],
            },
          ];
        },
      );
      if (definitions.length === 0) continue;
      const existing = meanings.get(partOfSpeech);
      if (existing) existing.definitions.push(...definitions);
      else meanings.set(partOfSpeech, { partOfSpeech, definitions });
    }
  }
  if (!word || meanings.size === 0) return undefined;
  return {
    word,
    ...(phonetic ? { phonetic } : {}),
    meanings: [...meanings.values()],
    ...(source ? { source } : {}),
  };
}

/** @param {string} text */
export function capitalise(text) {
  return text ? text[0]?.toUpperCase() + text.slice(1) : text;
}
