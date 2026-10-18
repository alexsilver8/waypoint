// The DeepL API: which server a key belongs to, the languages it translates into, and reading
// what it answers. Kept free of side effects so it can be tested without a key.

/** API Free keys end in ":fx" and go to their own server; every other plan's go to the main one. */
export const FREE_API = 'https://api-free.deepl.com';
export const PRO_API = 'https://api.deepl.com';

/** Where your keys are, in your DeepL account. */
export const KEYS_URL = 'https://www.deepl.com/your-account/keys';

/**
 * The server a key's plan uses, as DeepL's own libraries tell: by the `:fx` ending.
 * @param {string} key
 */
export function apiBase(key) {
  return key.trim().endsWith(':fx') ? FREE_API : PRO_API;
}

/** @param {string} base */
export function otherBase(base) {
  return base === FREE_API ? PRO_API : FREE_API;
}

/**
 * An authentication key as DeepL issues them: a UUID, and for some plans a short ending like
 * `:fx`.
 * @param {string} text
 */
export function looksLikeKey(text) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(:[a-z0-9]{1,8})?$/i.test(text.trim());
}

/** @param {string} key */
export function headers(key) {
  return { authorization: `DeepL-Auth-Key ${key.trim()}`, 'content-type': 'application/json' };
}

/**
 * The languages DeepL translates into, for when it can't be asked. Codes as the API wants them.
 */
export const TARGETS = [
  'AR',
  'BG',
  'CS',
  'DA',
  'DE',
  'EL',
  'EN-GB',
  'EN-US',
  'ES',
  'ET',
  'FI',
  'FR',
  'HU',
  'ID',
  'IT',
  'JA',
  'KO',
  'LT',
  'LV',
  'NB',
  'NL',
  'PL',
  'PT-BR',
  'PT-PT',
  'RO',
  'RU',
  'SK',
  'SL',
  'SV',
  'TR',
  'UK',
  'ZH-HANS',
  'ZH-HANT',
];

const names = new Intl.DisplayNames(['en'], { type: 'language' });

/**
 * A DeepL language code as people say it: `EN-GB` → "British English", `ZH-HANS` →
 * "Simplified Chinese".
 * @param {string} code
 */
export function languageName(code) {
  const [base = '', region] = code.split('-');
  const tag = region
    ? `${base.toLowerCase()}-${region.length === 4 ? region[0] + region.slice(1).toLowerCase() : region}`
    : base.toLowerCase();
  try {
    return names.of(tag) ?? code;
  } catch {
    return code;
  }
}

/**
 * The language to translate into for someone using this locale: `de-CH` → `DE`, `en-IE` →
 * `EN-GB`, `pt-BR` → `PT-BR`. English, in its American spelling, when DeepL doesn't have it.
 * @param {string} locale
 */
export function targetForLocale(locale) {
  const [language = '', ...rest] = locale.split(/[-_]/);
  const base = language.toLowerCase();
  const parts = rest.map((part) => part.toLowerCase());
  if (base === 'en') return parts.includes('us') || parts.length === 0 ? 'EN-US' : 'EN-GB';
  if (base === 'pt') return parts.includes('br') ? 'PT-BR' : 'PT-PT';
  if (base === 'zh') return parts.some((part) => ['hant', 'tw', 'hk', 'mo'].includes(part)) ? 'ZH-HANT' : 'ZH-HANS';
  if (base === 'no' || base === 'nn') return 'NB';
  const code = base.toUpperCase();
  return TARGETS.includes(code) ? code : 'EN-US';
}

/**
 * Whether text DeepL detected as `source` (`EN`, `PT`) is already in `target` (`EN-US`).
 * @param {string} source
 * @param {string} target
 */
export function isSameLanguage(source, target) {
  return source.toUpperCase() === (target.split('-')[0] ?? '').toUpperCase();
}

/**
 * @typedef {object} Translation
 * @property {string} text
 * @property {string} source The language DeepL found, like `ES`.
 */

/**
 * @param {unknown} json
 * @returns {Translation | undefined}
 */
export function parseTranslation(json) {
  const first = /** @type {any} */ (json)?.translations?.[0];
  if (typeof first?.text !== 'string') return undefined;
  return {
    text: first.text,
    source: typeof first.detected_source_language === 'string' ? first.detected_source_language : '',
  };
}

/**
 * `/v2/languages?type=target`: `[{ language: 'DE', name: 'German' }, …]`.
 * @param {unknown} json
 * @returns {string[]}
 */
export function parseLanguages(json) {
  if (!Array.isArray(json)) return [];
  return json.flatMap((entry) => (typeof entry?.language === 'string' ? [entry.language.toUpperCase()] : []));
}

/**
 * `/v2/usage`: characters used and allowed this billing period.
 * @param {unknown} json
 * @returns {{ used: number, limit: number } | undefined}
 */
export function parseUsage(json) {
  const { character_count: used, character_limit: limit } = /** @type {any} */ (json) ?? {};
  return typeof used === 'number' && typeof limit === 'number' ? { used, limit } : undefined;
}

/**
 * What a failed request means, in words.
 * @param {number} status
 */
export function problemFor(status) {
  if (status === 403) return "DeepL didn't accept your key.";
  if (status === 456) return "You've used all the characters your DeepL plan allows.";
  if (status === 429) return 'DeepL is busy. Try again in a moment.';
  if (status === 413) return 'That is too much text to translate at once.';
  if (status >= 500) return `DeepL is having trouble (${status}). Try again in a moment.`;
  return `DeepL answered ${status}.`;
}

/**
 * "12,340 of 500,000 characters used".
 * @param {{ used: number, limit: number }} usage
 */
export function usageText({ used, limit }) {
  const format = new Intl.NumberFormat('en-US');
  return `${format.format(used)} of ${format.format(limit)} characters used`;
}

/**
 * The page on deepl.com with the same translation, to carry on there.
 * @param {string} text
 * @param {string} source
 * @param {string} target
 */
export function webUrl(text, source, target) {
  const from = source ? source.toLowerCase() : 'auto';
  return `https://www.deepl.com/translator#${from}/${target.toLowerCase()}/${encodeURIComponent(text)}`;
}
