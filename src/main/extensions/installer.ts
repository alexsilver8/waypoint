/**
 * Installs other people's extensions into the extensions folder: from npm, from GitHub, or from
 * any git repository. Nothing they contain runs while installing (there are no npm scripts), and
 * the package is checked like any extension before it's offered: an install is prepared in a
 * folder of its own, shown to be confirmed, and only then moved into place.
 */
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative } from 'node:path';
import type { ExtensionManifest } from '../../shared/types';
import { reasonOf } from '../exec';
import { readJsonFile, writeJsonFile } from '../json-file';
import { describeSource, formatInstallSpec, InstallError, type InstallSource, parseInstallSpec } from './install-spec';
import { matchesRelease, NPM_REGISTRY, packageUrl, pickRelease } from './npm-registry';
import { readTarball, type TarFile } from './tar';
import { parseExtensionPackage, ValidationError } from './validate';

/** Kept in an installed extension's folder: where it came from, to update it from there. */
export const INSTALL_RECORD = '.waypoint-install.json';
/** The most a package may download. */
const MAX_DOWNLOAD = 50 * 1024 * 1024;
const TIMEOUT_MS = 60_000;
const NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
/** Waypoint gives every extension this one, so it needn't come with it. */
const PROVIDED = new Set(['@waypoint-org/api']);

/** An extension installed from npm or git. */
export interface InstalledExtension {
  /** Its name, which is also its folder's. */
  name: string;
  title: string;
  dir: string;
  source: InstallSource;
  /** `version` from its package.json. */
  version?: string;
  /** The commit, for one from git. */
  commit?: string;
  /** When it was installed or last updated, as ISO 8601. */
  installedAt: string;
}

/** An install that's been downloaded and checked, waiting to be confirmed. */
export interface PreparedInstall {
  id: string;
  manifest: ExtensionManifest;
  source: InstallSource;
  version?: string;
  commit?: string;
  /** Where the files are downloaded from, for people to see. */
  from: string;
  /** The installed copy it would replace, when there's one. */
  replaces?: InstalledExtension;
  /** Its own package.json says not to use it any more. */
  deprecated?: string;
}

/** Runs git with these arguments and resolves to what it printed. */
export type Git = (args: string[]) => Promise<string>;

export interface InstallerOptions {
  extensionsDir: string;
  /** Where installs are prepared; on the same disk as the extensions folder, so moving them in is instant. */
  stagingDir: string;
  fetch?: typeof fetch;
  registry?: string;
  git?: Git;
  /**
   * Whether an extension other than the one in `dir` (built in, shipped with Waypoint, from
   * another folder) already has this name.
   */
  nameTaken?(name: string, dir: string): boolean;
}

const runGit: Git = (args) =>
  new Promise((resolve, reject) => {
    execFile(
      'git',
      args,
      // Never wait for a password nobody can type.
      { timeout: 120_000, windowsHide: true, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } },
      (error, stdout, stderr) => {
        if (error) {
          if (stderr?.trim()) error.message = `${error.message}\n${stderr.trim()}`;
          reject(error);
        } else resolve(stdout);
      },
    );
  });

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Its `dependencies` that it doesn't bring in its own node_modules, which Waypoint won't install. */
export function missingDependencies(pkg: unknown, has: (name: string) => boolean): string[] {
  const dependencies = isRecord(pkg) && isRecord(pkg.dependencies) ? Object.keys(pkg.dependencies) : [];
  return dependencies.filter((name) => !PROVIDED.has(name) && !has(name));
}

/** Writes an archive's files into `root`, refusing any that would end up outside it. */
function writeFiles(root: string, files: TarFile[]): void {
  for (const file of files) {
    const target = join(root, ...file.path.split('/'));
    const fromRoot = relative(root, target);
    if (!fromRoot || fromRoot.startsWith('..') || isAbsolute(fromRoot)) {
      throw new InstallError(`The archive has a file outside its folder: ${file.path}`);
    }
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, file.data, { mode: file.executable ? 0o755 : 0o644 });
  }
}

