import { describe, expect, it } from 'vitest';
import type { FormView, ListView } from '../../shared/types';
import { parseExtensionPackage, sanitizeAction, sanitizeActionResult, sanitizeIcon, sanitizeView } from './validate';

/** A view that must have come back as a list. */
function list(value: unknown): ListView {
  const view = sanitizeView(value);
  if (view.type !== 'list') throw new Error(`Expected a list, got ${view.type}`);
  return view;
}

function form(value: Record<string, unknown>): FormView {
  const view = sanitizeView({ type: 'form', submit: { id: 'save' }, ...value });
  if (view.type !== 'form') throw new Error(`Expected a form, got ${view.type}`);
  return view;
}

const validPackage = {
  name: 'hello-world',
  main: 'index.js',
  waypoint: {
    title: 'Hello World',
    icon: '👋',
    commands: [
      { name: 'greet', title: 'Say Hello', mode: 'view', keywords: ['hi'] },
      { name: 'shout', title: 'Shout', mode: 'no-view', fallback: true, platforms: ['darwin', 'beos'] },
    ],
  },
};

describe('parseExtensionPackage', () => {
  it('reads a valid package', () => {
    const { manifest, entry } = parseExtensionPackage(validPackage, '/ext/hello-world');
    expect(entry).toBe('/ext/hello-world/index.js');
    expect(manifest).toEqual({
      name: 'hello-world',
      title: 'Hello World',
      icon: { emoji: '👋' },
      commands: [
        { name: 'greet', title: 'Say Hello', mode: 'view', keywords: ['hi'] },
        { name: 'shout', title: 'Shout', mode: 'no-view', fallback: true, platforms: ['darwin'] },
      ],
    });
  });

  it('strips npm scopes from the name', () => {
    const { manifest } = parseExtensionPackage({ ...validPackage, name: '@someone/hello-world' }, '/ext/x');
    expect(manifest.name).toBe('hello-world');
  });

  it('resolves image icons relative to the extension folder', () => {
    const pkg = { ...validPackage, waypoint: { ...validPackage.waypoint, icon: 'assets/icon.png' } };
    expect(parseExtensionPackage(pkg, '/ext/hello').manifest.icon).toEqual({ path: '/ext/hello/assets/icon.png' });
  });

  it('still reads the openPalette section from before the rename', () => {
    const { waypoint, ...rest } = validPackage;
    const { manifest } = parseExtensionPackage({ ...rest, openPalette: waypoint }, '/ext/hello-world');
    expect(manifest.title).toBe('Hello World');
  });

  it.each([
    ['a non-object', 'nope'],
    ['an invalid name', { ...validPackage, name: 'Hello World' }],
    ['a missing waypoint section', { name: 'x' }],
    ['no commands', { ...validPackage, waypoint: { title: 'X', commands: [] } }],
    ['a command without mode', { ...validPackage, waypoint: { title: 'X', commands: [{ name: 'a', title: 'A' }] } }],
    [
      'duplicate command names',
      {
        ...validPackage,
        waypoint: {
          title: 'X',
          commands: [
            { name: 'a', title: 'A', mode: 'view' },
            { name: 'a', title: 'B', mode: 'view' },
          ],
        },
      },
    ],
    ['an entry outside the folder', { ...validPackage, main: '../evil.js' }],
  ])('rejects %s', (_label, pkg) => {
    expect(() => parseExtensionPackage(pkg, '/ext/x')).toThrow();
  });
});

