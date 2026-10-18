// DeepL: type or paste text and it's translated into your language, or into a second language
// you pick when it's already in yours. Also offered under "Use “…” with". Needs a DeepL API
// key, which you paste into the search field once.
import {
  apiBase,
  headers,
  isSameLanguage,
  KEYS_URL,
  languageName,
  looksLikeKey,
  otherBase,
  parseLanguages,
  parseTranslation,
  parseUsage,
  problemFor,
  TARGETS,
  targetForLocale,
  usageText,
  webUrl,
} from './deepl.js';

/** @typedef {import('@waypoint/api').Extension} Extension */
/** @typedef {import('@waypoint/api').ExtensionContext} Context */
/** @typedef {import('@waypoint/api').ListItem} ListItem */
/** @typedef {import('@waypoint/api').ListSection} ListSection */
/** @typedef {import('@waypoint/api').ListView} ListView */
/** @typedef {import('@waypoint/api').ActionResult} ActionResult */
/** @typedef {import('./deepl.js').Translation} Translation */
/** @typedef {{ key: string, base: string }} Auth A key, and the server its plan uses. */

/** What a call may take in all: the launcher gives up on an extension after 10 seconds. */
const BUDGET_MS = 8500;
/**
 * DeepL counts every character sent, so wait until typing stops: on top of the launcher's own
 * short pause, a request is only made once nothing new was typed for this long.
 */
const SETTLE_MS = 350;
const LANGUAGES_MAX_AGE_MS = 7 * 24 * 60 * 60_000;

