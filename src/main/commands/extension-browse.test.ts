import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { ActionResult, CommandContext, ListView } from '../../shared/types';
import { ExtensionCatalog } from '../extensions/catalog';
import { ExtensionInstaller } from '../extensions/installer';
import { tarball } from '../extensions/test-tarball';
import type { CommandRegistry } from '../registry';
import { browseExtensionsCommand, catalogView } from './extension-browse';

const ctx: CommandContext = { query: '', platform: 'darwin' };

const searchResult = {
  objects: [
    {
      downloads: { weekly: 1234 },
      package: {
        name: 'emoji',
        version: '1.0.0',
        description: 'Every emoji.',
        publisher: { username: 'alex' },
        links: { npm: 'https://www.npmjs.com/package/emoji', repository: 'git+https://github.com/alex/emoji.git' },
      },
    },
  ],
};

function setUp(search: () => Response = () => Response.json(searchResult)) {
  const archive = tarball([
    {
      name: 'package/package.json',
      data: JSON.stringify({
        name: 'emoji',
        version: '1.0.0',
        waypoint: { title: 'Emoji', commands: [{ name: 'search', title: 'Search Emoji', mode: 'view' }] },
      }),
    },
    { name: 'package/index.js', data: '' },
  ]);
  const tarballUrl = 'https://registry.npmjs.org/emoji/-/emoji-1.0.0.tgz';
  const routes: Record<string, Buffer | string> = {
    'https://registry.npmjs.org/emoji': JSON.stringify({
      'dist-tags': { latest: '1.0.0' },
      versions: {
        '1.0.0': {
          dist: { tarball: tarballUrl, integrity: `sha512-${createHash('sha512').update(archive).digest('base64')}` },
        },
      },
    }),
    [tarballUrl]: archive,
  };
  const fetch = vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    if (url.startsWith('https://registry.npmjs.org/-/v1/search')) return search();
    const answer = routes[url];
    return answer === undefined ? new Response('', { status: 404 }) : new Response(answer);
  }) as unknown as typeof globalThis.fetch;
  const root = mkdtempSync(join(tmpdir(), 'browse-command-'));
  const installer = new ExtensionInstaller({
    extensionsDir: join(root, 'extensions'),
    stagingDir: join(root, 'staging'),
    fetch,
  });
  const catalog = new ExtensionCatalog({ fetch });
  const registry = {
    loadUserExtensions: vi.fn(async () => ({ loaded: 1, failed: 0 })),
    listExtensions: () => [],
    listCommands: () => [
      {
        ref: { extension: 'emoji', command: 'search' },
        manifest: { name: 'search', title: 'Search Emoji', mode: 'view' },
        extension: { name: 'emoji', title: 'Emoji', source: 'user' },
      },
    ],
  } as unknown as CommandRegistry;
  const command = browseExtensionsCommand({ installer, registry: () => registry, catalog });
  return { command, installer, root };
}

const items = (view: unknown) => (view as ListView).sections.flatMap((section) => section.items);

describe('Browse Extensions', () => {
  it('lists extensions on npm, with what npm says about them', async () => {
    const { command } = setUp();
    const view = (await command.view?.(ctx)) as ListView;
    expect(view.filtering).toBe(false);
    expect(view.sections[0]?.title).toBe('Most installed');
    const [emoji, other] = items(view);
    expect(emoji).toMatchObject({ title: 'emoji', subtitle: 'Every emoji.', accessory: '1.0.0' });
    expect(emoji?.detail?.metadata).toContainEqual({ label: 'Downloads a week', value: '1,234' });
    expect(emoji?.actions.map((action) => action.title)).toEqual([
      'Install Extension…',
      'Open on npm',
      'Open Repository',
      'Copy Package Name',
    ]);
    // Anything not listed can still be installed by its address.
    expect(other?.title).toBe('Install from an Address…');
  });

  it('installs one after showing what it is, then shows its commands', async () => {
    const { command, installer, root } = setUp();
    await command.view?.(ctx);
    const asked = (await command.onAction?.('install', { name: 'emoji' }, ctx)) as ActionResult;
    const yes = items(asked.push)[0];
    expect(yes?.title).toBe('Install Emoji');
    expect(existsSync(join(root, 'extensions', 'emoji'))).toBe(false);

    const action = yes?.actions[0];
    if (action?.type !== 'callback') throw new Error('Expected a callback');
    const done = (await command.onAction?.(action.id, action.payload, ctx)) as ActionResult;
    expect(done).toMatchObject({ pop: true, toast: 'Installed Emoji 1.0.0' });
    expect(items(done.replace).map((item) => item.title)).toEqual(['Search Emoji']);
    expect(installer.find('emoji')?.version).toBe('1.0.0');

    // Listed again, it's marked installed, and offers to update or uninstall instead.
    const listed = items(await command.view?.(ctx))[0];
    expect(listed).toMatchObject({ accessory: 'Installed' });
    expect(listed?.actions.map((a) => a.title)).toContain('Uninstall Extension…');
  });

  it('goes back to the list without it after uninstalling', async () => {
    const { command, installer } = setUp();
    installer.install((await installer.prepare({ kind: 'npm', name: 'emoji' })).id);
    await command.view?.(ctx);
    const asked = (await command.onAction?.('uninstall', { name: 'emoji' }, ctx)) as ActionResult;
    const action = items(asked.push)[0]?.actions[0];
    if (action?.type !== 'callback') throw new Error('Expected a callback');
    const done = (await command.onAction?.(action.id, action.payload, ctx)) as ActionResult;
    expect(done).toMatchObject({ pop: true, toast: 'Uninstalled Emoji' });
    expect(items(done.replace)[0]).toMatchObject({ title: 'emoji', accessory: '1.0.0' });
  });

  it('says when npm can’t be reached, and tries again', async () => {
    let down = true;
    const { command } = setUp(() => (down ? new Response('', { status: 503 }) : Response.json(searchResult)));
    const error = items(await command.view?.(ctx))[0];
    expect(error).toMatchObject({ title: 'npm answered 503. Try again in a moment.' });
    down = false;
    const retried = (await command.onAction?.('retry', undefined, ctx)) as ActionResult;
    expect(items(retried.replace)[0]?.title).toBe('emoji');
  });
});

describe('catalogView', () => {
  it('says how to get listed while nothing is', () => {
    const [none] = items(catalogView([], []));
    expect(none?.title).toBe('No extensions are listed yet');
    expect(none?.subtitle).toContain('waypoint-extension');
  });

  it('offers to install by address when a search finds nothing', () => {
    const [none] = items(catalogView([], [], { query: 'you/tools' }));
    expect(none?.title).toBe('No extensions on npm match “you/tools”');
    expect(none?.actions[0]).toMatchObject({ type: 'open-command', argument: 'you/tools' });
  });
});
