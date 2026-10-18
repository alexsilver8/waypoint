/**
 * Reading what the npm registry says about a package: which version to install, where its
 * tarball is, and checking the tarball is the one the registry published.
 */
import { createHash } from 'node:crypto';
import { InstallError } from './install-spec';

export const NPM_REGISTRY = 'https://registry.npmjs.org';

export interface NpmRelease {
  version: string;
  tarball: string;
  /** `sha512-<base64>`, from `dist.integrity`. */
  integrity?: string;
  /** The older SHA-1 in hex, from `dist.shasum`, for packages published before integrity. */
  shasum?: string;
  deprecated?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The registry address of a package's metadata; slashes are escaped, as npm does for a scope's. */
export function packageUrl(registry: string, name: string): string {
  return `${registry.replace(/\/+$/, '')}/${name.replace(/\//g, '%2f')}`;
}

/**
 * The release to install: the exact `wanted` version, the version its tag points to, or the
 * `latest` tag's. A tarball must come over https, or from the registry itself.
 */
export function pickRelease(metadata: unknown, name: string, registry: string, wanted?: string): NpmRelease {
  if (!isRecord(metadata) || !isRecord(metadata.versions)) {
    throw new InstallError(`The npm registry sent something unexpected for ${name}.`);
  }
  const tags = isRecord(metadata['dist-tags']) ? metadata['dist-tags'] : {};
  const tag = tags[wanted ?? 'latest'];
  const version = wanted && wanted in metadata.versions ? wanted : typeof tag === 'string' ? tag : undefined;
  const release = version ? metadata.versions[version] : undefined;
  if (!version || !isRecord(release)) {
    throw new InstallError(
      wanted
        ? `${name} has no version or tag “${wanted}”. Give an exact version, like 1.2.0, or a tag, like latest.`
        : `${name} has no released version.`,
    );
  }
  const dist = isRecord(release.dist) ? release.dist : {};
  const tarball = typeof dist.tarball === 'string' ? dist.tarball : '';
  let url: URL;
  try {
    url = new URL(tarball);
  } catch {
    throw new InstallError(`${name}@${version} has no tarball to download.`);
  }
  if (url.protocol !== 'https:' && url.origin !== new URL(registry).origin) {
    throw new InstallError(`${name}@${version} would be downloaded over an insecure connection.`);
  }
  return {
    version,
    tarball,
    ...(typeof dist.integrity === 'string' ? { integrity: dist.integrity } : {}),
    ...(typeof dist.shasum === 'string' ? { shasum: dist.shasum } : {}),
    ...(typeof release.deprecated === 'string' ? { deprecated: release.deprecated } : {}),
  };
}

/**
 * Whether the downloaded tarball is the one published: the strongest `sha512`/`sha384`/`sha256`
 * of its integrity string, or else its SHA-1. Neither to check against counts as a mismatch.
 */
export function matchesRelease(data: Buffer, release: Pick<NpmRelease, 'integrity' | 'shasum'>): boolean {
  const hashes = (release.integrity ?? '')
    .split(/\s+/)
    .map((entry) => /^(sha512|sha384|sha256)-([A-Za-z0-9+/=]+)$/.exec(entry))
    .filter((match): match is RegExpExecArray => match !== null);
  const order = ['sha512', 'sha384', 'sha256'];
  hashes.sort((a, b) => order.indexOf(a[1] ?? '') - order.indexOf(b[1] ?? ''));
  const best = hashes[0];
  if (best?.[1] && best[2]) return createHash(best[1]).update(data).digest('base64') === best[2];
  if (release.shasum) return createHash('sha1').update(data).digest('hex') === release.shasum.toLowerCase();
  return false;
}
