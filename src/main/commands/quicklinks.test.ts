import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { CommandContext, FormField, FormView, ListView } from '../../shared/types';
import { QuicklinkStore } from '../entry-store';
import { appLabel, quicklinkForm, quicklinkRootItems, quicklinksExtension } from './quicklinks';

const ctx = (argument?: string): CommandContext => ({
  query: '',
  platform: 'linux',
  ...(argument ? { argument } : {}),
});

function setUp(clipboard = 'https://example.com/a b') {
  const store = new QuicklinkStore(join(mkdtempSync(join(tmpdir(), 'quicklinks-')), 'quicklinks.json'));
  store.add({ name: 'GitHub Search', link: 'https://github.com/search?q={argument name="term"}', icon: '🐙' });
  store.add({ name: 'Copied Link', link: '{clipboard}', openWith: '/usr/share/applications/firefox.desktop' });
  const open = vi.fn(async (_link: string, _openWith: string | undefined) => {});
  const editInSettings = vi.fn((_id: string) => {});
  const extension = quicklinksExtension({
    store,
    platform: 'linux',
    open,
    editInSettings,
    apps: () => APPS,
    readClipboard: async () => clipboard,
  });
  return { store, open, editInSettings, commands: extension.commands, extension };
}

const APPS = [
  { name: 'Firefox', path: '/usr/share/applications/firefox.desktop', iconPath: '/icons/firefox.png' },
  { name: 'Visual Studio Code', path: '/usr/share/applications/code.desktop' },
];

/** Each field's default value, by id. */
function defaults(view: unknown): Record<string, unknown> {
  const form = view as FormView;
  expect(form.type).toBe('form');
  return Object.fromEntries(
    form.fields
      .filter((field) => 'id' in field)
      .map((field) => [field.id, 'defaultValue' in field ? field.defaultValue : undefined]),
  );
}

function openWithField(view: FormView) {
  return view.fields.find((field) => 'id' in field && field.id === 'openWith') as Extract<
    FormField,
    { type: 'dropdown' }
  >;
}

