import { describe, expect, it } from 'vitest';
import type { RootItem } from '../../shared/types';
import { asUrl, buildRootSections, countRootMatches } from './root-search';

const command = (title: string, extra: Partial<RootItem> = {}): RootItem => ({
  id: `command:x/${title}`,
  kind: 'command',
  title,
  frecency: 0,
  actions: [{ type: 'open-command', ref: { extension: 'x', command: title } }],
  ...extra,
});
const app = (title: string, frecency = 0): RootItem => ({
  id: `app:/Applications/${title}.app`,
  kind: 'application',
  title,
  frecency,
  actions: [{ type: 'open-path', path: `/Applications/${title}.app` }],
});

const note = (title: string, body: string): RootItem => ({
  id: `note:${title}`,
  kind: 'note',
  title,
  keywords: [`${title}\n${body}`],
  frecency: 0,
  detail: { body },
  actions: [{ type: 'open-command', ref: { extension: 'notes', command: 'open' }, argument: title }],
});
const copied = (text: string): RootItem => ({
  id: `clipboard:${text}`,
  kind: 'clipboard',
  title: text,
  keywords: [text],
  frecency: 0,
  actions: [{ type: 'copy', text }],
});

const items: RootItem[] = [
  command('Clipboard History', { frecency: 3 }),
  command('Search Google', { fallback: { extension: 'web-search', command: 'google' } }),
  command('Quit Waypoint'),
  app('Safari', 1),
  app('Calendar'),
  app('Calculator'),
  note('Groceries', '- oat milk\n- sourdough'),
  note('Trip to Lisbon', 'pack the safari hat'),
  copied('oat milk barista edition'),
];

const titles = (query: string) =>
  buildRootSections(items, query).map((s) => [s.title, s.items.map((i) => i.title)] as const);

describe('buildRootSections', () => {
  it('shows suggestions by usage, then the remaining commands, when the query is empty', () => {
    expect(titles('')).toEqual([
      ['Suggestions', ['Clipboard History', 'Safari']],
      ['Commands', ['Quit Waypoint', 'Search Google']],
    ]);
  });

  it('ranks results and offers fallbacks with the query as argument', () => {
    const sections = buildRootSections(items, 'cal');
    expect(sections.map((s) => s.title)).toEqual(['Results', 'Use “cal” with…']);
    expect(sections[0]?.items.map((i) => i.title)).toEqual(['Calendar', 'Calculator']);
    expect(sections[1]?.items[0]?.actions[0]).toEqual({
      type: 'open-command',
      ref: { extension: 'web-search', command: 'google' },
      argument: 'cal',
      title: 'Search Google',
    });
  });

  it('puts a calculator row first for arithmetic', () => {
    const [first] = buildRootSections(items, '12 * 7');
    expect(first?.title).toBe('Calculator');
    expect(first?.items[0]?.calculator).toEqual({ expression: '12 * 7', result: '84' });
    expect(first?.items[0]?.actions[0]).toEqual({ type: 'copy', text: '84', title: 'Copy Answer' });
  });

  it('offers to open things that look like links', () => {
    const [first] = buildRootSections(items, 'github.com/alexsilver8');
    expect(first?.title).toBe('Link');
    expect(first?.items[0]?.actions[0]).toMatchObject({ type: 'open-url', url: 'https://github.com/alexsilver8' });
    // ⌘K can make a quicklink of it, starting from the link.
    expect(first?.items[0]?.actions[2]).toEqual({
      type: 'open-command',
      ref: { extension: 'quicklinks', command: 'create' },
      argument: 'https://github.com/alexsilver8',
      title: 'Create Quicklink',
    });
  });

  it('remembers which root item a row came from', () => {
    const [results] = buildRootSections(items, 'safari');
    expect(results?.items[0]?.rootItemId).toBe('app:/Applications/Safari.app');
  });
});