describe('sanitizeIcon', () => {
  it('accepts emoji, builtin glyphs and image paths', () => {
    expect(sanitizeIcon('🎉')).toEqual({ emoji: '🎉' });
    expect(sanitizeIcon({ builtin: 'globe', tint: 'blue' })).toEqual({ builtin: 'globe', tint: 'blue' });
    expect(sanitizeIcon({ builtin: 'globe', tint: 'neon' })).toEqual({ builtin: 'globe' });
    expect(sanitizeIcon('/abs/icon.png')).toEqual({ path: '/abs/icon.png' });
    expect(sanitizeIcon({ path: '/Applications/Safari.app' })).toEqual({ path: '/Applications/Safari.app' });
  });

  it('counts an emoji made of several code points as one', () => {
    expect(sanitizeIcon('🧑🏻\u200d🤝\u200d🧑🏻')).toEqual({ emoji: '🧑🏻\u200d🤝\u200d🧑🏻' });
    expect(sanitizeIcon({ emoji: '🏳️\u200d🌈' })).toEqual({ emoji: '🏳️\u200d🌈' });
    expect(sanitizeIcon('JS')).toEqual({ emoji: 'JS' });
    expect(sanitizeIcon('ABCD')).toBeUndefined();
  });

  it('rejects unknown shapes', () => {
    expect(sanitizeIcon({ builtin: 'unicorn' })).toBeUndefined();
    expect(sanitizeIcon('relative.png')).toBeUndefined();
    expect(sanitizeIcon('way too long to be an emoji')).toBeUndefined();
    expect(sanitizeIcon(42)).toBeUndefined();
  });
});

describe('sanitizeAction', () => {
  it('keeps valid actions', () => {
    expect(sanitizeAction({ type: 'copy', text: 'hi', title: 'Copy' })).toEqual({
      type: 'copy',
      text: 'hi',
      title: 'Copy',
    });
    expect(
      sanitizeAction({ type: 'callback', id: 'del', title: 'Delete', style: 'destructive', payload: { n: 1 } }),
    ).toEqual({
      type: 'callback',
      id: 'del',
      title: 'Delete',
      style: 'destructive',
      payload: { n: 1 },
    });
  });

  it('keeps an action out of ⌘↵ only when it says so plainly', () => {
    expect(sanitizeAction({ type: 'copy', text: 'hi', panelOnly: true })).toEqual({
      type: 'copy',
      text: 'hi',
      panelOnly: true,
    });
    expect(sanitizeAction({ type: 'copy', text: 'hi', panelOnly: 'yes' })).toEqual({ type: 'copy', text: 'hi' });
  });

  it('drops invalid actions', () => {
    expect(sanitizeAction({ type: 'open-path', path: 'relative/path' })).toBeUndefined();
    expect(sanitizeAction({ type: 'callback', id: 'x' })).toBeUndefined();
    expect(sanitizeAction({ type: 'callback', id: 'x', title: 'X', payload: () => 1 })).toBeUndefined();
    expect(sanitizeAction({ type: 'rm-rf' })).toBeUndefined();
  });
});