/** The files under `folder` of a repository, with paths from there. */
function inFolder(files: TarFile[], folder: string | undefined): TarFile[] {
  if (!folder) return files;
  const prefix = `${folder}/`;
  return files
    .filter((file) => file.path.startsWith(prefix))
    .map((file) => ({ ...file, path: file.path.slice(prefix.length) }));
}

function readRecord(dir: string): Omit<InstalledExtension, 'name' | 'title' | 'dir'> | undefined {
  try {
    const record = readJsonFile(join(dir, INSTALL_RECORD));
    if (!isRecord(record) || typeof record.source !== 'string') return undefined;
    return {
      source: parseInstallSpec(record.source),
      installedAt: typeof record.installedAt === 'string' ? record.installedAt : '',
      ...(typeof record.version === 'string' ? { version: record.version } : {}),
      ...(typeof record.commit === 'string' ? { commit: record.commit } : {}),
    };
  } catch {
    return undefined;
  }
}

export class ExtensionInstaller {
  private pending?: { install: PreparedInstall; dir: string; staging: string };

  constructor(private readonly options: InstallerOptions) {}

  /** The extensions installed from npm or git, A to Z. Ones put in the folder by hand aren't listed. */
  list(): InstalledExtension[] {
    const { extensionsDir } = this.options;
    let names: string[];
    try {
      names = readdirSync(extensionsDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && NAME_PATTERN.test(entry.name))
        .map((entry) => entry.name);
    } catch {
      return [];
    }
    return names.sort().flatMap((name) => {
      const found = this.find(name);
      return found ? [found] : [];
    });
  }

  /** The installed extension called `name`, if it was installed from npm or git. */
  find(name: string): InstalledExtension | undefined {
    if (!NAME_PATTERN.test(name)) return undefined;
    const dir = join(this.options.extensionsDir, name);
    const record = readRecord(dir);
    if (!record) return undefined;
    let title = name;
    try {
      const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as Record<string, unknown>;
      const config = pkg.waypoint as Record<string, unknown> | undefined;
      if (typeof config?.title === 'string') title = config.title;
    } catch {
      // Still listed, so it can be uninstalled.
    }
    return { name, title, dir, ...record };
  }

  /**
   * Downloads what `source` names and checks it's an extension that can be installed, without
   * installing it: `install` does that with the id it returns. Only the latest is kept. To update
   * an extension, `updating` is its name, which the new version must still have.
   */
  async prepare(source: InstallSource, { updating }: { updating?: string } = {}): Promise<PreparedInstall> {
    this.discard();
    mkdirSync(this.options.stagingDir, { recursive: true });
    const staging = mkdtempSync(join(this.options.stagingDir, 'install-'));
    const dir = join(staging, 'extension');
    try {
      const fetched = await this.download(source, dir);
      const install = this.check(source, dir, fetched);
      if (updating && install.manifest.name !== updating) {
        throw new InstallError(`The new version is called “${install.manifest.name}” instead of “${updating}”.`);
      }
      this.pending = { install, dir, staging };
      return install;
    } catch (error) {
      rmSync(staging, { recursive: true, force: true });
      throw error;
    }
  }

  /** Moves a prepared install into the extensions folder, in place of the copy it replaces. */
  install(id: string): InstalledExtension {
    const pending = this.pending;
    if (!pending || pending.install.id !== id) throw new InstallError('That install has expired. Start it again.');
    this.pending = undefined;
    const { install, dir, staging } = pending;
    const target = join(this.options.extensionsDir, install.manifest.name);
    try {
      const installedAt = new Date().toISOString();
      writeJsonFile(join(dir, INSTALL_RECORD), {
        source: formatInstallSpec(install.source),
        installedAt,
        ...(install.version ? { version: install.version } : {}),
        ...(install.commit ? { commit: install.commit } : {}),
      });
      mkdirSync(this.options.extensionsDir, { recursive: true });
      if (existsSync(target)) {
        if (!readRecord(target)) throw this.folderTaken(install.manifest.name);
        renameSync(target, join(staging, 'previous'));
      }
      renameSync(dir, target);
      return (
        this.find(install.manifest.name) ?? {
          name: install.manifest.name,
          title: install.manifest.title,
          dir: target,
          source: install.source,
          installedAt,
        }
      );
    } finally {
      rmSync(staging, { recursive: true, force: true });
    }
  }