class DeepLError extends Error {
  /**
   * @param {string} message
   * @param {number} status
   */
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

/** Translations already made, by target and text. @type {Map<string, Translation>} */
const translations = new Map();
let latestRequest = 0;

/** @param {unknown} error */
function message(error) {
  if (error instanceof Error && error.name === 'TimeoutError')
    return "DeepL didn't answer in time. Check your connection.";
  return error instanceof Error ? error.message : String(error);
}

/**
 * @param {Context} ctx
 * @returns {Auth | undefined}
 */
function savedAuth(ctx) {
  const key = ctx.storage.get('key');
  if (typeof key !== 'string' || !key) return undefined;
  const base = ctx.storage.get('server');
  return { key, base: typeof base === 'string' && base ? base : apiBase(key) };
}

/**
 * @param {Auth} auth
 * @param {string} path
 * @param {{ body?: unknown, deadline?: number }} [options] `deadline` is when the whole call
 *   has to be done by, shared by every request it makes.
 * @returns {Promise<unknown>}
 */
async function request(auth, path, { body, deadline = Date.now() + BUDGET_MS } = {}) {
  const response = await fetch(`${auth.base}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: headers(auth.key),
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(Math.max(1000, deadline - Date.now())),
  });
  if (!response.ok) throw new DeepLError(problemFor(response.status), response.status);
  return response.json();
}

/**
 * @param {Auth} auth
 * @param {string} text
 * @param {string} target
 * @param {number} deadline
 * @returns {Promise<Translation>}
 */
async function translate(auth, text, target, deadline) {
  const cacheKey = `${target}\u0000${text}`;
  const cached = translations.get(cacheKey);
  if (cached) return cached;
  const translation = parseTranslation(
    await request(auth, '/v2/translate', { body: { text: [text], target_lang: target }, deadline }),
  );
  if (!translation) throw new Error('DeepL sent back something unexpected.');
  if (translations.size > 200) translations.clear();
  translations.set(cacheKey, translation);
  return translation;
}

/** @param {Context} ctx */
function target(ctx) {
  const saved = ctx.storage.get('target');
  return typeof saved === 'string' && saved ? saved : targetForLocale(Intl.DateTimeFormat().resolvedOptions().locale);
}

/** @param {Context} ctx */
function second(ctx) {
  const saved = ctx.storage.get('second');
  return typeof saved === 'string' && saved ? saved : undefined;
}

/**
 * The languages DeepL translates into, asked once a week.
 * @param {Context} ctx
 * @param {Auth} auth
 * @returns {Promise<string[]>}
 */
async function targetLanguages(ctx, auth) {
  const saved = /** @type {{ at?: unknown, codes?: unknown } | undefined} */ (ctx.storage.get('languages'));
  if (
    saved &&
    typeof saved.at === 'number' &&
    Date.now() - saved.at < LANGUAGES_MAX_AGE_MS &&
    Array.isArray(saved.codes) &&
    saved.codes.length > 0
  ) {
    return saved.codes.filter((code) => typeof code === 'string');
  }
  try {
    const codes = parseLanguages(await request(auth, '/v2/languages?type=target'));
    if (codes.length > 0) {
      ctx.storage.set('languages', { at: Date.now(), codes });
      return codes;
    }
  } catch {
    // The list below will do.
  }
  return TARGETS;
}

/**
 * The view to sign in from: paste a key into the search field and save it. With a key saved
 * already, the one pasted replaces it.
 * @param {Context} ctx
 * @param {string} [problem]
 * @returns {ListView}
 */
function signInView(ctx, problem) {
  const typed = ctx.query.trim();
  const replacing = savedAuth(ctx) !== undefined;
  /** @type {ListItem[]} */
  const items = [];
  if (looksLikeKey(typed)) {
    items.push({
      id: 'save-key',
      title: replacing ? 'Use This Key Instead' : 'Save This Key',
      subtitle: `${typed.slice(0, 8)}…${typed.slice(-4)}`,
      icon: { builtin: 'lock', tint: 'green' },
      actions: [{ type: 'callback', id: 'save-key', title: 'Save Key', payload: typed }],
    });
  }
  items.push({
    id: 'get-key',
    title: 'Get a DeepL API Key',
    subtitle: 'From the API Keys page of your DeepL account',
    icon: { builtin: 'globe', tint: 'blue' },
    actions: [{ type: 'open-url', url: KEYS_URL, title: 'Open DeepL' }],
  });
  if (replacing) items.push(keyItem());
  return {
    type: 'list',
    title: 'DeepL',
    searchPlaceholder: 'Paste a DeepL API key…',
    filtering: false,
    emptyText: '',
    sections: [
      {
        title: problem ?? (replacing ? 'Use another DeepL key' : 'Connect DeepL'),
        items: items.map((item) => ({
          ...item,
          detail: {
            title: 'Connect DeepL',
            body: [
              ...(problem ? [problem, ''] : []),
              'Paste your DeepL API key into the search field, then save it.',
              '',
              'Your keys are on the API Keys page of your DeepL account, once it has an API plan.',
              '',
              "The key is saved on this computer in Waypoint's data folder (extension-data/deepl/storage.json), and only sent to DeepL.",
            ].join('\n'),
          },
        })),
      },
    ],
  };
}

/**
 * The key: pasting another into the search field replaces it, or it can be forgotten.
 * @returns {ListItem}
 */
function keyItem() {
  return {
    id: 'key',
    title: 'Use Another DeepL Key',
    subtitle: 'Paste it into the search field',
    icon: { builtin: 'lock', tint: 'gray' },
    actions: [
      { type: 'callback', id: 'replace-key', title: 'Use Another Key' },
      { type: 'callback', id: 'forget-key', title: 'Forget DeepL Key', style: 'destructive' },
    ],
  };
}

/**
 * Items to change the languages and the key, for under the translation.
 * @param {Context} ctx
 * @param {string} text
 * @returns {ListSection}
 */
function settingsSection(ctx, text) {
  const into = target(ctx);
  const other = second(ctx);
  return {
    title: 'Settings',
    items: [
      {
        id: 'set-target',
        title: `Translate into ${languageName(into)}`,
        icon: { builtin: 'globe', tint: 'gray' },
        actions: [{ type: 'callback', id: 'choose', title: 'Change Language', payload: { which: 'target', text } }],
      },
      {
        id: 'set-second',
        title: other ? `Second Language: ${languageName(other)}` : 'Add a Second Language',
        subtitle: `For text that's already in ${languageName(into)}`,
        icon: { builtin: 'globe', tint: 'gray' },
        actions: [
          {
            type: 'callback',
            id: 'choose',
            title: other ? 'Change Second Language' : 'Choose Second Language',
            payload: { which: 'second', text },
          },
        ],
      },
      keyItem(),
    ],
  };
}

