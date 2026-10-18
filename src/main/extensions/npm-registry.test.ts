import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { matchesRelease, NPM_REGISTRY, packageUrl, pickRelease } from './npm-registry';

const tarball = (version: string) => `https://registry.npmjs.org/emoji/-/emoji-${version}.tgz`;
const metadata = {
  name: 'emoji',
  'dist-tags': { latest: '1.1.0', next: '2.0.0-beta.1' },
  versions: {
    '1.0.0': { version: '1.0.0', dist: { tarball: tarball('1.0.0'), shasum: 'abc' }, deprecated: 'Use 1.1.0' },
    '1.1.0': { version: '1.1.0', dist: { tarball: tarball('1.1.0'), integrity: 'sha512-xyz' } },
    '2.0.0-beta.1': { version: '2.0.0-beta.1', dist: { tarball: tarball('2.0.0-beta.1') } },
  },
};

describe('packageUrl', () => {
  it('escapes a scope’s slash', () => {
    expect(packageUrl(NPM_REGISTRY, 'emoji')).toBe('https://registry.npmjs.org/emoji');
    expect(packageUrl('https://npm.example.com/', '@you/emoji')).toBe('https://npm.example.com/@you%2femoji');
  });

  it('escapes every slash, so a name stays one path segment', () => {
    expect(packageUrl(NPM_REGISTRY, '@a/b/../c')).toBe('https://registry.npmjs.org/@a%2fb%2f..%2fc');
  });
});

describe('pickRelease', () => {
  it('picks the latest, an exact version, or a tag’s', () => {
    expect(pickRelease(metadata, 'emoji', NPM_REGISTRY)).toEqual({
      version: '1.1.0',
      tarball: tarball('1.1.0'),
      integrity: 'sha512-xyz',
    });
    expect(pickRelease(metadata, 'emoji', NPM_REGISTRY, '1.0.0')).toEqual({
      version: '1.0.0',
      tarball: tarball('1.0.0'),
      shasum: 'abc',
      deprecated: 'Use 1.1.0',
    });
    expect(pickRelease(metadata, 'emoji', NPM_REGISTRY, 'next').version).toBe('2.0.0-beta.1');
  });

  it('says when there’s no such version', () => {
    expect(() => pickRelease(metadata, 'emoji', NPM_REGISTRY, '3.0.0')).toThrow(/no version or tag “3\.0\.0”/);
    expect(() => pickRelease({ versions: {} }, 'emoji', NPM_REGISTRY)).toThrow(/no released version/);
    expect(() => pickRelease('<html>', 'emoji', NPM_REGISTRY)).toThrow(/unexpected/);
  });

  it('refuses a tarball that would come over plain http from somewhere else', () => {
    const insecure = {
      'dist-tags': { latest: '1.0.0' },
      versions: { '1.0.0': { dist: { tarball: 'http://evil.example/e.tgz' } } },
    };
    expect(() => pickRelease(insecure, 'emoji', NPM_REGISTRY)).toThrow(/insecure/);
    const local = {
      'dist-tags': { latest: '1.0.0' },
      versions: { '1.0.0': { dist: { tarball: 'http://127.0.0.1:4873/e.tgz' } } },
    };
    expect(pickRelease(local, 'emoji', 'http://127.0.0.1:4873').tarball).toBe('http://127.0.0.1:4873/e.tgz');
    const none = { 'dist-tags': { latest: '1.0.0' }, versions: { '1.0.0': {} } };
    expect(() => pickRelease(none, 'emoji', NPM_REGISTRY)).toThrow(/no tarball/);
  });
});

describe('matchesRelease', () => {
  const data = Buffer.from('the package');
  const sri = (algorithm: string, of = data) => `${algorithm}-${createHash(algorithm).update(of).digest('base64')}`;

  it('checks the strongest hash of the integrity string', () => {
    expect(matchesRelease(data, { integrity: sri('sha512') })).toBe(true);
    expect(matchesRelease(data, { integrity: `${sri('sha1')} ${sri('sha256')}` })).toBe(true);
    expect(matchesRelease(data, { integrity: `${sri('sha256')} ${sri('sha512', Buffer.from('other'))}` })).toBe(false);
    expect(matchesRelease(Buffer.from('tampered'), { integrity: sri('sha512') })).toBe(false);
  });

  it('falls back to the SHA-1, and fails with nothing to check against', () => {
    const shasum = createHash('sha1').update(data).digest('hex');
    expect(matchesRelease(data, { shasum: shasum.toUpperCase() })).toBe(true);
    expect(matchesRelease(data, { shasum: '0'.repeat(40) })).toBe(false);
    expect(matchesRelease(data, {})).toBe(false);
  });
});