  /** Forgets the install waiting to be confirmed, if any. */
  discard(): void {
    if (this.pending) rmSync(this.pending.staging, { recursive: true, force: true });
    this.pending = undefined;
  }

  /** Removes an extension installed from npm or git. One put in the folder by hand is left alone. */
  uninstall(name: string): InstalledExtension {
    const installed = this.find(name);
    if (!installed) throw new InstallError(`“${name}” wasn't installed from npm or git, so it's left as it is.`);
    rmSync(installed.dir, { recursive: true, force: true });
    return installed;
  }

  /** Clears installs left half-done, say by quitting while one waited to be confirmed. */
  cleanUp(): void {
    this.pending = undefined;
    rmSync(this.options.stagingDir, { recursive: true, force: true });
  }

  private folderTaken(name: string): InstallError {
    return new InstallError(
      `Your extensions folder already has a folder called “${name}”. Move it out of the way to install this one.`,
    );
  }

  /** Puts the package's files in `dir`. */
  private async download(
    source: InstallSource,
    dir: string,
  ): Promise<{ from: string; commit?: string; version?: string; deprecated?: string }> {
    switch (source.kind) {
      case 'npm': {
        const registry = this.options.registry ?? NPM_REGISTRY;
        const metadata = await this.get(packageUrl(registry, source.name), {
          accept: 'application/vnd.npm.install-v1+json; q=1.0, application/json; q=0.8',
          missing: `There's no npm package called “${source.name}”.`,
        });
        const release = pickRelease(JSON.parse(metadata.toString('utf8')), source.name, registry, source.version);
        const tarball = await this.get(release.tarball, {
          missing: `${source.name}@${release.version} couldn't be downloaded.`,
        });
        if (!matchesRelease(tarball, release)) {
          throw new InstallError(
            `${source.name}@${release.version} isn't what npm published: its checksum doesn't match.`,
          );
        }
        writeFiles(dir, readTarball(tarball));
        return {
          from: release.tarball,
          version: release.version,
          ...(release.deprecated ? { deprecated: release.deprecated } : {}),
        };
      }
      case 'github': {
        const repository = `github.com/${source.owner}/${source.repo}`;
        const api = `https://api.github.com/repos/${source.owner}/${source.repo}`;
        const commit = (
          await this.get(`${api}/commits/${encodeURIComponent(source.ref ?? 'HEAD')}`, {
            accept: 'application/vnd.github.sha',
            missing: source.ref
              ? `${repository} has no branch, tag or commit “${source.ref}”, or isn't public.`
              : `There's no public repository ${repository}.`,
          })
        )
          .toString('utf8')
          .trim();
        if (!/^[0-9a-f]{40}$/.test(commit))
          throw new InstallError(`GitHub sent something unexpected for ${repository}.`);
        const from = `https://codeload.github.com/${source.owner}/${source.repo}/tar.gz/${commit}`;
        const files = inFolder(
          readTarball(await this.get(from, { missing: `${repository} couldn't be downloaded.` })),
          source.path,
        );
        if (files.length === 0) throw new InstallError(`${repository} has no folder “${source.path}”.`);
        writeFiles(dir, files);
        return { from: `https://${repository}/tree/${commit}${source.path ? `/${source.path}` : ''}`, commit };
      }
      case 'git': {
        const git = this.options.git ?? runGit;
        try {
          await git(['clone', '--depth', '1', ...(source.ref ? ['--branch', source.ref] : []), '--', source.url, dir]);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            throw new InstallError(
              'Installing from a git address other than GitHub needs git. Install git, or use an npm package or a GitHub address.',
            );
          }
          throw new InstallError(`${source.url} couldn't be cloned: ${reasonOf(error)}`);
        }
        const commit = (await git(['-C', dir, 'rev-parse', 'HEAD'])).trim();
        rmSync(join(dir, '.git'), { recursive: true, force: true });
        return { from: source.url, ...(commit ? { commit } : {}) };
      }
    }
  }

  /** Checks a downloaded package is an extension that can be installed here. */
  private check(
    source: InstallSource,
    dir: string,
    fetched: { from: string; commit?: string; version?: string; deprecated?: string },
  ): PreparedInstall {
    const where = describeSource(source);
    let pkg: unknown;
    try {
      pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    } catch (error) {
      const missing = (error as NodeJS.ErrnoException).code === 'ENOENT';
      throw new InstallError(
        missing
          ? `${where} has no package.json at its top. For a repository with the extension in a folder, link to that folder.`
          : `${where} has a package.json that isn't valid JSON.`,
      );
    }
    let parsed: ReturnType<typeof parseExtensionPackage>;
    try {
      parsed = parseExtensionPackage(pkg, dir);
    } catch (error) {
      if (error instanceof ValidationError)
        throw new InstallError(`${where} isn't a Waypoint extension: ${error.message}`);
      throw error;
    }
    const { manifest, entry } = parsed;
    if (!existsSync(entry)) {
      throw new InstallError(
        `${where} has no ${relative(dir, entry).replaceAll('\\', '/')}, the module its package.json names. It may need building first.`,
      );
    }
    const missing = missingDependencies(pkg, (name) => existsSync(join(dir, 'node_modules', name, 'package.json')));
    if (missing.length > 0) {
      throw new InstallError(
        `${manifest.title} needs ${missing.join(', ')}, which Waypoint doesn't install. Its author can bundle them into it.`,
      );
    }
    const target = join(this.options.extensionsDir, manifest.name);
    if (this.options.nameTaken?.(manifest.name, target)) {
      throw new InstallError(`Another extension is already called “${manifest.name}”.`);
    }
    const replaces = existsSync(target) ? this.find(manifest.name) : undefined;
    if (existsSync(target) && !replaces) throw this.folderTaken(manifest.name);

    const version = fetched.version ?? (isRecord(pkg) && typeof pkg.version === 'string' ? pkg.version : undefined);
    return {
      id: randomUUID(),
      manifest,
      source,
      from: fetched.from,
      ...(version ? { version } : {}),
      ...(fetched.commit ? { commit: fetched.commit } : {}),
      ...(replaces ? { replaces } : {}),
      ...(fetched.deprecated ? { deprecated: fetched.deprecated } : {}),
    };
  }

  /** Downloads a file, failing with `missing` when it isn't there. */
  private async get(url: string, { accept, missing }: { accept?: string; missing: string }): Promise<Buffer> {
    const request = this.options.fetch ?? fetch;
    let response: Response;
    try {
      response = await request(url, {
        headers: { 'user-agent': 'Waypoint', ...(accept ? { accept } : {}) },
        redirect: 'follow',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      throw new InstallError(`Couldn't reach ${new URL(url).host}: ${reasonOf(error)}`);
    }
    if (response.status === 404 || response.status === 422) throw new InstallError(missing);
    if (response.status === 403 || response.status === 429) {
      throw new InstallError(`${new URL(url).host} is turning requests away for now. Try again in a while.`);
    }
    if (!response.ok) throw new InstallError(`${new URL(url).host} answered ${response.status}. Try again in a while.`);
    const tooBig = new InstallError(`The download from ${new URL(url).host} is over ${MAX_DOWNLOAD / 1024 / 1024} MB.`);
    if (Number(response.headers.get('content-length') ?? 0) > MAX_DOWNLOAD) throw tooBig;
    const data = Buffer.from(await response.arrayBuffer());
    if (data.length > MAX_DOWNLOAD) throw tooBig;
    return data;
  }
}