const values = (fields: Record<string, string>) => ({ name: '', link: '', openWith: '', icon: '', ...fields });

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

  it('opens only web addresses from a link that starts with a placeholder', async () => {
    for (const copied of ['C:\\Windows\\System32\\calc.exe', 'file:///etc/passwd', '~/.ssh', 'ms-settings:']) {
      const { commands, open } = setUp(copied);
      expect(await commands.open?.run?.(ctx('copied-link'))).toEqual({
        toast: '“Copied Link” only opens web addresses, and that isn’t one',
        toastStyle: 'failure',
      });
      expect(open).not.toHaveBeenCalled();
    }
    const { commands, open } = setUp('example.com/page');
    await commands.open?.run?.(ctx('copied-link'));
    expect(open).toHaveBeenCalledWith('example.com/page', '/usr/share/applications/firefox.desktop');
  });

  it('says so when the quicklink is gone', async () => {
    const { commands } = setUp();
    expect(await commands.open?.run?.(ctx('nope'))).toMatchObject({ toastStyle: 'failure' });
  });

  it('lists them with a preview, and copies and deletes from the list', async () => {
    const { commands, store } = setUp();
    const view = (await commands.search?.view?.(ctx())) as ListView;
    const items = view.sections[0]?.items ?? [];
    expect(view.sections[0]?.title).toBe('2 quicklinks');
    expect(items[0]?.detail?.body).toBe('https://github.com/search?q={term}');
    expect(items[1]).toMatchObject({ accessory: 'firefox', detail: { body: 'https://example.com/a b' } });
    expect(items[0]?.actions.map((action) => action.title)).toEqual([
      'Open Quicklink',
      'Copy Link',
      'Edit Quicklink',
      'Edit in Settings',
      'Delete Quicklink',
      'Create Quicklink',
    ]);

    const onAction = commands.search?.onAction;
    expect(await onAction?.('open', 'github-search', ctx())).toMatchObject({ pop: true, search: 'GitHub Search ' });
    expect(await onAction?.('copy', 'copied-link', ctx())).toEqual({ copy: 'https://example.com/a b' });
    const deleted = await onAction?.('delete', 'github-search', ctx());
    expect(deleted).toMatchObject({ toast: 'Quicklink deleted' });
    expect(store.list().map((q) => q.id)).toEqual(['copied-link']);
  });

  it('edits one from the list in a form, and goes back to the list with the change in it', async () => {
    const { commands, store } = setUp();
    const onAction = commands.search?.onAction;
    const pushed = await onAction?.('edit', 'github-search', ctx());
    const form = pushed?.push as FormView;
    expect(form).toMatchObject({
      title: 'Edit Quicklink',
      submit: { id: 'save:github-search', title: 'Save Quicklink' },
    });
    expect(defaults(form)).toEqual({
      name: 'GitHub Search',
      link: 'https://github.com/search?q={argument name="term"}',
      openWith: '',
      icon: '🐙',
    });

    const saved = await onAction?.(
      'save:github-search',
      values({ name: 'Code Search', link: 'https://github.com/search?q={argument}', icon: '' }),
      ctx(),
    );
    expect(saved).toMatchObject({ pop: true, toast: 'Quicklink saved' });
    const list = saved?.replace as ListView;
    expect(list.sections[0]?.items.map((item) => item.title)).toEqual(['Code Search', 'Copied Link']);
    // Emptied fields are cleared, and the id stays.
    expect(store.get('github-search')).toEqual({
      id: 'github-search',
      name: 'Code Search',
      link: 'https://github.com/search?q={argument}',
    });
  });

  it('makes a new one from the list', async () => {
    const { commands, store } = setUp();
    const onAction = commands.search?.onAction;
    const form = (await onAction?.('create', undefined, ctx()))?.push as FormView;
    expect(form.submit).toEqual({ id: 'save', title: 'Create Quicklink' });
    const saved = await onAction?.(
      'save',
      values({ name: 'Docs', link: 'docs.dev/{argument}', openWith: APPS[0]?.path ?? '' }),
      ctx(),
    );
    expect(saved).toMatchObject({ pop: true, toast: 'Quicklink created' });
    const list = saved?.replace as ListView;
    expect(list.sections[0]?.title).toBe('3 quicklinks');
    expect(store.get('docs')).toEqual({
      id: 'docs',
      name: 'Docs',
      link: 'docs.dev/{argument}',
      openWith: APPS[0]?.path,
    });
  });

  it('keeps the form open with what was typed when the store refuses it', async () => {
    const { commands, store } = setUp();
    const result = await commands.search?.onAction?.('save', values({ name: 'Bad', link: 'not a link' }), ctx());
    expect(result).toEqual({
      toast: 'Use a web address like https://example.com, a path like ~/Documents, or an app’s link like spotify:.',
      toastStyle: 'failure',
    });
    expect(
      await commands.create?.onAction?.(
        'save',
        values({ name: 'Bad', link: 'https://x.dev', icon: 'not an emoji' }),
        ctx(),
      ),
    ).toEqual({
      toast: 'The icon must be an emoji.',
      toastStyle: 'failure',
    });
    expect(await commands.edit?.onAction?.('save:gone', values({ name: 'X', link: 'https://x.dev' }), ctx())).toEqual({
      toast: 'That quicklink doesn’t exist any more.',
      toastStyle: 'failure',
    });
    expect(store.list()).toHaveLength(2);
  });

  it('opens Settings at one with Edit in Settings', async () => {
    const { commands, editInSettings } = setUp();
    expect(await commands.search?.onAction?.('settings', 'copied-link', ctx())).toEqual({ hide: true });
    expect(editInSettings).toHaveBeenCalledWith('copied-link');
  });

  it('makes one with Create Quicklink, going back to an empty root search', async () => {
    const { commands, store } = setUp();
    const form = (await commands.create?.view?.(ctx())) as FormView;
    expect(form).toMatchObject({ title: 'Create Quicklink', submit: { id: 'save' } });
    expect(defaults(form)).toEqual({ name: '', link: '', openWith: '', icon: '' });
    expect(form.fields.find((field) => 'id' in field && field.id === 'link')).toMatchObject({
      required: true,
      info: expect.stringContaining('{clipboard}, {date}, {time}, {datetime} and {uuid}'),
    });

    const result = await commands.create?.onAction?.(
      'save',
      values({ name: 'Plans', link: '~/plans.md', icon: '📋' }),
      ctx(),
    );
    expect(result).toEqual({ pop: true, clearSearch: true, toast: 'Quicklink created' });
    expect(store.get('plans')).toEqual({ id: 'plans', name: 'Plans', link: '~/plans.md', icon: '📋' });
  });

  it('starts from what was typed: a link as the link, anything else as the name', async () => {
    const { commands } = setUp();
    expect(defaults(await commands.create?.view?.(ctx('https://news.ycombinator.com')))).toMatchObject({
      name: '',
      link: 'https://news.ycombinator.com',
    });
    expect(defaults(await commands.create?.view?.(ctx('Team wiki')))).toMatchObject({ name: 'Team wiki', link: '' });
  });

  it('edits one from the root search with ⌘E, going back to the search as it was', async () => {
    const { commands, store } = setUp();
    const form = (await commands.edit?.view?.(ctx('copied-link'))) as FormView;
    expect(form.submit.id).toBe('save:copied-link');
    expect(defaults(form)).toMatchObject({ name: 'Copied Link', openWith: '/usr/share/applications/firefox.desktop' });
    const result = await commands.edit?.onAction?.(
      'save:copied-link',
      values({ name: 'Copied Link', link: '{clipboard}', openWith: '' }),
      ctx(),
    );
    expect(result).toEqual({ pop: true, toast: 'Quicklink saved' });
    expect(store.get('copied-link')).not.toHaveProperty('openWith');
    await expect(async () => commands.edit?.view?.(ctx('gone'))).rejects.toThrow(
      'That quicklink doesn’t exist any more.',
    );
  });
});

describe('quicklinkForm', () => {
  it('offers the installed apps under Open With, after Default', () => {
    const options = openWithField(quicklinkForm({ apps: APPS })).options;
    expect(options).toEqual([
      { value: '', title: 'Default', icon: { builtin: 'app', tint: 'gray' } },
      { value: APPS[0]?.path, title: 'Firefox', icon: { path: '/icons/firefox.png' } },
      { value: APPS[1]?.path, title: 'Visual Studio Code', icon: { path: APPS[1]?.path } },
    ]);
  });

  it('keeps an app named by hand, or no longer installed, as a choice', () => {
    const quicklink = { id: 'plans', name: 'Plans', link: '~/plans.md', openWith: 'Sublime Text' };
    const form = quicklinkForm({ quicklink, apps: APPS });
    expect(openWithField(form).options.map((option) => option.value)).toEqual([
      '',
      'Sublime Text',
      APPS[0]?.path,
      APPS[1]?.path,
    ]);
    expect(openWithField(form).defaultValue).toBe('Sublime Text');
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
