/**
 * What people type to install an extension: an npm package (`name`, `name@1.2.0`,
 * `@you/name@latest`), a GitHub repository (`github:owner/repo#ref`, `owner/repo`, or its address,
 * even a folder in it), or any other git repository by its https or ssh address.
 */

export type InstallSource =
  | { kind: 'npm'; name: string; version?: string }
  | { kind: 'github'; owner: string; repo: string; ref?: string; path?: string }
  | { kind: 'git'; url: string; ref?: string };

export class InstallError extends Error {}

// npm's rules for new package names: lowercase, URL-safe, at most 214 characters.
const NPM_NAME = /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;
/** An exact version or a tag, like `1.2.0` or `next`. */
const NPM_VERSION = /^[0-9A-Za-z][0-9A-Za-z.+_-]*$/;
const GITHUB_NAME = /^[A-Za-z0-9_.-]+$/;
/** A branch, tag or commit. Never starts with `-`, so git can't take it for an option. */
const GIT_REF = /^[A-Za-z0-9_.][A-Za-z0-9_./-]*$/;
const GITHUB_HOSTS = new Set(['github.com', 'www.github.com']);

/** Reads what was typed, or says what's wrong with it. */
export function parseInstallSpec(input: string): InstallSource {
  const spec = input.trim();
  if (!spec) throw new InstallError('Type an npm package name or a git address.');
  if (/\s/.test(spec)) throw new InstallError('A package name or address has no spaces.');
  if (spec.startsWith('npm:')) return npmSource(spec.slice('npm:'.length));
  if (spec.startsWith('github:')) return githubShorthand(spec.slice('github:'.length));
  if (/^(?:\.{1,2}[\\/]|[\\/~]|[A-Za-z]:[\\/]|file:)/.test(spec)) {
    throw new InstallError(
      'To use an extension from a folder on this computer, put it in the extensions folder, or add its folder in Settings.',
    );
  }
  if (/^http:\/\//i.test(spec)) throw new InstallError('Use an https:// address.');
  const scp = /^git@([^:/]+):(.+)$/.exec(spec);
  if (scp) return sshSource(spec, scp[1] ?? '', scp[2] ?? '');
  if (/^(?:git\+)?(?:https|ssh):\/\//i.test(spec)) return urlSource(spec.replace(/^git\+/i, ''));
  if (/^git:\/\//i.test(spec)) throw new InstallError('Use an https:// or ssh:// address.');
  if (/^[a-z][a-z0-9+.-]*:/i.test(spec)) throw new InstallError(`Waypoint can't install from “${spec}”.`);
  // `owner/repo` is a GitHub repository, as it is for npm; an npm name with a slash has a scope.
  if (!spec.startsWith('@') && spec.includes('/')) return githubShorthand(spec);
  return npmSource(spec);
}

function npmSource(spec: string): InstallSource {
  // The version comes after the last @ that isn't the scope's.
  const at = spec.indexOf('@', 1);
  const name = at === -1 ? spec : spec.slice(0, at);
  const version = at === -1 ? undefined : spec.slice(at + 1);
  if (name.length > 214 || !NPM_NAME.test(name)) throw new InstallError(`“${name}” isn't an npm package name.`);
  if (version === undefined) return { kind: 'npm', name };
  if (!NPM_VERSION.test(version)) {
    throw new InstallError(`“${version}” isn't a version. Give one like 1.2.0, or a tag like latest.`);
  }
  return { kind: 'npm', name, version };
}

function decode(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    throw new InstallError(`“${text}” isn't written right.`);
  }
}

/** Splits `#ref` off the end. */
function withRef(spec: string): { rest: string; ref?: string } {
  const hash = spec.indexOf('#');
  if (hash === -1) return { rest: spec };
  const ref = decode(spec.slice(hash + 1));
  if (!ref) return { rest: spec.slice(0, hash) };
  if (!GIT_REF.test(ref) || ref.split('/').includes('..')) throw new InstallError(`“${ref}” isn't a branch or tag.`);
  return { rest: spec.slice(0, hash), ref };
}

function githubSource(owner: string, repo: string, ref?: string, path?: string): InstallSource {
  const name = repo.replace(/\.git$/, '');
  if (!GITHUB_NAME.test(owner) || !GITHUB_NAME.test(name) || owner.startsWith('.') || name.startsWith('.')) {
    throw new InstallError(`“${owner}/${repo}” isn't a GitHub repository.`);
  }
  return { kind: 'github', owner, repo: name, ...(ref ? { ref } : {}), ...(path ? { path } : {}) };
}

function githubShorthand(spec: string): InstallSource {
  const { rest, ref } = withRef(spec);
  const parts = rest.split('/');
  if (parts.length !== 2) throw new InstallError(`Write a GitHub repository as owner/repo, not “${rest}”.`);
  return githubSource(parts[0] ?? '', parts[1] ?? '', ref);
}

/** A folder inside a repository: plain names only, never up out of it. */
function folderPath(segments: string[]): string | undefined {
  const parts = segments.map(decode).filter(Boolean);
  if (parts.some((part) => part === '.' || part === '..' || /[\\/:]/.test(part))) {
    throw new InstallError('That folder is outside the repository.');
  }
  return parts.length > 0 ? parts.join('/') : undefined;
}

function urlSource(spec: string): InstallSource {
  const { rest, ref } = withRef(spec);
  // URL would quietly take these out, leaving a different address than the one shown.
  if (/\/(?:\.|%2e){1,2}(?:[/?]|$)/i.test(rest)) throw new InstallError('Write the address without ./ or ../ in it.');
  let url: URL;
  try {
    url = new URL(rest);
  } catch {
    throw new InstallError(`“${spec}” isn't an address.`);
  }
  if (url.protocol === 'https:' && (url.username || url.password)) {
    throw new InstallError('Leave the sign-in out of the address.');
  }
  const segments = url.pathname.split('/').filter(Boolean);
  if (url.protocol === 'https:' && GITHUB_HOSTS.has(url.hostname.toLowerCase())) {
    const [owner = '', repo = '', kind, branch, ...folder] = segments;
    if (!owner || !repo) throw new InstallError('Link to a repository, like https://github.com/owner/repo.');
    if (kind === undefined) return githubSource(owner, repo, ref);
    // A folder in it, as GitHub links to one: /owner/repo/tree/<branch>/<folder>.
    if (kind === 'tree' && branch) {
      const treeRef = decode(branch);
      if (!GIT_REF.test(treeRef)) throw new InstallError(`“${treeRef}” isn't a branch or tag.`);
      // HEAD is whatever the default branch is.
      return githubSource(owner, repo, ref ?? (treeRef === 'HEAD' ? undefined : treeRef), folderPath(folder));
    }
    throw new InstallError('Link to the repository, or to a folder in it.');
  }
  if (segments.length === 0) throw new InstallError(`“${spec}” doesn't name a repository.`);
  url.hash = '';
  return { kind: 'git', url: url.toString(), ...(ref ? { ref } : {}) };
}

function sshSource(spec: string, host: string, path: string): InstallSource {
  const { rest, ref } = withRef(path);
  if (GITHUB_HOSTS.has(host.toLowerCase())) {
    const parts = rest.split('/');
    if (parts.length === 2) return githubSource(parts[0] ?? '', parts[1] ?? '', ref);
  }
  if (!rest || rest.startsWith('-')) throw new InstallError(`“${spec}” doesn't name a repository.`);
  return { kind: 'git', url: `git@${host}:${rest}`, ...(ref ? { ref } : {}) };
}

/** The source written so `parseInstallSpec` reads it back the same, e.g. `github:owner/repo#main`. */
export function formatInstallSpec(source: InstallSource): string {
  switch (source.kind) {
    case 'npm':
      return source.version ? `${source.name}@${source.version}` : source.name;
    case 'github': {
      const ref = source.ref ?? 'HEAD';
      if (source.path) return `https://github.com/${source.owner}/${source.repo}/tree/${ref}/${source.path}`;
      return `github:${source.owner}/${source.repo}${source.ref ? `#${source.ref}` : ''}`;
    }
    case 'git':
      return `${source.url}${source.ref ? `#${source.ref}` : ''}`;
  }
}

/** Where it comes from, for people: "npm", "github.com/owner/repo", or the address. */
export function describeSource(source: InstallSource): string {
  switch (source.kind) {
    case 'npm':
      return `npm (${source.name})`;
    case 'github': {
      const where = `github.com/${source.owner}/${source.repo}${source.path ? `/${source.path}` : ''}`;
      return source.ref ? `${where} (${source.ref})` : where;
    }
    case 'git':
      return source.ref ? `${source.url} (${source.ref})` : source.url;
  }
}

/** Where to look for a newer version: an exact npm version is left out; a tag or branch is kept. */
export function updateSource(source: InstallSource): InstallSource {
  if (source.kind !== 'npm' || !source.version || !/^\d/.test(source.version)) return source;
  return { kind: 'npm', name: source.name };
}