describe('sanitizeView', () => {
  it('accepts items as a shorthand for one section and drops bad items', () => {
    const view = sanitizeView({
      type: 'list',
      title: 'Greetings',
      items: [{ title: 'Hello', actions: [{ type: 'copy', text: 'Hello' }] }, { nope: true }, 'junk'],
    });
    expect(view).toEqual({
      type: 'list',
      title: 'Greetings',
      sections: [{ items: [{ id: 'Hello', title: 'Hello', actions: [{ type: 'copy', text: 'Hello' }] }] }],
    });
  });

  it('keeps a valid detail and drops broken metadata', () => {
    const view = list({
      type: 'list',
      items: [
        {
          title: 'Groceries',
          detail: {
            title: 'Groceries',
            body: '- oat milk',
            metadata: [{ label: 'Edited', value: 'now' }, { label: 7 }],
          },
        },
        { title: 'No body', detail: { title: 'x' } },
      ],
    });
    expect(view.sections[0]?.items[0]?.detail).toEqual({
      title: 'Groceries',
      body: '- oat milk',
      metadata: [{ label: 'Edited', value: 'now' }],
    });
    expect(view.sections[0]?.items[1]?.detail).toBeUndefined();
  });

  it('keeps a list that is still loading, and nothing that only looks like it', () => {
    expect(list({ type: 'list', items: [], loading: true }).loading).toBe(true);
    expect(sanitizeView({ type: 'list', items: [], loading: 'yes' })).not.toHaveProperty('loading');
  });

  it('keeps a grid, with its columns kept to what fits', () => {
    expect(list({ type: 'list', items: [], layout: 'grid' })).toMatchObject({ layout: 'grid' });
    expect(list({ type: 'list', items: [], layout: 'grid' })).not.toHaveProperty('columns');
    expect(list({ type: 'list', items: [], layout: 'grid', columns: 6.4 }).columns).toBe(6);
    expect(list({ type: 'list', items: [], layout: 'grid', columns: 40 }).columns).toBe(10);
    expect(list({ type: 'list', items: [], layout: 'grid', columns: 1 }).columns).toBe(3);
    expect(list({ type: 'list', items: [], layout: 'grid', columns: '6' })).not.toHaveProperty('columns');
    expect(list({ type: 'list', items: [], layout: 'tiles', columns: 6 })).not.toHaveProperty('layout');
    expect(list({ type: 'list', items: [], columns: 6 })).not.toHaveProperty('columns');
  });

  it('makes item ids unique', () => {
    const view = list({ type: 'list', items: [{ title: 'A' }, { title: 'A' }, { id: 'A', title: 'B' }] });
    expect(view.sections[0]?.items.map((i) => i.id)).toEqual(['A', 'A#2', 'A#3']);
  });

  it('keeps a preview in Markdown, and needs a body or Markdown', () => {
    const view = list({
      type: 'list',
      items: [
        { title: 'Readme', detail: { markdown: '# Hello\n\n**there**' } },
        { title: 'Both', detail: { body: 'plain', markdown: 7 } },
        { title: 'Neither', detail: { title: 'x', markdown: null } },
      ],
    });
    const [readme, both, neither] = view.sections[0]?.items ?? [];
    expect(readme?.detail).toEqual({ markdown: '# Hello\n\n**there**' });
    expect(both?.detail).toEqual({ body: 'plain' });
    expect(neither?.detail).toBeUndefined();
  });

  it('rejects things that are not views', () => {
    expect(() => sanitizeView({ type: 'grid' })).toThrow('"list", "detail" or "form"');
    expect(() => sanitizeView(null)).toThrow();
  });
});

describe('sanitizeView with a detail view', () => {
  it('keeps the text, metadata, actions and loading', () => {
    expect(
      sanitizeView({
        type: 'detail',
        title: 'README',
        markdown: '# Waypoint\n\n<b>raw</b>',
        metadata: [{ label: 'Version', value: '1.2.0' }, { label: 'Broken' }],
        actions: [{ type: 'copy', text: 'x' }, { type: 'nope' }],
        loading: true,
        evil: true,
      }),
    ).toEqual({
      type: 'detail',
      title: 'README',
      markdown: '# Waypoint\n\n<b>raw</b>',
      metadata: [{ label: 'Version', value: '1.2.0' }],
      actions: [{ type: 'copy', text: 'x' }],
      loading: true,
    });
  });

  it('shows an empty page for missing text, and cuts very long text', () => {
    expect(sanitizeView({ type: 'detail', loading: true })).toEqual({ type: 'detail', markdown: '', loading: true });
    const view = sanitizeView({ type: 'detail', markdown: 'x'.repeat(200_000), loading: 'yes' });
    // As much as the launcher can parse quickly, however it's written.
    expect(view).toEqual({ type: 'detail', markdown: 'x'.repeat(50_000) });
  });

  it('keeps at most 24 metadata entries and 50 actions', () => {
    const view = sanitizeView({
      type: 'detail',
      markdown: '',
      metadata: Array.from({ length: 30 }, (_, i) => ({ label: `L${i}`, value: 'v' })),
      actions: Array.from({ length: 60 }, (_, i) => ({ type: 'copy', text: String(i) })),
    });
    expect(view.type === 'detail' && view.metadata).toHaveLength(24);
    expect(view.type === 'detail' && view.actions).toHaveLength(50);
  });
});

