import { describe, expect, it } from 'vitest';
import { Action } from './actions';
import { field } from './fields';
import { Icon } from './icons';
import { defineCommand, defineExtension, detail, form, item, list, metadata } from './views';

describe('defineExtension and defineCommand', () => {
  it('return what they are given', () => {
    const command = { view: () => list() };
    const extension = { commands: { greet: command } };
    expect(defineExtension(extension)).toBe(extension);
    expect(defineCommand(command)).toBe(command);
  });
});

describe('list', () => {
  it('makes items one untitled section', () => {
    const one = item({ title: 'One' });
    expect(list({ title: 'Numbers', items: [one] })).toEqual({
      type: 'list',
      title: 'Numbers',
      sections: [{ items: [one] }],
    });
  });

  it('keeps sections and their titles', () => {
    const one = item({ title: 'One' });
    expect(list({ sections: [{ title: 'Odd', items: [one] }], filtering: false, emptyText: 'Nothing' })).toEqual({
      type: 'list',
      filtering: false,
      emptyText: 'Nothing',
      sections: [{ title: 'Odd', items: [one] }],
    });
  });

  it('skips sections and items that are false, null or undefined', () => {
    const one = item({ title: 'One' });
    const busy = false as boolean;
    expect(
      list({ sections: [busy && { items: [one] }, { title: 'All', items: [null, one, undefined, busy && one] }] }),
    ).toEqual({ type: 'list', sections: [{ title: 'All', items: [one] }] });
  });

  it('is an empty list with nothing given', () => {
    expect(list()).toEqual({ type: 'list', sections: [] });
    expect(list({ emptyText: 'No bookmarks yet.' })).toEqual({
      type: 'list',
      emptyText: 'No bookmarks yet.',
      sections: [],
    });
  });
});

describe('item', () => {
  it('uses the title as the id unless given one', () => {
    expect(item({ title: 'Docs' })).toEqual({ id: 'Docs', title: 'Docs', actions: [] });
    expect(item({ id: 'docs', title: 'Docs' }).id).toBe('docs');
  });

  it('keeps the rest of the item as it is', () => {
    const preview = { body: 'Text', metadata: metadata({ Added: 'Today' }) };
    expect(
      item({
        title: 'Docs',
        subtitle: 'electronjs.org',
        accessory: 'Today',
        icon: Icon.emoji('🔖'),
        detail: preview,
        actions: [Action.openUrl('https://www.electronjs.org/docs')],
      }),
    ).toEqual({
      id: 'Docs',
      title: 'Docs',
      subtitle: 'electronjs.org',
      accessory: 'Today',
      icon: { emoji: '🔖' },
      detail: { body: 'Text', metadata: [{ label: 'Added', value: 'Today' }] },
      actions: [{ type: 'open-url', url: 'https://www.electronjs.org/docs' }],
    });
  });

  it('skips actions and keywords that are empty, and leaves out undefined fields', () => {
    const user: string | undefined = undefined;
    const running = false as boolean;
    const built = item({
      title: 'Port 3000',
      subtitle: user,
      keywords: ['3000', user, ''],
      actions: [running && Action.callback('stop', 'Stop'), Action.copy('3000')],
    });
    expect(built).toEqual({ id: 'Port 3000', title: 'Port 3000', keywords: ['3000'], actions: [Action.copy('3000')] });
    expect(built).not.toHaveProperty('subtitle');
    expect(item({ title: 'x', keywords: [user] })).not.toHaveProperty('keywords');
  });
});

describe('detail', () => {
  it('takes the Markdown on its own or with the rest', () => {
    expect(detail('# Hello')).toEqual({ type: 'detail', markdown: '# Hello' });
    expect(detail('# Hello', { title: 'README', loading: true })).toEqual({
      type: 'detail',
      title: 'README',
      markdown: '# Hello',
      loading: true,
    });
    expect(detail({ markdown: '# Hello', title: 'README' })).toEqual({
      type: 'detail',
      markdown: '# Hello',
      title: 'README',
    });
  });

  it('skips empty actions and metadata entries', () => {
    const tagged = false as boolean;
    expect(
      detail('Text', {
        metadata: [{ label: 'Version', value: '1.2.0' }, tagged && { label: 'Tag', value: 'v1' }],
        actions: [Action.copy('Text'), null],
      }),
    ).toEqual({
      type: 'detail',
      markdown: 'Text',
      metadata: [{ label: 'Version', value: '1.2.0' }],
      actions: [{ type: 'copy', text: 'Text' }],
    });
  });
});

describe('form', () => {
  it('builds a form, with the submit action given by its id', () => {
    expect(form({ title: 'New Bookmark', fields: [field.text('url', 'URL')], submit: 'save' })).toEqual({
      type: 'form',
      title: 'New Bookmark',
      fields: [{ type: 'text', id: 'url', title: 'URL' }],
      submit: { id: 'save' },
    });
  });

  it('keeps a submit title and actions, and skips empty fields', () => {
    const advanced = false as boolean;
    expect(
      form({
        fields: [field.text('name', 'Name'), advanced && field.checkbox('private', 'Private')],
        submit: { id: 'save', title: 'Save Bookmark' },
        actions: [Action.openUrl('https://example.com')],
      }),
    ).toEqual({
      type: 'form',
      fields: [{ type: 'text', id: 'name', title: 'Name' }],
      submit: { id: 'save', title: 'Save Bookmark' },
      actions: [{ type: 'open-url', url: 'https://example.com' }],
    });
  });
});

describe('metadata', () => {
  it('turns an object into label–value pairs, in order', () => {
    expect(metadata({ Port: 3000, 'Process ID': '42', Count: 0 })).toEqual([
      { label: 'Port', value: '3000' },
      { label: 'Process ID', value: '42' },
      { label: 'Count', value: '0' },
    ]);
  });

  it('leaves out empty values', () => {
    expect(metadata({ User: undefined, Group: null, Shared: false, Note: '', Kind: 'File' })).toEqual([
      { label: 'Kind', value: 'File' },
    ]);
  });
});