/**
 * @param {Context} ctx
 * @returns {Promise<ListView>}
 */
async function translateView(ctx) {
  const auth = savedAuth(ctx);
  if (!auth) return signInView(ctx);
  const text = (ctx.query || ctx.argument || '').trim();
  const base = {
    type: /** @type {const} */ ('list'),
    title: 'DeepL',
    searchPlaceholder: 'Type or paste text to translate…',
    filtering: false,
  };
  if (!text) {
    return { ...base, emptyText: 'Type or paste text to translate it.', sections: [settingsSection(ctx, '')] };
  }
  // A key pasted in is a new key, not something to translate.
  if (looksLikeKey(text)) return signInView({ ...ctx, query: text });

  const deadline = Date.now() + BUDGET_MS;
  const ticket = ++latestRequest;
  await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
  // Something newer was typed; the launcher shows that answer instead.
  if (ticket !== latestRequest) return { ...base, sections: [] };

  let into = target(ctx);
  /** @type {Translation} */
  let translation;
  try {
    translation = await translate(auth, text, into, deadline);
    const other = second(ctx);
    if (other && isSameLanguage(translation.source, into)) {
      into = other;
      translation = await translate(auth, text, into, deadline);
    }
  } catch (error) {
    if (error instanceof DeepLError && error.status === 403) return signInView(ctx, error.message);
    return { ...base, emptyText: message(error), sections: [settingsSection(ctx, text)] };
  }

  const from = translation.source ? languageName(translation.source) : 'Detected language';
  const unchanged = isSameLanguage(translation.source, into) && translation.text.trim() === text;
  return {
    ...base,
    sections: [
      {
        title: `${from} → ${languageName(into)}`,
        items: [
          {
            id: 'translation',
            title: translation.text.replace(/\s+/g, ' '),
            subtitle: unchanged ? `Already in ${languageName(into)}` : undefined,
            icon: { builtin: 'text', tint: 'blue' },
            detail: {
              title: languageName(into),
              body: translation.text,
              metadata: [
                { label: 'From', value: from },
                { label: 'Into', value: languageName(into) },
                { label: 'Characters', value: String(text.length) },
              ],
            },
            actions: [
              { type: 'copy', text: translation.text, title: 'Copy Translation' },
              { type: 'paste', text: translation.text, title: 'Paste Translation' },
              {
                type: 'callback',
                id: 'choose',
                title: 'Translate into Another Language',
                payload: { which: 'target', text },
                shortcut: { key: 'l', modifiers: ['mod'] },
              },
              {
                type: 'open-url',
                url: webUrl(text, translation.source, into),
                title: 'Open in DeepL Translator',
                shortcut: { key: 'o', modifiers: ['mod'] },
              },
              { type: 'callback', id: 'usage', title: 'Show Characters Used' },
              { type: 'callback', id: 'forget-key', title: 'Forget DeepL Key', style: 'destructive' },
            ],
          },
        ],
      },
      settingsSection(ctx, text),
    ],
  };
}

/**
 * The languages to pick from, the current one marked.
 * @param {Context} ctx
 * @param {'target' | 'second'} which
 * @param {string} text To translate again once one is picked.
 * @returns {Promise<ListView>}
 */