describe('sanitizeView with a form', () => {
  it('keeps every kind of field', () => {
    const view = form({
      title: 'New Quicklink',
      submit: { id: 'create', title: 'Create Quicklink' },
      actions: [{ type: 'open-url', url: 'https://example.com', title: 'Help' }],
      fields: [
        { type: 'text', id: 'name', title: 'Name', placeholder: 'GitHub', required: true, info: 'Shown in search' },
        { type: 'password', id: 'token', title: 'Token', defaultValue: 'abc' },
        { type: 'textarea', id: 'notes', title: 'Notes' },
        { type: 'separator' },
        { type: 'checkbox', id: 'pinned', title: 'Pinned', label: 'Keep at the top', defaultValue: true },
        {
          type: 'dropdown',
          id: 'browser',
          title: 'Open with',
          defaultValue: 'firefox',
          options: [
            { value: 'default', title: 'Default Browser', icon: { builtin: 'globe' } },
            { value: 'firefox', title: 'Firefox' },
          ],
        },
        { type: 'description', title: 'Tip', text: 'Use {query} for what you type.' },
      ],
    });
    expect(view).toEqual({
      type: 'form',
      title: 'New Quicklink',
      submit: { id: 'create', title: 'Create Quicklink' },
      actions: [{ type: 'open-url', url: 'https://example.com', title: 'Help' }],
      fields: [
        { type: 'text', id: 'name', title: 'Name', placeholder: 'GitHub', required: true, info: 'Shown in search' },
        { type: 'password', id: 'token', title: 'Token', defaultValue: 'abc' },
        { type: 'textarea', id: 'notes', title: 'Notes' },
        { type: 'separator' },
        { type: 'checkbox', id: 'pinned', title: 'Pinned', label: 'Keep at the top', defaultValue: true },
        {
          type: 'dropdown',
          id: 'browser',
          title: 'Open with',
          defaultValue: 'firefox',
          options: [
            { value: 'default', title: 'Default Browser', icon: { builtin: 'globe' } },
            { value: 'firefox', title: 'Firefox' },
          ],
        },
        { type: 'description', title: 'Tip', text: 'Use {query} for what you type.' },
      ],
    });
  });

  it('needs a submit action with an id', () => {
    expect(() => sanitizeView({ type: 'form', fields: [] })).toThrow('submit');
    expect(() => sanitizeView({ type: 'form', fields: [], submit: { title: 'Save' } })).toThrow('submit');
    expect(form({ fields: 'nope' })).toEqual({ type: 'form', fields: [], submit: { id: 'save' } });
  });

  it('drops fields without a usable id, and later fields with the same id', () => {
    const view = form({
      fields: [
        { type: 'text', id: 'name', title: 'Name' },
        { type: 'text', id: 'name', title: 'Name again' },
        { type: 'checkbox', id: 'name', title: 'Also name' },
        { type: 'text', title: 'No id' },
        { type: 'text', id: 42, title: 'Number id' },
        { type: 'text', id: '__proto__', title: 'Prototype' },
        { type: 'text', id: 'x'.repeat(101), title: 'Too long' },
        { type: 'color', id: 'tint', title: 'Unknown type' },
        'junk',
      ],
    });
    expect(view.fields).toEqual([{ type: 'text', id: 'name', title: 'Name' }]);
  });

  it('leaves out default values of the wrong kind', () => {
    const view = form({
      fields: [
        { type: 'text', id: 'a', title: 'A', defaultValue: 42, required: 'yes' },
        { type: 'checkbox', id: 'b', title: 'B', defaultValue: 'true' },
        { type: 'dropdown', id: 'c', title: 'C', defaultValue: 'missing', options: [{ value: 'x', title: 'X' }] },
      ],
    });
    expect(view.fields).toEqual([
      { type: 'text', id: 'a', title: 'A' },
      { type: 'checkbox', id: 'b', title: 'B' },
      { type: 'dropdown', id: 'c', title: 'C', options: [{ value: 'x', title: 'X' }] },
    ]);
  });

  it('drops dropdowns with nothing to pick, and options that repeat or are broken', () => {
    const view = form({
      fields: [
        { type: 'dropdown', id: 'empty', title: 'Empty', options: [] },
        { type: 'dropdown', id: 'none', title: 'None' },
        {
          type: 'dropdown',
          id: 'some',
          title: 'Some',
          options: [
            { value: 'a', title: 'A' },
            { value: 'a', title: 'A again' },
            { title: 'No value' },
            { value: 'b' },
          ],
        },
      ],
    });
    expect(view.fields).toEqual([
      {
        type: 'dropdown',
        id: 'some',
        title: 'Some',
        options: [
          { value: 'a', title: 'A' },
          { value: 'b', title: 'b' },
        ],
      },
    ]);
  });

  it('drops descriptions without text and keeps a title-less field', () => {
    const view = form({
      fields: [
        { type: 'description', title: 'Empty' },
        { type: 'text', id: 'q' },
        { type: 'separator', id: 'x' },
      ],
    });
    expect(view.fields).toEqual([{ type: 'text', id: 'q', title: '' }, { type: 'separator' }]);
  });

  it('caps the fields, the options and the text', () => {
    const view = form({
      submit: { id: 'save', title: 'S'.repeat(300) },
      fields: [
        {
          type: 'dropdown',
          id: 'many',
          title: 'Many',
          options: Array.from({ length: 600 }, (_, i) => ({ value: String(i), title: `Option ${i}` })),
        },
        { type: 'text', id: 'long', title: 'T'.repeat(300), defaultValue: 'x'.repeat(20_000) },
        { type: 'textarea', id: 'page', title: 'Page', defaultValue: 'x'.repeat(200_000) },
        ...Array.from({ length: 60 }, (_, i) => ({ type: 'checkbox', id: `c${i}`, title: `C${i}` })),
      ],
    });
    expect(view.fields).toHaveLength(50);
    expect(view.submit.title).toHaveLength(100);
    const [many, long, page] = view.fields;
    expect(many?.type === 'dropdown' && many.options).toHaveLength(500);
    expect(long?.type === 'text' && long.title).toHaveLength(100);
    expect(long?.type === 'text' && long.defaultValue).toHaveLength(10_000);
    expect(page?.type === 'textarea' && page.defaultValue).toHaveLength(100_000);
  });

  it('resolves dropdown icons relative to the extension', () => {
    const view = sanitizeView(
      {
        type: 'form',
        submit: { id: 'save' },
        fields: [{ type: 'dropdown', id: 'd', title: 'D', options: [{ value: 'a', title: 'A', icon: 'a.png' }] }],
      },
      '/ext/me',
    );
    expect(view.type === 'form' && view.fields[0]).toEqual({
      type: 'dropdown',
      id: 'd',
      title: 'D',
      options: [{ value: 'a', title: 'A', icon: { path: '/ext/me/a.png' } }],
    });
  });
});

