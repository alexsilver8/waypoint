import { describe, expect, it } from 'vitest';
import {
  apiBase,
  headers,
  isSameLanguage,
  languageName,
  looksLikeKey,
  parseLanguages,
  parseTranslation,
  parseUsage,
  problemFor,
  TARGETS,
  targetForLocale,
  usageText,
  webUrl,
} from './deepl.js';

const FREE_KEY = '1a2b3c4d-5e6f-4a1b-8c9d-0e1f2a3b4c5d:fx';
const PRO_KEY = '1a2b3c4d-5e6f-4a1b-8c9d-0e1f2a3b4c5d';

describe('keys', () => {
  it('recognises DeepL keys', () => {
    expect(looksLikeKey(FREE_KEY)).toBe(true);
    expect(looksLikeKey(` ${PRO_KEY} `)).toBe(true);
    expect(looksLikeKey('hello world')).toBe(false);
    expect(looksLikeKey(`${PRO_KEY}:dp`)).toBe(true);
    expect(looksLikeKey(`${PRO_KEY}:not-a-plan`)).toBe(false);
  });

  it('sends free keys to the free server', () => {
    expect(apiBase(FREE_KEY)).toBe('https://api-free.deepl.com');
    expect(apiBase(PRO_KEY)).toBe('https://api.deepl.com');
  });

  it('signs requests with the key', () => {
    expect(headers(` ${FREE_KEY}`).authorization).toBe(`DeepL-Auth-Key ${FREE_KEY}`);
  });
});

describe('languageName', () => {
  it('names DeepL codes the way people say them', () => {
    expect(languageName('DE')).toBe('German');
    expect(languageName('EN-GB')).toBe('British English');
    expect(languageName('PT-BR')).toBe('Brazilian Portuguese');
    expect(languageName('ZH-HANS')).toBe('Simplified Chinese');
    expect(languageName('NB')).toBe('Norwegian Bokmål');
  });

  it('names every language in the built-in list', () => {
    for (const code of TARGETS) expect(languageName(code)).not.toBe(code);
  });
});

describe('targetForLocale', () => {
  it('picks the language for a locale', () => {
    expect(targetForLocale('de-CH')).toBe('DE');
    expect(targetForLocale('en-US')).toBe('EN-US');
    expect(targetForLocale('en-IE')).toBe('EN-GB');
    expect(targetForLocale('en')).toBe('EN-US');
    expect(targetForLocale('pt-BR')).toBe('PT-BR');
    expect(targetForLocale('pt-PT')).toBe('PT-PT');
    expect(targetForLocale('zh-Hant-TW')).toBe('ZH-HANT');
    expect(targetForLocale('zh-CN')).toBe('ZH-HANS');
    expect(targetForLocale('nn-NO')).toBe('NB');
    expect(targetForLocale('ga-IE')).toBe('EN-US');
  });
});

describe('isSameLanguage', () => {
  it('compares a detected language with a target', () => {
    expect(isSameLanguage('EN', 'EN-GB')).toBe(true);
    expect(isSameLanguage('PT', 'PT-BR')).toBe(true);
    expect(isSameLanguage('ES', 'EN-US')).toBe(false);
  });
});

describe('parsing answers', () => {
  it('reads a translation', () => {
    expect(parseTranslation({ translations: [{ detected_source_language: 'ES', text: 'Hello' }] })).toEqual({
      text: 'Hello',
      source: 'ES',
    });
    expect(parseTranslation({ translations: [] })).toBeUndefined();
    expect(parseTranslation(null)).toBeUndefined();
  });

  it('reads the languages and the usage', () => {
    expect(parseLanguages([{ language: 'de', name: 'German' }, { name: 'nope' }])).toEqual(['DE']);
    expect(parseLanguages({})).toEqual([]);
    expect(parseUsage({ character_count: 120, character_limit: 500_000 })).toEqual({ used: 120, limit: 500_000 });
    expect(parseUsage({})).toBeUndefined();
  });

  it('explains failures', () => {
    expect(problemFor(403)).toBe("DeepL didn't accept your key.");
    expect(problemFor(456)).toMatch(/all the characters/);
    expect(problemFor(429)).toMatch(/busy/);
    expect(problemFor(503)).toMatch(/trouble/);
    expect(problemFor(400)).toBe('DeepL answered 400.');
  });
});

describe('usageText', () => {
  it('counts characters with separators', () => {
    expect(usageText({ used: 12_340, limit: 500_000 })).toBe('12,340 of 500,000 characters used');
  });
});

describe('webUrl', () => {
  it('opens the same translation on deepl.com', () => {
    expect(webUrl('hola amigo', 'ES', 'EN-GB')).toBe('https://www.deepl.com/translator#es/en-gb/hola%20amigo');
    expect(webUrl('hi', '', 'DE')).toBe('https://www.deepl.com/translator#auto/de/hi');
  });
});
