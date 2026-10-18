import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { ExtensionInstaller, INSTALL_RECORD, missingDependencies } from './installer';
import { type TestEntry, tarball } from './test-tarball';

const pkg = (name: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    name,
    version: '1.0.0',
    waypoint: { title: 'Emoji', commands: [{ name: 'search', title: 'Search Emoji', mode: 'view' }] },
    ...extra,
  });

const npmPackage = (files: Record<string, string>, top = 'package'): Buffer =>
  tarball(Object.entries(files).map(([name, data]): TestEntry => ({ name: `${top}/${name}`, data })));

/** A registry and GitHub that answer from a table of addresses. */
function server(routes: Record<string, Buffer | string | number>) {
  return vi.fn(async (input: string | URL | Request) => {
    const answer = routes[String(input)];
    if (answer === undefined || typeof answer === 'number') return new Response('nope', { status: answer ?? 404 });
    return new Response(answer);
  }) as unknown as typeof fetch;
}

/** npm metadata for `emoji` with one version, its tarball and its checksum. */
function npmRoutes(archive: Buffer, version = '1.0.0') {
  const tarballUrl = `https://registry.npmjs.org/emoji/-/emoji-${version}.tgz`;
  const integrity = `sha512-${createHash('sha512').update(archive).digest('base64')}`;
  return {
    'https://registry.npmjs.org/emoji': JSON.stringify({
      'dist-tags': { latest: version },
      versions: { [version]: { version, dist: { tarball: tarballUrl, integrity } } },
    }),
    [tarballUrl]: archive,
  };
}

function setUp(routes: Record<string, Buffer | string | number>, options: { nameTaken?: () => boolean } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'installer-'));
  const extensionsDir = join(root, 'extensions');
  const installer = new ExtensionInstaller({
    extensionsDir,
    stagingDir: join(root, 'extension-installs'),
    fetch: server(routes),
    ...options,
  });
  return { root, extensionsDir, installer };
}

const files = { 'package.json': pkg('emoji'), 'index.js': 'export default { commands: {} };' };