describe('sanitizeActionResult', () => {
  it('passes through known fields only', () => {
    expect(sanitizeActionResult({ hide: true, toast: 'Done', evil: 1 })).toEqual({ hide: true, toast: 'Done' });
    expect(sanitizeActionResult(undefined)).toBeUndefined();
  });

  it('opens a detail view or a form, and throws for a broken one', () => {
    expect(sanitizeActionResult({ push: { type: 'detail', markdown: '# Hi' }, pop: true })).toEqual({
      push: { type: 'detail', markdown: '# Hi' },
      pop: true,
    });
    expect(sanitizeActionResult({ replace: { type: 'form', submit: { id: 'go' }, fields: [] } })).toEqual({
      replace: { type: 'form', submit: { id: 'go' }, fields: [] },
    });
    expect(() => sanitizeActionResult({ push: { type: 'form', fields: [] } })).toThrow();
  });

  it('lets a command copy or paste text', () => {
    expect(sanitizeActionResult({ paste: '✨', copy: 42 })).toEqual({ paste: '✨' });
    expect(sanitizeActionResult({ search: 'feat: ' })).toEqual({ search: 'feat: ' });
    expect(sanitizeActionResult({ copy: 'x'.repeat(2_000_000) })?.copy).toHaveLength(1_000_000);
  });
});

describe('paste actions', () => {
  it('are kept like copy actions', () => {
    expect(sanitizeAction({ type: 'paste', text: '🎉', title: 'Paste Emoji' })).toEqual({
      type: 'paste',
      text: '🎉',
      title: 'Paste Emoji',
    });
    expect(sanitizeAction({ type: 'paste' })).toBeUndefined();
  });
});