describe('items that take text', () => {
  const open = { extension: 'quicklinks', command: 'open' };
  const quicklink = (title: string, extra: Partial<RootItem> = {}): RootItem =>
    command(title, {
      id: `quicklink:${title}`,
      subtitle: 'github.com/search?q={argument}',
      takesText: { ref: open, prefix: `${title}\n` },
      actions: [
        { type: 'open-command', ref: open, argument: title, title: 'Open Quicklink' },
        { type: 'open-command', ref: { extension: 'quicklinks', command: 'edit' }, argument: title, title: 'Edit' },
      ],
      ...extra,
    });
  const withLinks = [...items, quicklink('GitHub Search'), command('Get Help')];

  it('offers an item with what’s typed after its title', () => {
    const [results] = buildRootSections(withLinks, 'gh waypoint');
    expect(results?.title).toBe('Results');
    const row = results?.items[0];
    expect(row).toMatchObject({
      id: 'text:quicklink:GitHub Search',
      title: 'GitHub Search',
      subtitle: '“waypoint”',
      titlePositions: [0, 3],
      rootItemId: 'quicklink:GitHub Search',
    });
    expect(row?.actions).toEqual([
      { type: 'open-command', ref: open, argument: 'GitHub Search\nwaypoint', title: 'Open Quicklink' },
      {
        type: 'open-command',
        ref: { extension: 'quicklinks', command: 'edit' },
        argument: 'GitHub Search',
        title: 'Edit',
      },
    ]);
    expect(countRootMatches(withLinks, 'gh waypoint').command).toBe(1);
  });

  it('shows the item itself while the search still matches its title', () => {
    const [results] = buildRootSections(withLinks, 'github se');
    expect(results?.items[0]).toMatchObject({
      id: 'quicklink:GitHub Search',
      subtitle: 'github.com/search?q={argument}',
    });
    expect(results?.items.some((item) => item.id.startsWith('text:'))).toBe(false);
  });

  it('ranks it among the other results by how well the title part matches', () => {
    const ids = buildRootSections([...withLinks, command('GH Waypoint Sync')], 'gh waypoint')[0]?.items.map(
      (item) => item.id,
    );
    expect(ids).toEqual(['command:x/GH Waypoint Sync', 'text:quicklink:GitHub Search']);
  });

  it('is offered under “Use … with” with the whole search', () => {
    const sections = buildRootSections(withLinks, 'rust lifetimes');
    const useWith = sections.find((section) => section.title === 'Use “rust lifetimes” with…');
    const row = useWith?.items.find((item) => item.id === 'fallback:quicklink:GitHub Search');
    expect(row?.subtitle).toBe('github.com/search?q={argument}');
    expect(row?.actions[0]).toEqual({
      type: 'open-command',
      ref: open,
      argument: 'GitHub Search\nrust lifetimes',
      title: 'Open Quicklink',
    });
  });

  it('works in the Commands tab too', () => {
    const [tab] = buildRootSections(withLinks, 'gh cats', 'command');
    expect(tab?.items[0]?.id).toBe('text:quicklink:GitHub Search');
  });
});

describe('items only shown when searching', () => {
  const snippet = command('Email Signature', { id: 'snippet:sig', keywords: ['!sig'], searchOnly: true });
  const withSnippet = [...items, snippet];

  it('leaves them out of the lists shown before anything is typed', () => {
    const shown = buildRootSections(withSnippet, '').flatMap((s) => s.items.map((i) => i.id));
    expect(shown).not.toContain('snippet:sig');
    const used = buildRootSections([...items, { ...snippet, frecency: 9 }], '').flatMap((s) =>
      s.items.map((i) => i.id),
    );
    expect(used).not.toContain('snippet:sig');
    expect(buildRootSections(withSnippet, '', 'command').flatMap((s) => s.items.map((i) => i.id))).not.toContain(
      'snippet:sig',
    );
  });

  it('finds them by title or keyword', () => {
    expect(buildRootSections(withSnippet, '!sig')[0]?.items[0]).toMatchObject({ id: 'snippet:sig' });
    expect(buildRootSections(withSnippet, 'email sig')[0]?.items[0]).toMatchObject({ id: 'snippet:sig' });
    expect(buildRootSections(withSnippet, 'email sig')[0]?.items[0]).not.toHaveProperty('searchOnly');
  });
});

describe('asUrl', () => {
  it.each([
    ['https://example.com/a?b=c', 'https://example.com/a?b=c'],
    ['example.com', 'https://example.com'],
    ['www.example.io/path', 'https://www.example.io/path'],
    ['notes.txt', null],
    ['hello world', null],
    ['2+2', null],
  ])('%s → %s', (query, expected) => {
    expect(asUrl(query)).toBe(expected);
  });
});

