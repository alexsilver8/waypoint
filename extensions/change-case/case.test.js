import { describe, expect, it } from 'vitest';
import { cases, splitWords } from './case.js';

/** The text in the case called `label`. */
const inCase = (text, label) => cases(text).find((result) => result.label === label)?.value;

describe('splitWords', () => {
  it.each([
    ['hello world', ['hello', 'world']],
    ['camelCase', ['camel', 'Case']],
    ['PascalCase', ['Pascal', 'Case']],
    ['snake_case_here', ['snake', 'case', 'here']],
    ['CONSTANT_CASE', ['CONSTANT', 'CASE']],
    ['kebab-case', ['kebab', 'case']],
    ['dot.case', ['dot', 'case']],
    ['path/case', ['path', 'case']],
    ['Title Case', ['Title', 'Case']],
    ['XMLHttpRequest', ['XML', 'Http', 'Request']],
    ['getHTTPResponseCode', ['get', 'HTTP', 'Response', 'Code']],
    ['version2Beta', ['version', '2', 'Beta']],
    ['HTML5Parser', ['HTML', '5', 'Parser']],
    ['iOS 17', ['i', 'OS', '17']],
    ['user_id-2', ['user', 'id', '2']],
    ['  spaced   out  ', ['spaced', 'out']],
    ['ÉcoleNormale', ['École', 'Normale']],
    ['straße über', ['straße', 'über']],
    ['日本語 テキスト', ['日本語', 'テキスト']],
    ['A', ['A']],
    ['ABC', ['ABC']],
    ['', []],
    ['---', []],
  ])('%j → %j', (text, words) => {
    expect(splitWords(text)).toEqual(words);
  });
});

describe('cases', () => {
  it('gives every case of plain words', () => {
    expect(cases('hello big world').map(({ label, value }) => [label, value])).toEqual([
      ['camelCase', 'helloBigWorld'],
      ['PascalCase', 'HelloBigWorld'],
      ['snake_case', 'hello_big_world'],
      ['CONSTANT_CASE', 'HELLO_BIG_WORLD'],
      ['kebab-case', 'hello-big-world'],
      ['dot.case', 'hello.big.world'],
      ['path/case', 'hello/big/world'],
      ['Title Case', 'Hello Big World'],
      ['Sentence case', 'Hello big world'],
      ['lower case', 'hello big world'],
      ['UPPER CASE', 'HELLO BIG WORLD'],
    ]);
  });

  it.each([
    ['XMLHttpRequest', 'snake_case', 'xml_http_request'],
    ['XMLHttpRequest', 'camelCase', 'xmlHttpRequest'],
    ['XMLHttpRequest', 'kebab-case', 'xml-http-request'],
    ['version2Beta', 'kebab-case', 'version-2-beta'],
    ['version2Beta', 'CONSTANT_CASE', 'VERSION_2_BETA'],
    ['HELLO_WORLD', 'camelCase', 'helloWorld'],
    ['hello-world', 'PascalCase', 'HelloWorld'],
    ['Hello World', 'dot.case', 'hello.world'],
    ['my.file.name', 'path/case', 'my/file/name'],
    ['userID', 'snake_case', 'user_id'],
    ['getHTTPResponseCode', 'Title Case', 'Get Http Response Code'],
    ['SOME TEXT', 'Sentence case', 'Some text'],
    ['the lord of the rings', 'Title Case', 'The Lord of the Rings'],
    ['a tale of two cities', 'Title Case', 'A Tale of Two Cities'],
    ['what it is for', 'Title Case', 'What It Is For'],
    ['école normale', 'PascalCase', 'ÉcoleNormale'],
    ['日本語 テキスト', 'snake_case', '日本語_テキスト'],
  ])('%j as %s is %j', (text, label, expected) => {
    expect(inCase(text, label)).toBe(expected);
  });

  it('converts every case to every other', () => {
    const results = cases('xml http request');
    for (const { value } of results) {
      for (const { label, value: expected } of results) {
        expect(inCase(value, label), `${value} as ${label}`).toBe(expected);
      }
    }
  });

  it('gives empty values for text without words', () => {
    expect(cases('').every(({ value }) => value === '')).toBe(true);
    expect(cases('--- ???').every(({ value }) => value === '')).toBe(true);
  });
});
