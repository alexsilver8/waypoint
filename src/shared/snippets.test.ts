import { describe, expect, it } from 'vitest';
import { checkSnippet, expandSnippet, keywordProblem, normalizeSnippets, snippetPreview } from './snippets';

describe('normalizeSnippets', () => {
  it('keeps valid snippets with their text exactly as written', () => {
    const { entries, problems } = normalizeSnippets([
      { name: ' Email ', keyword: ' !email ', text: '  alex@example.com\n' },
      { id: 'sig', name: 'Signature', text: 'Thanks,\nAlex' },
    ]);
    expect(problems).toEqual([]);
    expect(entries).toEqual([
      { id: 'email', name: 'Email', text: '  alex@example.com\n', keyword: '!email' },
      { id: 'sig', name: 'Signature', text: 'Thanks,\nAlex' },
    ]);
  });

  it('leaves out snippets it can’t use, and says why', () => {
    const { entries, problems } = normalizeSnippets([
      { name: 'Empty', text: '   ' },
      { name: 'Spaced', text: 'x', keyword: '! email' },
      { text: 'no name' },
      { name: 'Ok', text: 'ok', keyword: '' },
    ]);
    expect(entries).toEqual([{ id: 'ok', name: 'Ok', text: 'ok' }]);
    expect(problems).toEqual([
      'Ignoring snippet 1 (“Empty”): it needs some text.',
      'Ignoring snippet 2 (“Spaced”): the keyword can’t have spaces in it.',
      'Ignoring snippet 3: it needs a name.',
    ]);
  });

  it('rejects a file that isn’t a list', () => {
    expect(normalizeSnippets('hello').problems).toEqual([
      'snippets.json must be a list ([…]) of snippets; ignoring it.',
    ]);
  });
});

describe('checkSnippet', () => {
  it('wants the keyword as text', () => {
    expect(checkSnippet({ name: 'A', text: 'a', keyword: 5 }).problem).toBe('the keyword must be text.');
  });
});

describe('keywordProblem', () => {
  const others = [
    { id: 'sig', name: 'Signature', text: 'Thanks', keyword: '!sig' },
    { id: 'plain', name: 'Plain', text: 'Just text' },
  ];

  it('refuses a keyword another snippet has, in any letter case', () => {
    expect(keywordProblem({ name: 'New', text: 'x', keyword: '!SIG' }, others)).toBe(
      '“Signature” already has the keyword !sig.',
    );
  });

  it('is fine with a keyword of its own, or none', () => {
    expect(keywordProblem({ name: 'New', text: 'x', keyword: '!new' }, others)).toBeUndefined();
    expect(keywordProblem({ name: 'New', text: 'x' }, others)).toBeUndefined();
  });
});

describe('expandSnippet', () => {
  it('fills in the clipboard, dates and uuids, but not {argument}', () => {
    const text = 'Re: {clipboard}\nOn {date format="d MMMM yyyy"}, {argument} {uuid}';
    expect(
      expandSnippet(text, {
        clipboard: () => 'Invoice 42',
        now: new Date(2026, 9, 18),
        locale: 'en-GB',
        uuid: () => 'id-1',
        argument: 'ignored',
      }),
    ).toBe('Re: Invoice 42\nOn 18 October 2026, {argument} id-1');
  });
});

describe('snippetPreview', () => {
  it('shows the first line with something on it', () => {
    expect(snippetPreview('\n\n  Dear   team,\nmore')).toBe('Dear team,');
    expect(snippetPreview('x'.repeat(200))).toHaveLength(120);
  });
});
