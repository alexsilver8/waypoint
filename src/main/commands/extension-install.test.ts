import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { ActionResult, CommandContext, FormView, ListView } from '../../shared/types';
import { ExtensionInstaller } from '../extensions/installer';
import { tarball } from '../extensions/test-tarball';
import type { CommandRegistry } from '../registry';
import { confirmInstall, extensionInstalls, installExtensionCommand } from './extension-install';

const ctx: CommandContext = { query: '', platform: 'darwin' };

function setUp() {
  const archive = tarball([
    {
      name: 'package/package.json',
      data: JSON.stringify({
        name: 'emoji',
        version: '1.0.0',
        waypoint: {
          title: 'Emoji',
          description: 'Every emoji.',
          commands: [{ name: 'search', title: 'Search Emoji', mode: 'view' }],
        },
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
    const answer = routes[String(input)];
    return answer === undefined ? new Response('', { status: 404 }) : new Response(answer);
  }) as unknown as typeof globalThis.fetch;
  const root = mkdtempSync(join(tmpdir(), 'install-command-'));
  const installer = new ExtensionInstaller({
    extensionsDir: join(root, 'extensions'),
    stagingDir: join(root, 'staging'),
    fetch,
  });
  const loadUserExtensions = vi.fn(async () => ({ loaded: 1, failed: 0 }));
  const registry = {
    loadUserExtensions,
    listExtensions: () => [],
    listCommands: () => [
      {
        ref: { extension: 'emoji', command: 'search' },
        manifest: { name: 'search', title: 'Search Emoji', mode: 'view' },
        extension: { name: 'emoji', title: 'Emoji', source: 'user' },
      },
    ],
  } as unknown as CommandRegistry;
  return { installer, loadUserExtensions, root, registry: () => registry };
}

describe('Install Extension', () => {
  it('shows what it would install and from where, and installs it once confirmed', async () => {
    const { installer, registry, loadUserExtensions, root } = setUp();
    const command = installExtensionCommand({ installer, registry });
    const form = (await command.view?.({ ...ctx, argument: 'emoji' })) as FormView;
    expect(form.fields[0]).toMatchObject({ id: 'source', defaultValue: 'emoji' });

    const checked = (await command.onAction?.('check', { source: 'emoji' }, ctx)) as ActionResult;
    const confirm = checked.push as ListView;
    expect(confirm.title).toBe('Install Emoji');
    const [yes, no] = confirm.sections[0]?.items ?? [];
    expect(yes).toMatchObject({ title: 'Install Emoji', subtitle: '1.0.0, from npm (emoji)' });
    expect(yes?.detail?.body).toContain('anything you can on this computer');
    expect(yes?.detail?.body).toContain('- Search Emoji');
    expect(yes?.detail?.metadata).toContainEqual({
      label: 'Downloaded from',
      value: 'https://registry.npmjs.org/emoji/-/emoji-1.0.0.tgz',
    });
    expect(no?.title).toBe('Cancel');
    expect(loadUserExtensions).not.toHaveBeenCalled();
    expect(existsSync(join(root, 'extensions', 'emoji'))).toBe(false);

    const action = yes?.actions[0];
    if (action?.type !== 'callback') throw new Error('Expected a callback');
    const done = (await command.onAction?.(action.id, action.payload, ctx)) as ActionResult;
    expect(done).toMatchObject({ pop: true, toast: 'Installed Emoji 1.0.0', toastStyle: 'success' });
    // The form makes way for its commands.
    expect((done.replace as ListView).sections[0]?.items.map((item) => item.title)).toEqual(['Search Emoji']);
    expect(loadUserExtensions).toHaveBeenCalledTimes(1);
    expect(installer.find('emoji')?.version).toBe('1.0.0');
  });

  it('says what’s wrong, leaving the form open', async () => {
    const { installer, registry } = setUp();
    const command = installExtensionCommand({ installer, registry });
    expect(await command.onAction?.('check', { source: 'emoji@^1' }, ctx)).toMatchObject({ toastStyle: 'failure' });
    expect(await command.onAction?.('check', { source: 'nope' }, ctx)).toEqual({
      toast: "There's no npm package called “nope”.",
      toastStyle: 'failure',
    });
  });

  it('cancels without installing anything', async () => {
    const { installer, registry, root } = setUp();
    const command = installExtensionCommand({ installer, registry });
    await command.onAction?.('check', { source: 'emoji' }, ctx);
    expect(await command.onAction?.('cancel', undefined, ctx)).toEqual({ pop: true });
    expect(existsSync(join(root, 'extensions', 'emoji'))).toBe(false);
  });
});

describe('extensionInstalls', () => {
  it('says an extension is up to date, and asks before uninstalling it', async () => {
    const { installer, registry } = setUp();
    installer.install((await installer.prepare({ kind: 'npm', name: 'emoji' })).id);
    const installs = extensionInstalls({ installer, registry });
    const after = () => ({ type: 'list', sections: [] }) as ListView;

    expect(await installs.onAction('update', { name: 'emoji' }, after)).toEqual({
      toast: 'Emoji is up to date',
      toastStyle: 'success',
    });
    const asked = (await installs.onAction('uninstall', { name: 'emoji' }, after)) as ActionResult;
    const yes = (asked.push as ListView).sections[0]?.items[0];
    expect(yes?.title).toBe('Uninstall Emoji');
    expect(installer.find('emoji')).toBeDefined();
    const action = yes?.actions[0];
    if (action?.type !== 'callback') throw new Error('Expected a callback');
    expect(await installs.onAction(action.id, action.payload, after)).toMatchObject({
      pop: true,
      toast: 'Uninstalled Emoji',
    });
    expect(installer.find('emoji')).toBeUndefined();
    expect(await installs.onAction('uninstall', { name: 'emoji' }, after)).toMatchObject({ toastStyle: 'failure' });
  });
});

describe('confirmInstall', () => {
  it('says what it replaces when updating', () => {
    const view = confirmInstall({
      id: 'x',
      manifest: { name: 'emoji', title: 'Emoji', commands: [] },
      source: { kind: 'github', owner: 'alex', repo: 'emoji' },
      from: 'https://github.com/alex/emoji/tree/abc',
      commit: 'b'.repeat(40),
      replaces: {
        name: 'emoji',
        title: 'Emoji',
        dir: '/x',
        source: { kind: 'github', owner: 'alex', repo: 'emoji' },
        commit: 'a'.repeat(40),
        installedAt: '',
      },
    }) as ListView;
    const yes = view.sections[0]?.items[0];
    expect(yes).toMatchObject({ title: 'Update Emoji', subtitle: 'bbbbbbb, from github.com/alex/emoji' });
    expect(yes?.detail?.metadata).toContainEqual({ label: 'Replaces', value: 'aaaaaaa' });
  });
});
