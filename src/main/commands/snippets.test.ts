import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { CommandContext, ListView } from '../../shared/types';
import { SnippetStore } from '../entry-store';
import { snippetRootItems, snippetsExtension } from './snippets';

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
  const edit = vi.fn((_id?: string) => {});
  const extension = snippetsExtension({ store, readClipboard, edit });
  return {
    store,
    edit,
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

  it('lists them, pastes, copies, edits and deletes from the list', async () => {
    const { commands, store, edit, extension } = setUp();
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
    expect(await onAction?.('edit', 'plain', ctx())).toEqual({ hide: true });
    expect(edit).toHaveBeenCalledWith('plain');
    expect(await onAction?.('delete', 'plain', ctx())).toMatchObject({ toast: 'Snippet deleted' });
    expect(store.list().map((s) => s.id)).toEqual(['signature']);
  });
});