describe('filter tabs', () => {
  it('keeps notes and clipboard out of the empty root', () => {
    const shown = buildRootSections(items, '').flatMap((s) => s.items.map((i) => i.title));
    expect(shown).not.toContain('Groceries');
    expect(shown).not.toContain('oat milk barista edition');
  });

  it('adds a taste of matching notes and clipboard entries to All', () => {
    const sections = buildRootSections(items, 'oat milk');
    expect(sections.map((s) => s.title)).toEqual(['Notes', 'Clipboard', 'Use “oat milk” with…']);
    expect(sections[0]?.items[0]?.title).toBe('Groceries');
    expect(sections[0]?.items[0]?.detail).toEqual({ body: '- oat milk\n- sourdough' });
  });

  it('lists everything of one kind in its tab, newest first when empty', () => {
    expect(titles2(buildRootSections(items, '', 'note'))).toEqual([['Recent notes', ['Groceries', 'Trip to Lisbon']]]);
    expect(titles2(buildRootSections(items, '', 'application'))).toEqual([
      ['Applications', ['Calculator', 'Calendar', 'Safari']],
    ]);
    expect(titles2(buildRootSections(items, 'safari', 'note'))).toEqual([['Notes', ['Trip to Lisbon']]]);
  });

  it('only records usage for apps and commands', () => {
    const [notes] = buildRootSections(items, '', 'note');
    expect(notes?.items[0]?.rootItemId).toBeUndefined();
    const [apps] = buildRootSections(items, '', 'application');
    expect(apps?.items[0]?.rootItemId).toBe('app:/Applications/Calculator.app');
  });

  it('counts matches per tab', () => {
    expect(countRootMatches(items, 'safari')).toEqual({
      all: 2,
      application: 1,
      command: 0,
      extensions: 0,
      note: 1,
      clipboard: 0,
    });
    expect(countRootMatches(items, '').all).toBe(items.length);
  });
});

describe('Extensions tab', () => {
  const fromExtension = (
    title: string,
    extension: { name: string; title: string; source: 'builtin' | 'bundled' | 'user' },
    extra: Partial<RootItem> = {},
  ): RootItem =>
    command(title, {
      id: `command:${extension.name}/${title}`,
      subtitle: extension.title,
      extension,
      ...extra,
    });
  const docker = { name: 'docker', title: 'Docker', source: 'bundled' as const };
  const github = { name: 'github', title: 'GitHub', source: 'bundled' as const };
  const mine = { name: 'standup', title: 'Standup Notes', source: 'user' as const };
  const system = { name: 'system', title: 'System', source: 'builtin' as const };
  const all: RootItem[] = [
    fromExtension('Search Docker Images', docker),
    fromExtension('Search Docker Containers', docker, { keywords: ['container', 'compose'] }),
    fromExtension('My Pull Requests', github, { keywords: ['review'] }),
    fromExtension('Write Standup', mine, { subtitle: 'For the 9:30 call' }),
    fromExtension('Lock Screen', system),
    app('Docker'),
  ];

  it('lists each extension with its commands, A to Z, leaving out built-in ones', () => {
    const sections = buildRootSections(all, '', 'extensions');
    expect(titles2(sections)).toEqual([
      ['Docker', ['Search Docker Containers', 'Search Docker Images']],
      ['GitHub', ['My Pull Requests']],
      ['Standup Notes', ['Write Standup']],
    ]);
    // The heading names the extension, so rows don't repeat it, but keep their own subtitles.
    expect(sections[0]?.items[0]?.subtitle).toBeUndefined();
    expect(sections[2]?.items[0]?.subtitle).toBe('For the 9:30 call');
    expect(sections[0]?.items[0]?.rootItemId).toBe('command:docker/Search Docker Containers');
    expect(sections[0]?.items[0]).not.toHaveProperty('extension');
  });

  it("finds commands by their own words or their extension's name", () => {
    expect(titles2(buildRootSections(all, 'review', 'extensions'))).toEqual([['GitHub', ['My Pull Requests']]]);
    expect(titles2(buildRootSections(all, 'docker', 'extensions'))).toEqual([
      ['Docker', ['Search Docker Containers', 'Search Docker Images']],
    ]);
    expect(buildRootSections(all, 'lock', 'extensions')).toEqual([]);
  });

  it('counts the commands that match', () => {
    expect(countRootMatches(all, 'docker').extensions).toBe(2);
    expect(countRootMatches(all, '').extensions).toBe(4);
  });
});

function titles2(sections: ReturnType<typeof buildRootSections>) {
  return sections.map((s) => [s.title, s.items.map((i) => i.title)] as const);
}
