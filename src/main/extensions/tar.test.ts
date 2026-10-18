import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { entryPath, readTarball } from './tar';
import { paxRecord, tarball } from './test-tarball';

describe('entryPath', () => {
  it('drops the top folder npm and GitHub put everything in', () => {
    expect(entryPath('package/index.js')).toBe('index.js');
    expect(entryPath('alex-emoji-0a1b2c3/assets/icon.png')).toBe('assets/icon.png');
    expect(entryPath('./package/./lib//util.js')).toBe('lib/util.js');
    expect(entryPath('package/')).toBeUndefined();
    expect(entryPath('package')).toBeUndefined();
  });

  it('refuses paths that would leave the folder', () => {
    for (const name of [
      '/etc/passwd',
      '\\Windows\\evil.dll',
      'C:/Windows/evil.dll',
      'c:evil',
      'package/../../.bashrc',
      'package/..\\..\\evil.js',
      '../package.json',
      'package/a/../../../x',
      'package/file.js:stream',
      'package/evil\0.js',
    ]) {
      expect(() => entryPath(name), name).toThrow();
    }
  });
});

describe('readTarball', () => {
  it('reads the files of a gzipped archive, keeping which are programs', () => {
    const files = readTarball(
      tarball([
        { name: 'package/', type: '5' },
        { name: 'package/package.json', data: '{"name":"emoji"}' },
        { name: 'package/bin/run.sh', data: '#!/bin/sh\n', mode: 0o755 },
        { name: 'package/big.txt', data: 'x'.repeat(1300) },
      ]),
    );
    expect(files.map((file) => [file.path, file.executable])).toEqual([
      ['package.json', false],
      ['bin/run.sh', true],
      ['big.txt', false],
    ]);
    expect(files[0]?.data.toString()).toBe('{"name":"emoji"}');
    expect(files[2]?.data.length).toBe(1300);
  });

  it('reads a plain tar too', () => {
    const files = readTarball(tarball([{ name: 'package/index.js', data: 'ok' }], { gzip: false }));
    expect(files.map((file) => file.path)).toEqual(['index.js']);
  });

  it('takes long names from pax headers, and skips GitHub’s global one', () => {
    const long = `package/${'deep/'.repeat(30)}index.js`;
    const files = readTarball(
      tarball([
        { name: 'pax_global_header', type: 'g', data: paxRecord('comment', '0a1b2c3') },
        { name: 'PaxHeader/x', type: 'x', data: paxRecord('path', long) },
        { name: 'package/short-name', data: 'deep' },
        { name: 'package/after.js', data: 'after' },
      ]),
    );
    expect(files.map((file) => file.path)).toEqual([long.slice('package/'.length), 'after.js']);
  });

  it('takes long names from GNU headers', () => {
    const long = `package/${'a'.repeat(150)}.js`;
    const files = readTarball(
      tarball([
        { name: '././@LongLink', type: 'L', data: `${long}\0` },
        { name: 'package/aaaa', data: 'long' },
      ]),
    );
    expect(files[0]?.path).toBe(long.slice('package/'.length));
  });

  it('leaves out links, and refuses an archive with a path out of its folder', () => {
    const files = readTarball(
      tarball([
        { name: 'package/link', type: '2', linkname: '/etc/passwd' },
        { name: 'package/hard', type: '1', linkname: 'package/index.js' },
        { name: 'package/index.js', data: 'ok' },
      ]),
    );
    expect(files.map((file) => file.path)).toEqual(['index.js']);
    expect(() => readTarball(tarball([{ name: 'package/../../evil.js', data: 'evil' }]))).toThrow(/outside its folder/);
    expect(() =>
      readTarball(
        tarball([
          { name: 'PaxHeader/x', type: 'x', data: paxRecord('path', '/etc/cron.d/evil') },
          { name: 'package/fine.js', data: 'evil' },
        ]),
      ),
    ).toThrow(/outside its folder/);
  });

  it('refuses archives that are damaged, cut short or too big', () => {
    const tar = tarball([{ name: 'package/index.js', data: 'x'.repeat(2000) }], { gzip: false });
    const damaged = Buffer.from(tar);
    damaged[10] = 0x41;
    expect(() => readTarball(damaged)).toThrow(/damaged/);
    expect(() => readTarball(tar.subarray(0, 1024))).toThrow(/ends early/);
    expect(() => readTarball(Buffer.from([0x1f, 0x8b, 1, 2, 3]))).toThrow(/couldn't be unpacked/);
    expect(() => readTarball(gzipSync(tar), { files: 10, bytes: 1000 })).toThrow(/couldn't be unpacked/);
    const many = tarball([1, 2, 3].map((n) => ({ name: `package/${n}.js`, data: 'x' })));
    expect(() => readTarball(many, { files: 2, bytes: 1_000_000 })).toThrow(/more than 2 files/);
  });
});
