import { describe, expect, it } from 'vitest';
import { idFor } from './entries';
import {
  argumentName,
  checkQuicklink,
  expandLink,
  isUrlLink,
  linkProblem,
  needsArgument,
  normalizeQuicklinks,
  shortLink,
  takesArgument,
} from './quicklinks';

describe('normalizeQuicklinks', () => {
  it('is empty when there is no file', () => {
    expect(normalizeQuicklinks(undefined)).toEqual({ entries: [], problems: [] });
  });

  it('keeps valid quicklinks, trimmed, with only the fields it knows', () => {
    const { entries, problems } = normalizeQuicklinks([
      { id: 'gh', name: ' GitHub Search ', link: ' https://github.com/search?q={argument} ', icon: '🐙', extra: 1 },
      { name: 'Music', link: 'spotify:', openWith: ' Spotify ' },
    ]);
    expect(problems).toEqual([]);
    expect(entries).toEqual([
      { id: 'gh', name: 'GitHub Search', link: 'https://github.com/search?q={argument}', icon: '🐙' },
      { id: 'music', name: 'Music', link: 'spotify:', openWith: 'Spotify' },
    ]);
  });

  it('leaves out entries it can’t use, and says why', () => {
    const { entries, problems } = normalizeQuicklinks([
      { name: 'No link' },
      'not an object',
      { name: 'Bad', link: 'javascript:alert(1)' },
      { name: 'Big icon', link: 'https://x.com', icon: 'not an emoji' },
      { name: 'Fine', link: 'x.com' },
    ]);
    expect(entries.map((q) => q.name)).toEqual(['Fine']);
    expect(problems).toEqual([
      'Ignoring quicklink 1 (“No link”): it needs a link.',
      'Ignoring quicklink 2: it must be an object with a name and a link.',
      'Ignoring quicklink 3 (“Bad”): Waypoint doesn’t open javascript: links.',
      'Ignoring quicklink 4 (“Big icon”): the icon must be an emoji.',
    ]);
  });

  it('rejects a file that isn’t a list', () => {
    expect(normalizeQuicklinks({ quicklinks: [] })).toEqual({
      entries: [],
      problems: ['quicklinks.json must be a list ([…]) of quicklinks; ignoring it.'],
    });
  });

  it('makes ids from names when they are missing, malformed or taken, never taking a given one', () => {
    const { entries } = normalizeQuicklinks([
      { name: 'Docs', link: 'https://a.dev' },
      { id: 'docs', name: 'Other', link: 'https://b.dev' },
      { id: 'docs', name: 'Docs', link: 'https://c.dev' },
      { id: 'has spaces', name: 'Café Menü', link: 'https://d.dev' },
      { name: '日本', link: 'https://e.dev' },
    ]);
    expect(entries.map((q) => q.id)).toEqual(['docs-2', 'docs', 'docs-3', 'cafe-menu', 'quicklink']);
  });
});

describe('idFor', () => {
  it('slugs the name and avoids ids that are taken', () => {
    expect(idFor('GitHub Search!', new Set(), 'x')).toBe('github-search');
    expect(idFor('GitHub Search', new Set(['github-search', 'github-search-2']), 'x')).toBe('github-search-3');
    expect(idFor('—', new Set(), 'snippet')).toBe('snippet');
  });
});

describe('checkQuicklink', () => {
  it('drops empty optional fields', () => {
    expect(checkQuicklink({ name: 'A', link: '~/Downloads', openWith: ' ', icon: '' })).toEqual({
      entry: { name: 'A', link: '~/Downloads' },
    });
  });

  it('wants an app as text', () => {
    expect(checkQuicklink({ name: 'A', link: '/tmp', openWith: 3 }).problem).toBe(
      '“openWith” must be the name or path of an app.',
    );
  });
});

describe('linkProblem', () => {
  it('accepts web addresses, paths and app links', () => {
    for (const link of [
      'https://example.com/{argument}',
      'example.com/search?q={argument}',
      '~/Documents',
      '/Applications',
      'C:\\Users\\me',
      '\\\\server\\share',
      'file:///tmp/a.txt',
      'spotify:search:{argument}',
      'obsidian://open?vault=notes',
      '{clipboard}',
    ]) {
      expect(linkProblem(link), link).toBeUndefined();
    }
  });

  it('says what’s wrong with anything else', () => {
    expect(linkProblem('  ')).toBe('Add a link.');
    expect(linkProblem('just words')).toMatch(/^Use a web address/);
    expect(linkProblem('https://a.com\nb')).toBe('The link must be on one line.');
    expect(linkProblem('data:text/html,hi')).toBe('Waypoint doesn’t open data: links.');
  });
});

describe('placeholders in links', () => {
  it('percent-encodes what goes into a URL, but not into a path', () => {
    expect(isUrlLink('https://x.com')).toBe(true);
    expect(isUrlLink('x.com/a')).toBe(true);
    expect(isUrlLink('C:\\temp')).toBe(false);
    expect(isUrlLink('~/notes/{argument}.md')).toBe(false);
    expect(expandLink('https://github.com/search?q={argument}', { argument: 'a b&c' })).toBe(
      'https://github.com/search?q=a%20b%26c',
    );
    expect(expandLink('~/notes/{argument}.md', { argument: 'my day' })).toBe('~/notes/my day.md');
    expect(expandLink('{clipboard}', { clipboard: () => 'https://a.com/?q=1' })).toBe('https://a.com/?q=1');
  });

  it('can show where the text goes, for a preview', () => {
    expect(expandLink('https://x.com/{argument}/{date format="yyyy"}', { now: new Date(2026, 0, 1) }, true)).toBe(
      'https://x.com/{argument}/2026',
    );
    expect(expandLink('https://x.com/?q={argument name="term" default="a"}', {}, true)).toBe('https://x.com/?q={term}');
  });

  it('knows whether a link takes text, and whether it needs it', () => {
    expect(takesArgument('https://x.com/?q={argument}')).toBe(true);
    expect(needsArgument('https://x.com/?q={argument}')).toBe(true);
    expect(takesArgument('https://x.com/?q={argument default="news"}')).toBe(true);
    expect(needsArgument('https://x.com/?q={argument default="news"}')).toBe(false);
    expect(takesArgument('https://x.com/{clipboard}')).toBe(false);
    expect(argumentName('https://x.com/?q={argument name="term"}')).toBe('term');
    expect(argumentName('https://x.com/?q={argument}')).toBe('text');
  });
});

describe('shortLink', () => {
  it('shows links without their scheme', () => {
    expect(shortLink('https://www.github.com/search')).toBe('github.com/search');
    expect(shortLink('spotify:search')).toBe('spotify:search');
    expect(shortLink('https://x.com/{argument name="term"}/{date format="yyyy"}/{argument}')).toBe(
      'x.com/{term}/{date}/{argument}',
    );
  });
});
