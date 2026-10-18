import { describe, expect, it } from 'vitest';
import { parseExtensionPackage, sanitizeAction, sanitizeActionResult, sanitizeIcon, sanitizeView } from './validate';

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
    const view = sanitizeView({
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
    expect(sanitizeView({ type: 'list', items: [], loading: true }).loading).toBe(true);
    expect(sanitizeView({ type: 'list', items: [], loading: 'yes' })).not.toHaveProperty('loading');
  });

  it('makes item ids unique', () => {
    const view = sanitizeView({ type: 'list', items: [{ title: 'A' }, { title: 'A' }, { id: 'A', title: 'B' }] });
    expect(view.sections[0]?.items.map((i) => i.id)).toEqual(['A', 'A#2', 'A#3']);
  });

  it('rejects things that are not list views', () => {
    expect(() => sanitizeView({ type: 'form' })).toThrow();
    expect(() => sanitizeView(null)).toThrow();
  });
});

describe('sanitizeActionResult', () => {
  it('passes through known fields only', () => {
    expect(sanitizeActionResult({ hide: true, toast: 'Done', evil: 1 })).toEqual({ hide: true, toast: 'Done' });
    expect(sanitizeActionResult(undefined)).toBeUndefined();
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
