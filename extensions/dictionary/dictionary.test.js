import { afterEach, describe, expect, it, vi } from 'vitest';
import { capitalise, lookupUrl, parseEntries, wordToLookUp } from './dictionary.js';
import extension from './index.js';

/** What the API answers for "hello", cut down. */
const HELLO = [
  {
    word: 'hello',
    phonetics: [{ audio: 'https://example.com/hello.mp3' }, { text: '/həˈləʊ/' }],
    meanings: [
      {
        partOfSpeech: 'noun',
        definitions: [
          { definition: '"Hello!" or an equivalent greeting.', synonyms: [], antonyms: [] },
          { definition: '   ', synonyms: [] },
        ],
        synonyms: ['greeting'],
        antonyms: [],
      },
      {
        partOfSpeech: 'interjection',
        definitions: [
          {
            definition: 'A greeting (salutation) said when meeting someone.',
            example: 'Hello, everyone.',
            synonyms: ['hi'],
            antonyms: ['bye', 'goodbye'],
          },
        ],
        synonyms: ['hey'],
        antonyms: [],
      },
    ],
    sourceUrls: ['https://en.wiktionary.org/wiki/hello'],
  },
  {
    word: 'hello',
    phonetic: '/həˈloʊ/',
    meanings: [{ partOfSpeech: 'noun', definitions: [{ definition: 'A sharp call.' }] }],
  },
];

describe('wordToLookUp', () => {
  it('takes the word out of quotes and punctuation', () => {
    expect(wordToLookUp('  “serendipity,” ')).toBe('serendipity');
    expect(wordToLookUp('ephemeral.')).toBe('ephemeral');
    expect(wordToLookUp('ice cream')).toBe('ice cream');
  });

  it('builds the address to ask', () => {
    expect(lookupUrl('ice cream')).toBe('https://api.dictionaryapi.dev/api/v2/entries/en/ice%20cream');
  });
});

describe('parseEntries', () => {
  it('merges the entries, with each part of speech once', () => {
    expect(parseEntries(HELLO)).toEqual({
      word: 'hello',
      phonetic: '/həˈləʊ/',
      source: 'https://en.wiktionary.org/wiki/hello',
      meanings: [
        {
          partOfSpeech: 'noun',
          definitions: [
            { text: '"Hello!" or an equivalent greeting.', synonyms: ['greeting'], antonyms: [] },
            { text: 'A sharp call.', synonyms: [], antonyms: [] },
          ],
        },
        {
          partOfSpeech: 'interjection',
          definitions: [
            {
              text: 'A greeting (salutation) said when meeting someone.',
              example: 'Hello, everyone.',
              synonyms: ['hi', 'hey'],
              antonyms: ['bye', 'goodbye'],
            },
          ],
        },
      ],
    });
  });

  it('copes with answers it doesn’t understand', () => {
    expect(parseEntries({ title: 'No Definitions Found' })).toBeUndefined();
    expect(parseEntries([])).toBeUndefined();
    expect(parseEntries([{ word: 'x', meanings: [] }])).toBeUndefined();
  });
});

describe('capitalise', () => {
  it('capitalises the first letter', () => {
    expect(capitalise('noun')).toBe('Noun');
    expect(capitalise('')).toBe('');
  });
});

describe('Define Word', () => {
  afterEach(() => vi.unstubAllGlobals());

  /** @param {string} query */
  const define = (query) => extension.commands.define?.view?.(/** @type {any} */ ({ query, platform: 'darwin' }));

  it('lists the definitions by part of speech', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json(HELLO)),
    );
    const view = await define('Hello');
    expect(view?.title).toBe('hello  /həˈləʊ/');
    expect(view?.sections.map((section) => section.title)).toEqual(['Noun', 'Interjection']);
    const greeting = view?.sections[1]?.items[0];
    expect(greeting?.subtitle).toBe('“Hello, everyone.”');
    expect(greeting?.actions.map((action) => action.title)).toEqual([
      'Copy Definition',
      'Paste Definition',
      'Copy Word',
      'Copy Synonyms',
      'Open in Dictionary',
      'Open in Wiktionary',
    ]);
  });

  it('says so when there is no such word', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ title: 'No Definitions Found' }, { status: 404 })),
    );
    const view = await define('qwzxv');
    expect(view?.emptyText).toBe('No definition of “qwzxv”. Check the spelling?');
  });
});