async function languagesView(ctx, which, text) {
  const auth = savedAuth(ctx);
  const codes = auth ? await targetLanguages(ctx, auth) : TARGETS;
  const current = which === 'target' ? target(ctx) : second(ctx);
  /** @type {ListItem[]} */
  const items = codes
    .map((code) => ({ code, name: languageName(code) }))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(({ code, name }) => ({
      id: code,
      title: name,
      subtitle: code,
      accessory: code === current ? 'Current' : '',
      icon: { builtin: 'globe', tint: code === current ? 'blue' : 'gray' },
      actions: [{ type: 'callback', id: 'pick', title: `Use ${name}`, payload: { which, code, text } }],
    }));
  if (which === 'second' && current) {
    items.unshift({
      id: 'none',
      title: 'No Second Language',
      icon: { builtin: 'close', tint: 'gray' },
      actions: [{ type: 'callback', id: 'pick', title: 'No Second Language', payload: { which, code: '', text } }],
    });
  }
  return {
    type: 'list',
    title: which === 'target' ? 'Translate into' : 'Second language',
    searchPlaceholder: 'Search languages…',
    sections: [{ items }],
  };
}

/**
 * @param {string} id
 * @param {unknown} payload
 * @param {Context} ctx
 * @returns {Promise<ActionResult | undefined>}
 */
async function onAction(id, payload, ctx) {
  if (id === 'save-key' && typeof payload === 'string' && looksLikeKey(payload)) {
    const key = payload.trim();
    const deadline = Date.now() + BUDGET_MS;
    /** @type {{ used: number, limit: number } | undefined} */
    let usage;
    // The server goes by the key's ending; if that's refused, the other one is asked too, in
    // case a plan's keys end some other way.
    let base = apiBase(key);
    try {
      try {
        usage = parseUsage(await request({ key, base }, '/v2/usage', { deadline }));
      } catch (error) {
        if (!(error instanceof DeepLError) || error.status !== 403) throw error;
        base = otherBase(base);
        usage = parseUsage(await request({ key, base }, '/v2/usage', { deadline }));
      }
    } catch (error) {
      return { toast: message(error), toastStyle: 'failure' };
    }
    ctx.storage.set('key', key);
    ctx.storage.set('server', base);
    return {
      replace: await translateView({ ...ctx, query: '' }),
      clearSearch: true,
      toast: usage ? `Connected to DeepL. ${usageText(usage)}` : 'Connected to DeepL',
    };
  }
  if (id === 'replace-key') return { clearSearch: true, toast: 'Paste your other DeepL key into the search field' };
  if (id === 'forget-key') {
    ctx.storage.remove('key');
    ctx.storage.remove('server');
    translations.clear();
    return { replace: signInView({ ...ctx, query: '' }), clearSearch: true, toast: 'Forgot your DeepL key' };
  }
  if (id === 'usage') {
    const auth = savedAuth(ctx);
    if (!auth) return undefined;
    try {
      const usage = parseUsage(await request(auth, '/v2/usage'));
      return { toast: usage ? usageText(usage) : "DeepL didn't say." };
    } catch (error) {
      return { toast: message(error), toastStyle: 'failure' };
    }
  }
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return undefined;
  const { which, code, text } = /** @type {Record<string, unknown>} */ (payload);
  if ((which !== 'target' && which !== 'second') || typeof text !== 'string') return undefined;
  if (id === 'choose') return { push: await languagesView(ctx, which, text) };
  if (id === 'pick' && typeof code === 'string') {
    if (code) ctx.storage.set(which, code);
    else ctx.storage.remove(which);
    // Back to the translation, done again in the language picked.
    return {
      pop: true,
      replace: await translateView({ ...ctx, query: text }),
      toast: code
        ? `${which === 'target' ? 'Translating into' : 'Second language:'} ${languageName(code)}`
        : 'No second language',
    };
  }
  return undefined;
}

/** @type {Extension} */
export default {
  commands: {
    translate: { view: translateView, onAction },
  },
};