describe('ExtensionInstaller', () => {
  it('installs an npm package once it’s confirmed, and lists it', async () => {
    const { installer, extensionsDir, root } = setUp(npmRoutes(npmPackage(files)));
    const prepared = await installer.prepare({ kind: 'npm', name: 'emoji' });
    expect(prepared).toMatchObject({
      manifest: { name: 'emoji', title: 'Emoji' },
      version: '1.0.0',
      from: 'https://registry.npmjs.org/emoji/-/emoji-1.0.0.tgz',
    });
    expect(prepared.replaces).toBeUndefined();
    // Nothing is in the extensions folder until it's confirmed.
    expect(existsSync(join(extensionsDir, 'emoji'))).toBe(false);

    const installed = installer.install(prepared.id);
    expect(installed).toMatchObject({ name: 'emoji', title: 'Emoji', version: '1.0.0', source: { kind: 'npm' } });
    expect(readFileSync(join(extensionsDir, 'emoji', 'index.js'), 'utf8')).toContain('export default');
    expect(JSON.parse(readFileSync(join(extensionsDir, 'emoji', INSTALL_RECORD), 'utf8'))).toMatchObject({
      source: 'emoji',
      version: '1.0.0',
    });
    expect(installer.list().map((e) => e.name)).toEqual(['emoji']);
    // The prepared folder is gone once it's moved in.
    expect(readdirSync(join(root, 'extension-installs'))).toEqual([]);
    expect(() => installer.install(prepared.id)).toThrow(/expired/);
  });

  it('keeps scripts runnable', async () => {
    const archive = tarball([
      { name: 'package/package.json', data: pkg('emoji') },
      { name: 'package/index.js', data: '' },
      { name: 'package/run.sh', data: '#!/bin/sh', mode: 0o755 },
    ]);
    const { installer, extensionsDir } = setUp(npmRoutes(archive));
    installer.install((await installer.prepare({ kind: 'npm', name: 'emoji' })).id);
    if (process.platform !== 'win32') {
      expect(statSync(join(extensionsDir, 'emoji', 'run.sh')).mode & 0o111).not.toBe(0);
    }
  });

  it('refuses a tarball that isn’t the one npm published', async () => {
    const routes = npmRoutes(npmPackage(files));
    routes['https://registry.npmjs.org/emoji/-/emoji-1.0.0.tgz'] = npmPackage({ ...files, 'index.js': 'evil' });
    const { installer, root } = setUp(routes);
    await expect(installer.prepare({ kind: 'npm', name: 'emoji' })).rejects.toThrow(/checksum doesn't match/);
    expect(readdirSync(join(root, 'extension-installs'))).toEqual([]);
  });

  it('says what’s wrong with a package that isn’t an extension', async () => {
    const cases: Array<[Record<string, string>, RegExp]> = [
      [
        { 'package.json': JSON.stringify({ name: 'emoji' }), 'index.js': '' },
        /isn't a Waypoint extension: .*"waypoint"/,
      ],
      [{ 'package.json': pkg('emoji', { main: 'dist/index.js' }) }, /has no dist\/index\.js.*building/],
      [
        {
          'package.json': pkg('emoji', { dependencies: { 'left-pad': '1', '@waypoint-org/api': '0' } }),
          'index.js': '',
        },
        /needs left-pad/,
      ],
      [{ 'index.js': '' }, /no package\.json/],
    ];
    for (const [contents, error] of cases) {
      const { installer } = setUp(npmRoutes(npmPackage(contents)));
      await expect(installer.prepare({ kind: 'npm', name: 'emoji' })).rejects.toThrow(error);
    }
    const { installer } = setUp({});
    await expect(installer.prepare({ kind: 'npm', name: 'emoji' })).rejects.toThrow(/no npm package called “emoji”/);
  });

  it('installs a dependency that comes in the package’s own node_modules', async () => {
    const archive = npmPackage({
      'package.json': pkg('emoji', { dependencies: { 'left-pad': '1' } }),
      'index.js': '',
      'node_modules/left-pad/package.json': '{}',
    });
    const { installer } = setUp(npmRoutes(archive));
    await expect(installer.prepare({ kind: 'npm', name: 'emoji' })).resolves.toMatchObject({ version: '1.0.0' });
  });

  it('won’t take the place of a folder put there by hand, or a name that’s taken', async () => {
    const routes = npmRoutes(npmPackage(files));
    const { installer, extensionsDir } = setUp(routes);
    mkdirSync(join(extensionsDir, 'emoji'), { recursive: true });
    writeFileSync(join(extensionsDir, 'emoji', 'package.json'), pkg('emoji'));
    await expect(installer.prepare({ kind: 'npm', name: 'emoji' })).rejects.toThrow(
      /already has a folder called “emoji”/,
    );
    expect(() => installer.uninstall('emoji')).toThrow(/left as it is/);
    expect(existsSync(join(extensionsDir, 'emoji'))).toBe(true);

    const taken = setUp(routes, { nameTaken: () => true });
    await expect(taken.installer.prepare({ kind: 'npm', name: 'emoji' })).rejects.toThrow(/already called “emoji”/);
  });

  it('updates an installed extension in place, and uninstalls it', async () => {
    const first = setUp(npmRoutes(npmPackage(files)));
    first.installer.install((await first.installer.prepare({ kind: 'npm', name: 'emoji', version: '1.0.0' })).id);

    const newer = npmPackage({ ...files, 'package.json': pkg('emoji', { version: '1.1.0' }), 'new.js': '' });
    const installer = new ExtensionInstaller({
      extensionsDir: first.extensionsDir,
      stagingDir: join(first.root, 'extension-installs'),
      fetch: server(npmRoutes(newer, '1.1.0')),
    });
    const update = await installer.prepare({ kind: 'npm', name: 'emoji' }, { updating: 'emoji' });
    expect(update.version).toBe('1.1.0');
    expect(update.replaces).toMatchObject({ name: 'emoji', version: '1.0.0' });
    installer.install(update.id);
    expect(installer.find('emoji')).toMatchObject({ version: '1.1.0', source: { kind: 'npm', name: 'emoji' } });
    expect(existsSync(join(first.extensionsDir, 'emoji', 'new.js'))).toBe(true);

    expect(installer.uninstall('emoji').name).toBe('emoji');
    expect(existsSync(join(first.extensionsDir, 'emoji'))).toBe(false);
    expect(installer.list()).toEqual([]);
  });

  it('refuses an update that changed its name', async () => {
    const { installer } = setUp(npmRoutes(npmPackage(files)));
    await expect(installer.prepare({ kind: 'npm', name: 'emoji' }, { updating: 'emoji-old' })).rejects.toThrow(
      /called “emoji” instead of “emoji-old”/,
    );
  });

  it('installs a folder of a GitHub repository at the commit its branch is on', async () => {
    const commit = 'a'.repeat(40);
    const archive = npmPackage(
      { 'README.md': '', 'extensions/emoji/package.json': pkg('emoji'), 'extensions/emoji/index.js': '' },
      `alex-tools-${commit.slice(0, 7)}`,
    );
    const { installer, extensionsDir } = setUp({
      'https://api.github.com/repos/alex/tools/commits/main': commit,
      [`https://codeload.github.com/alex/tools/tar.gz/${commit}`]: archive,
    });
    const source = { kind: 'github', owner: 'alex', repo: 'tools', ref: 'main', path: 'extensions/emoji' } as const;
    const prepared = await installer.prepare(source);
    expect(prepared).toMatchObject({ commit, from: `https://github.com/alex/tools/tree/${commit}/extensions/emoji` });
    installer.install(prepared.id);
    expect(readdirSync(join(extensionsDir, 'emoji')).sort()).toEqual([INSTALL_RECORD, 'index.js', 'package.json']);
    expect(installer.find('emoji')?.source).toEqual(source);

    await expect(installer.prepare({ ...source, path: 'nope' })).rejects.toThrow(/no folder “nope”/);
  });

  it('says when a GitHub repository or branch isn’t there, or GitHub is busy', async () => {
    const { installer } = setUp({ 'https://api.github.com/repos/alex/busy/commits/HEAD': 403 });
    await expect(installer.prepare({ kind: 'github', owner: 'alex', repo: 'nope' })).rejects.toThrow(
      /no public repository github\.com\/alex\/nope/,
    );
    await expect(installer.prepare({ kind: 'github', owner: 'alex', repo: 'nope', ref: 'dev' })).rejects.toThrow(
      /no branch, tag or commit “dev”/,
    );
    await expect(installer.prepare({ kind: 'github', owner: 'alex', repo: 'busy' })).rejects.toThrow(/Try again/);
  });

  it('clones other git repositories with git, and says when git isn’t there', async () => {
    const root = mkdtempSync(join(tmpdir(), 'installer-'));
    const git = vi.fn(async (args: string[]) => {
      if (args[0] === 'clone') {
        const dir = args.at(-1) ?? '';
        mkdirSync(join(dir, '.git'), { recursive: true });
        writeFileSync(join(dir, 'package.json'), pkg('emoji'));
        writeFileSync(join(dir, 'index.js'), '');
        return '';
      }
      return `${'b'.repeat(40)}\n`;
    });
    const installer = new ExtensionInstaller({
      extensionsDir: join(root, 'extensions'),
      stagingDir: join(root, 'staging'),
      git,
    });
    const prepared = await installer.prepare({ kind: 'git', url: 'https://gitlab.com/alex/emoji.git', ref: 'v1' });
    expect(git.mock.calls[0]?.[0]).toEqual([
      'clone',
      '--depth',
      '1',
      '--branch',
      'v1',
      '--',
      'https://gitlab.com/alex/emoji.git',
      expect.any(String),
    ]);
    expect(prepared.commit).toBe('b'.repeat(40));
    installer.install(prepared.id);
    expect(existsSync(join(root, 'extensions', 'emoji', '.git'))).toBe(false);

    const missing = new ExtensionInstaller({
      extensionsDir: join(root, 'extensions'),
      stagingDir: join(root, 'staging'),
      git: async () => {
        throw Object.assign(new Error('spawn git ENOENT'), { code: 'ENOENT' });
      },
    });
    await expect(missing.prepare({ kind: 'git', url: 'https://gitlab.com/alex/x.git' })).rejects.toThrow(/needs git/);
  });

  it('keeps only the latest install waiting, and clears what’s left over', async () => {
    const { installer, root } = setUp(npmRoutes(npmPackage(files)));
    const first = await installer.prepare({ kind: 'npm', name: 'emoji' });
    const second = await installer.prepare({ kind: 'npm', name: 'emoji' });
    expect(readdirSync(join(root, 'extension-installs'))).toHaveLength(1);
    expect(() => installer.install(first.id)).toThrow(/expired/);
    installer.cleanUp();
    expect(existsSync(join(root, 'extension-installs'))).toBe(false);
    expect(() => installer.install(second.id)).toThrow(/expired/);
  });
});

describe('missingDependencies', () => {
  it('lists what isn’t there, except the API Waypoint gives every extension', () => {
    const has = (name: string) => name === 'bundled';
    expect(missingDependencies({ dependencies: { bundled: '1', other: '2', '@waypoint-org/api': '0' } }, has)).toEqual([
      'other',
    ]);
    expect(missingDependencies({ devDependencies: { typescript: '5' } }, has)).toEqual([]);
    expect(missingDependencies(null, has)).toEqual([]);
  });
});
