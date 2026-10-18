import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EntryError, QuicklinkStore, SnippetStore } from './entry-store';

const tempPath = (name: string) => join(mkdtempSync(join(tmpdir(), 'entries-')), name);
const onDisk = (path: string) => JSON.parse(readFileSync(path, 'utf8'));

afterEach(() => {
  vi.restoreAllMocks();
});

describe('QuicklinkStore', () => {
  it('starts empty, without writing a file', () => {
    const path = tempPath('quicklinks.json');
    const store = new QuicklinkStore(path);
    expect(store.list()).toEqual([]);
    expect(existsSync(path)).toBe(false);
  });

  it('adds, changes and removes quicklinks, saving each time and saying so', () => {
    const path = tempPath('quicklinks.json');
    const store = new QuicklinkStore(path);
    const changes: number[] = [];
    store.on('change', (entries) => changes.push(entries.length));

    const added = store.add({ name: 'GitHub Search', link: 'https://github.com/search?q={argument}' });
    expect(added.id).toBe('github-search');
    expect(store.add({ name: 'GitHub Search', link: 'github.com' }).id).toBe('github-search-2');
    expect(onDisk(path)).toHaveLength(2);

    const updated = store.update('github-search', { name: 'Code Search', icon: '🔎' });
    expect(updated).toEqual({
      id: 'github-search',
      name: 'Code Search',
      link: 'https://github.com/search?q={argument}',
      icon: '🔎',
    });
    expect(store.get('github-search')).toEqual(updated);
    // An empty value clears an optional field.
    expect(store.update('github-search', { icon: '' })).not.toHaveProperty('icon');

    expect(store.remove('github-search-2')).toBe(true);
    expect(store.remove('github-search-2')).toBe(false);
    expect(onDisk(path)).toEqual([
      { id: 'github-search', name: 'Code Search', link: 'https://github.com/search?q={argument}' },
    ]);
    expect(changes).toEqual([1, 2, 2, 2, 1]);
  });

  it('refuses what isn’t valid, saying why, and changes nothing', () => {
    const path = tempPath('quicklinks.json');
    const store = new QuicklinkStore(path);
    expect(() => store.add({ name: ' ', link: 'https://x.com' })).toThrow(new EntryError('It needs a name.'));
    expect(() => store.add({ name: 'X', link: 'not a link' })).toThrow(/^Use a web address/);
    const { id } = store.add({ name: 'X', link: 'https://x.com' });
    expect(() => store.update(id, { link: '' })).toThrow('Add a link.');
    expect(() => store.update('gone', { name: 'Y' })).toThrow('That quicklink doesn’t exist any more.');
    expect(store.list()).toEqual([{ id: 'x', name: 'X', link: 'https://x.com' }]);
  });

  it('leaves out entries it can’t use, with a warning, and keeps the rest', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const path = tempPath('quicklinks.json');
    writeFileSync(path, JSON.stringify([{ name: 'Fine', link: 'https://fine.dev' }, { name: 'Broken' }]));
    expect(new QuicklinkStore(path).list()).toEqual([{ id: 'fine', name: 'Fine', link: 'https://fine.dev' }]);
    expect(warn).toHaveBeenCalledWith('[quicklinks] Ignoring quicklink 2 (“Broken”): it needs a link.');
  });

  it('keeps going with an empty list when the file isn’t JSON', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const path = tempPath('quicklinks.json');
    writeFileSync(path, '{ not json');
    expect(new QuicklinkStore(path).list()).toEqual([]);
  });

  it('writes the entries it can’t use back as they were, where they were', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const path = tempPath('quicklinks.json');
    const broken = { name: 'Half done', lnk: 'https://typo.dev', note: 'kept' };
    writeFileSync(
      path,
      JSON.stringify([
        { name: 'One', link: 'https://one.dev' },
        broken,
        'not even an object',
        { name: 'Two', link: 'two.dev' },
      ]),
    );
    const store = new QuicklinkStore(path);
    expect(store.list().map((q) => q.name)).toEqual(['One', 'Two']);

    store.add({ name: 'Three', link: 'https://three.dev' });
    expect(onDisk(path)).toEqual([
      { id: 'one', name: 'One', link: 'https://one.dev' },
      broken,
      'not even an object',
      { id: 'two', name: 'Two', link: 'two.dev' },
      { id: 'three', name: 'Three', link: 'https://three.dev' },
    ]);
    store.remove('one');
    store.update('two', { name: 'Second' });
    expect(onDisk(path)).toEqual([
      { id: 'two', name: 'Second', link: 'two.dev' },
      broken,
      'not even an object',
      { id: 'three', name: 'Three', link: 'https://three.dev' },
    ]);
  });

  it('changes nothing while the file can’t be read, and says why', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const path = tempPath('quicklinks.json');
    const store = new QuicklinkStore(path);
    store.add({ name: 'One', link: 'https://one.dev' });
    // A half-finished edit by hand.
    const typing = '[{ "name": "One", "link": "https://one.dev" }, { "name": "Tw';
    writeFileSync(path, typing);
    expect(() => store.add({ name: 'Two', link: 'https://two.dev' })).toThrow(
      /^quicklinks\.json can’t be read \(.+\), so nothing was changed\. Fix the file, then try again\.$/,
    );
    expect(() => store.update('one', { name: 'Uno' })).toThrow(EntryError);
    expect(() => store.remove('one')).toThrow(EntryError);
    expect(readFileSync(path, 'utf8')).toBe(typing);
    // What was loaded before still shows.
    expect(store.list().map((q) => q.id)).toEqual(['one']);

    writeFileSync(path, JSON.stringify({ quicklinks: [] }));
    expect(() => store.add({ name: 'Two', link: 'https://two.dev' })).toThrow(/it must be a list/);
    expect(onDisk(path)).toEqual({ quicklinks: [] });

    // Once it's fixed, changes go through again.
    writeFileSync(path, JSON.stringify([{ name: 'One', link: 'https://one.dev' }]));
    store.add({ name: 'Two', link: 'https://two.dev' });
    expect(onDisk(path).map((q: { name: string }) => q.name)).toEqual(['One', 'Two']);
  });

  it('refuses changes when the file couldn’t be read at launch', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const path = tempPath('quicklinks.json');
    writeFileSync(path, '{ not json');
    const store = new QuicklinkStore(path);
    expect(() => store.add({ name: 'One', link: 'https://one.dev' })).toThrow(EntryError);
    expect(readFileSync(path, 'utf8')).toBe('{ not json');
  });

  it('doesn’t save over a change made by hand a moment before', () => {
    const path = tempPath('quicklinks.json');
    const store = new QuicklinkStore(path);
    store.add({ name: 'One', link: 'https://one.dev' });
    writeFileSync(path, JSON.stringify([...onDisk(path), { name: 'By hand', link: 'https://hand.dev' }]));
    store.add({ name: 'Two', link: 'https://two.dev' });
    expect(onDisk(path).map((q: { name: string }) => q.name)).toEqual(['One', 'By hand', 'Two']);
  });

  it('reloads when the file is edited by hand', async () => {
    const path = tempPath('quicklinks.json');
    const store = new QuicklinkStore(path);
    store.watch();
    const changed = new Promise((resolve) => store.once('change', resolve));
    writeFileSync(path, JSON.stringify([{ name: 'Docs', link: 'https://docs.dev/{argument}' }]));
    await changed;
    expect(store.list()).toEqual([{ id: 'docs', name: 'Docs', link: 'https://docs.dev/{argument}' }]);
    store.close();
  });
});

