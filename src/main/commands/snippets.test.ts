import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { CommandContext, FormView, ListView } from '../../shared/types';
import { SnippetStore } from '../entry-store';
import { snippetForm, snippetRootItems, snippetsExtension } from './snippets';

const ctx = (argument?: string): CommandContext => ({
  query: '',
  platform: 'darwin',
  ...(argument ? { argument } : {}),
});

function setUp() {
  const store = new SnippetStore(join(mkdtempSync(join(tmpdir(), 'snippets-')), 'snippets.json'));
  store.add({ name: 'Signature', keyword: '!sig', text: 'Thanks,\nAlex\nRe: {clipboard}' });
  store.add({ name: 'Plain', text: 'Just text' });
  let clipboard = 'first';
  const readClipboard = vi.fn(async () => clipboard);
  const editInSettings = vi.fn((_id: string) => {});
  const extension = snippetsExtension({ store, readClipboard, editInSettings });
  return {
    store,
    editInSettings,
    readClipboard,
    commands: extension.commands,
    extension,
    copy: (text: string) => {
      clipboard = text;
    },
  };
}

describe('snippetRootItems', () => {
  it('lists each snippet, found by name or keyword once something is typed', async () => {
    const { store, readClipboard } = setUp();
    const [signature, plain] = await snippetRootItems(store, () => 0, readClipboard);
    expect(signature).toMatchObject({
      id: 'snippet:signature',
      kind: 'command',
      title: 'Signature',
      subtitle: 'Thanks,',
      keywords: ['!sig'],
      accessory: '!sig',
      searchOnly: true,
      detail: { body: 'Thanks,\nAlex\nRe: first' },
    });
    expect(signature?.actions.map((action) => action.title)).toEqual(['Paste Snippet', 'Copy Snippet', 'Edit Snippet']);
    expect(plain).not.toHaveProperty('keywords');
    expect(readClipboard).toHaveBeenCalledTimes(1);
  });

  it('doesn’t read the clipboard when no snippet uses it', async () => {
    const { store, readClipboard } = setUp();
    store.remove('signature');
    await snippetRootItems(store, () => 0, readClipboard);
    expect(readClipboard).not.toHaveBeenCalled();
  });
});

describe('snippetsExtension', () => {
  it('pastes and copies a snippet, filled in when it’s used', async () => {
    const { commands, copy } = setUp();
    copy('PR #42');
    expect(await commands.paste?.run?.(ctx('signature'))).toEqual({ paste: 'Thanks,\nAlex\nRe: PR #42' });
    copy('PR #43');
    expect(await commands.copy?.run?.(ctx('signature'))).toEqual({ copy: 'Thanks,\nAlex\nRe: PR #43' });
    expect(await commands.paste?.run?.(ctx('gone'))).toMatchObject({ toastStyle: 'failure' });
  });

  it('lists them, pastes, copies and deletes from the list', async () => {
    const { commands, store, editInSettings, extension } = setUp();
    expect(extension.unlisted).toEqual(['paste', 'copy', 'edit']);
    const view = (await commands.search?.view?.(ctx())) as ListView;
    expect(view.sections[0]?.title).toBe('2 snippets');
    expect(view.sections[0]?.items[0]?.detail?.metadata).toEqual([
      { label: 'Keyword', value: '!sig' },
      { label: 'Characters', value: '22' },
    ]);
    const onAction = commands.search?.onAction;
    expect(await onAction?.('paste', 'plain', ctx())).toEqual({ paste: 'Just text' });
    expect(await onAction?.('copy', 'plain', ctx())).toEqual({ copy: 'Just text' });
    expect(await onAction?.('settings', 'plain', ctx())).toEqual({ hide: true });
    expect(editInSettings).toHaveBeenCalledWith('plain');
    expect(await onAction?.('delete', 'plain', ctx())).toMatchObject({ toast: 'Snippet deleted' });
    expect(store.list().map((s) => s.id)).toEqual(['signature']);
  });

  it('edits one from the list in a form, and goes back to the list with the change in it', async () => {
    const { commands, store } = setUp();
    const onAction = commands.search?.onAction;
    const form = (await onAction?.('edit', 'signature', ctx()))?.push as FormView;
    expect(form).toMatchObject({ title: 'Edit Snippet', submit: { id: 'save:signature', title: 'Save Snippet' } });
    expect(form.fields).toMatchObject([
      { type: 'text', id: 'name', defaultValue: 'Signature', required: true },
      { type: 'textarea', id: 'text', defaultValue: 'Thanks,\nAlex\nRe: {clipboard}', required: true },
      { type: 'text', id: 'keyword', defaultValue: '!sig' },
    ]);

    const saved = await onAction?.(
      'save:signature',
      { name: 'Sign-off', text: '  Cheers,\nAlex\n', keyword: '' },
      ctx(),
    );
    expect(saved).toMatchObject({ pop: true, toast: 'Snippet saved' });
    const list = saved?.replace as ListView;
    expect(list.sections[0]?.items[0]?.title).toBe('Sign-off');
    // The text is kept exactly, and the emptied keyword is gone.
    expect(store.get('signature')).toEqual({ id: 'signature', name: 'Sign-off', text: '  Cheers,\nAlex\n' });
  });

  it('refuses a keyword another snippet has, leaving the form open', async () => {
    const { commands, store } = setUp();
    const onAction = commands.search?.onAction;
    expect((await onAction?.('create', undefined, ctx()))?.push).toMatchObject({ submit: { id: 'save' } });
    expect(await onAction?.('save', { name: 'Again', text: 'x', keyword: '!SIG' }, ctx())).toEqual({
      toast: '“Signature” already has the keyword !sig.',
      toastStyle: 'failure',
    });
    expect(await onAction?.('save:plain', { name: 'Plain', text: '   ', keyword: '' }, ctx())).toEqual({
      toast: 'It needs some text.',
      toastStyle: 'failure',
    });
    expect(store.list()).toHaveLength(2);
    expect(await onAction?.('save', { name: 'Again', text: 'x', keyword: '!again' }, ctx())).toMatchObject({
      pop: true,
      toast: 'Snippet created',
    });
  });

  it('makes one with Create Snippet and edits one with ⌘E from the root search', async () => {
    const { commands, store } = setUp();
    const form = (await commands.create?.view?.(ctx())) as FormView;
    expect(form).toEqual(snippetForm());
    expect(form.fields[1]).toMatchObject({
      info: 'Pasted just as it is, with {clipboard}, {date}, {time}, {datetime} and {uuid} filled in.',
    });
    expect(
      await commands.create?.onAction?.('save', { name: 'Address', text: 'Main St 1', keyword: '!addr' }, ctx()),
    ).toEqual({
      pop: true,
      clearSearch: true,
      toast: 'Snippet created',
    });
    expect(store.get('address')).toEqual({ id: 'address', name: 'Address', text: 'Main St 1', keyword: '!addr' });

    const editForm = (await commands.edit?.view?.(ctx('address'))) as FormView;
    expect(editForm.submit.id).toBe('save:address');
    expect(
      await commands.edit?.onAction?.('save:address', { name: 'Home', text: 'Main St 1', keyword: '!addr' }, ctx()),
    ).toEqual({
      pop: true,
      toast: 'Snippet saved',
    });
    await expect(async () => commands.edit?.view?.(ctx('gone'))).rejects.toThrow(
      'That snippet doesn’t exist any more.',
    );
  });
});
