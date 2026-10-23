/**
 * Every common case of a piece of text. The text is split into words first, from whatever case
 * it's in: spaces and punctuation, a small letter before a capital (`camelCase`), the end of an
 * acronym (`XMLHttpRequest` → XML, Http, Request) and the edges of numbers (`version2Beta` →
 * version, 2, Beta) all end a word. Scripts without upper and lower case are left as they are.
 */

/**
 * One word at a time: a run of capitals that isn't the start of a capitalised word (`XML` in
 * `XMLHttp`, `CASE`), a word with at most a capital first letter (`Http`, `request`), letters
 * without case (日本語), or a number.
 */
const WORD = /\p{Lu}+(?!\p{Ll})|\p{Lu}?\p{Ll}+|\p{L}+|\p{N}+/gu;

/** Words Title Case leaves small unless they start or end the title. */
const SMALL_WORDS = new Set([
  'a',
  'an',
  'the',
  'and',
  'but',
  'or',
  'nor',
  'for',
  'so',
  'yet',
  'as',
  'at',
  'by',
  'in',
  'of',
  'on',
  'per',
  'to',
  'up',
  'via',
  'vs',
]);

/**
 * The words in `text`, as written.
 * @param {string} text
 * @returns {string[]}
 */
export function splitWords(text) {
  return text.match(WORD) ?? [];
}

/** @param {string} word */
function capitalize(word) {
  const [first = '', ...rest] = [...word];
  return first.toUpperCase() + rest.join('').toLowerCase();
}

/** @param {string[]} words */
function lower(words) {
  return words.map((word) => word.toLowerCase());
}

/**
 * Each case's name and the text in it, in the order they're listed. An empty text gives
 * empty values.
 * @param {string} text
 * @returns {Array<{ id: string, label: string, value: string, group: 'code' | 'text' }>}
 */
export function cases(text) {
  const words = splitWords(text);
  const small = lower(words);
  const capitals = words.map(capitalize);
  const title = capitals.map((word, i) =>
    i > 0 && i < words.length - 1 && SMALL_WORDS.has(word.toLowerCase()) ? word.toLowerCase() : word,
  );
  const camel = [...small.slice(0, 1), ...capitals.slice(1)];
  const sentence = [...capitals.slice(0, 1), ...small.slice(1)];
  return [
    { id: 'camel', label: 'camelCase', value: camel.join(''), group: 'code' },
    { id: 'pascal', label: 'PascalCase', value: capitals.join(''), group: 'code' },
    { id: 'snake', label: 'snake_case', value: small.join('_'), group: 'code' },
    { id: 'constant', label: 'CONSTANT_CASE', value: small.join('_').toUpperCase(), group: 'code' },
    { id: 'kebab', label: 'kebab-case', value: small.join('-'), group: 'code' },
    { id: 'dot', label: 'dot.case', value: small.join('.'), group: 'code' },
    { id: 'path', label: 'path/case', value: small.join('/'), group: 'code' },
    { id: 'title', label: 'Title Case', value: title.join(' '), group: 'text' },
    { id: 'sentence', label: 'Sentence case', value: sentence.join(' '), group: 'text' },
    { id: 'lower', label: 'lower case', value: small.join(' '), group: 'text' },
    { id: 'upper', label: 'UPPER CASE', value: small.join(' ').toUpperCase(), group: 'text' },
  ];
}