describe('SnippetStore', () => {
  it('adds and changes snippets, keeping their text exactly', () => {
    const path = tempPath('snippets.json');
    const store = new SnippetStore(path);
    const added = store.add({ name: 'Signature', text: 'Thanks,\n  Alex\n', keyword: '!sig' });
    expect(added).toEqual({ id: 'signature', name: 'Signature', text: 'Thanks,\n  Alex\n', keyword: '!sig' });
    expect(() => store.update(added.id, { keyword: '! sig' })).toThrow('The keyword can’t have spaces in it.');
    expect(onDisk(path)).toEqual([added]);
  });

  it('refuses a keyword another snippet has, but not the snippet’s own', () => {
    const path = tempPath('snippets.json');
    const store = new SnippetStore(path);
    store.add({ name: 'Signature', text: 'Thanks', keyword: '!sig' });
    const other = store.add({ name: 'Other', text: 'Other text' });
    expect(() => store.add({ name: 'Copy', text: 'x', keyword: '!sig' })).toThrow(
      new EntryError('“Signature” already has the keyword !sig.'),
    );
    expect(() => store.update(other.id, { keyword: '!SIG' })).toThrow(EntryError);
    expect(store.update('signature', { name: 'Sig', keyword: '!sig' })).toMatchObject({ keyword: '!sig' });
    expect(onDisk(path)).toHaveLength(2);
  });
});
