import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { CommandContext, ListView } from '../../shared/types';
import { QuicklinkStore } from '../entry-store';
import { appLabel, quicklinkRootItems, quicklinksExtension } from './quicklinks';

const ctx = (argument?: string): CommandContext => ({
  query: '',
  platform: 'linux',
  ...(argument ? { argument } : {}),
});

function setUp() {
  const store = new QuicklinkStore(join(mkdtempSync(join(tmpdir(), 'quicklinks-')), 'quicklinks.json'));
  store.add({ name: 'GitHub Search', link: 'https://github.com/search?q={argument name="term"}', icon: '🐙' });
  store.add({ name: 'Copied Link', link: '{clipboard}', openWith: '/usr/share/applications/firefox.desktop' });
  const open = vi.fn(async (_link: string, _openWith: string | undefined) => {});
  const edit = vi.fn((_id?: string) => {});
  const extension = quicklinksExtension({
    store,
    platform: 'linux',
    open,
    edit,
    readClipboard: async () => 'https://example.com/a b',
  });
  return { store, open, edit, commands: extension.commands, extension };
}

describe('quicklinkRootItems', () => {
  it('lists each quicklink like a command, the ones with {argument} taking text', () => {
    const { store } = setUp();
    const [github, copied] = quicklinkRootItems(store, (id) => (id === 'quicklink:github-search' ? 3 : 0));
    expect(github).toMatchObject({
      id: 'quicklink:github-search',
      kind: 'command',
      title: 'GitHub Search',
      subtitle: 'github.com/search?q={term}',
      icon: { emoji: '🐙' },
      accessory: 'Quicklink',
      frecency: 3,
      takesText: { ref: { extension: 'quicklinks', command: 'open' }, prefix: 'github-search\n' },
    });
    expect(github?.actions.map((action) => action.title)).toEqual(['Open Quicklink', 'Edit Quicklink']);
    expect(copied).not.toHaveProperty('takesText');
    expect(copied?.icon).toEqual({ builtin: 'link', tint: 'blue' });
  });
});

describe('quicklinksExtension', () => {
  it('keeps the commands its rows run out of the root search', () => {
    expect(setUp().extension.unlisted).toEqual(['open', 'edit']);
  });

  it('opens a quicklink with the text typed for it, percent-encoded', async () => {
    const { commands, open } = setUp();
    expect(await commands.open?.run?.(ctx('github-search\nrust lifetimes'))).toEqual({ hide: true });
    expect(open).toHaveBeenCalledWith('https://github.com/search?q=rust%20lifetimes', undefined);
  });

  it('types the name back into the search when a quicklink needs text and has none', async () => {
    const { commands, open } = setUp();
    expect(await commands.open?.run?.(ctx('github-search'))).toEqual({
      search: 'GitHub Search ',
      toast: 'Type the term, then press Enter',
    });
    expect(open).not.toHaveBeenCalled();
  });

  it('fills in the clipboard and opens with the app it names', async () => {
    const { commands, open } = setUp();
    await commands.open?.run?.(ctx('copied-link'));
    // The link is only a placeholder, so it isn't a URL to encode for.
    expect(open).toHaveBeenCalledWith('https://example.com/a b', '/usr/share/applications/firefox.desktop');
  });

  it('says so when the quicklink is gone', async () => {
    const { commands } = setUp();
    expect(await commands.open?.run?.(ctx('nope'))).toMatchObject({ toastStyle: 'failure' });
  });

  it('lists them with a preview, and copies, edits and deletes from the list', async () => {
    const { commands, store, edit } = setUp();
    const view = (await commands.search?.view?.(ctx())) as ListView;
    const items = view.sections[0]?.items ?? [];
    expect(view.sections[0]?.title).toBe('2 quicklinks');
    expect(items[0]?.detail?.body).toBe('https://github.com/search?q={term}');
    expect(items[1]).toMatchObject({ accessory: 'firefox', detail: { body: 'https://example.com/a b' } });
    expect(items[0]?.actions.map((action) => action.title)).toEqual([
      'Open Quicklink',
      'Copy Link',
      'Edit Quicklink',
      'Delete Quicklink',
      'Create Quicklink',
    ]);

    const onAction = commands.search?.onAction;
    expect(await onAction?.('open', 'github-search', ctx())).toMatchObject({ pop: true, search: 'GitHub Search ' });
    expect(await onAction?.('copy', 'copied-link', ctx())).toEqual({ copy: 'https://example.com/a b' });
    expect(await onAction?.('edit', 'github-search', ctx())).toEqual({ hide: true });
    expect(edit).toHaveBeenCalledWith('github-search');
    const deleted = await onAction?.('delete', 'github-search', ctx());
    expect(deleted).toMatchObject({ toast: 'Quicklink deleted' });
    expect(store.list().map((q) => q.id)).toEqual(['copied-link']);
  });

  it('opens Settings to make a new one', async () => {
    const { commands, edit } = setUp();
    expect(await commands.create?.run?.(ctx())).toEqual({ hide: true });
    expect(edit).toHaveBeenCalledWith();
  });
});

describe('appLabel', () => {
  it('names an app by its file, or as written', () => {
    expect(appLabel('/usr/share/applications/firefox.desktop')).toBe('firefox');
    expect(appLabel('C:\\ProgramData\\Start Menu\\Visual Studio Code.lnk')).toBe('Visual Studio Code');
    expect(appLabel('/Applications/Safari.app/')).toBe('Safari');
    expect(appLabel('Spotify')).toBe('Spotify');
  });
});
