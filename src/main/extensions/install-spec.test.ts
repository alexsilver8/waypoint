import { describe, expect, it } from 'vitest';
import { describeSource, formatInstallSpec, type InstallSource, parseInstallSpec, updateSource } from './install-spec';

describe('parseInstallSpec', () => {
  it('reads npm packages, with a version or tag', () => {
    expect(parseInstallSpec('port-manager')).toEqual({ kind: 'npm', name: 'port-manager' });
    expect(parseInstallSpec('  port-manager@1.2.0 ')).toEqual({ kind: 'npm', name: 'port-manager', version: '1.2.0' });
    expect(parseInstallSpec('@you/emoji')).toEqual({ kind: 'npm', name: '@you/emoji' });
    expect(parseInstallSpec('@you/emoji@next')).toEqual({ kind: 'npm', name: '@you/emoji', version: 'next' });
    expect(parseInstallSpec('npm:emoji@2.0.0-beta.1')).toEqual({ kind: 'npm', name: 'emoji', version: '2.0.0-beta.1' });
  });

  it('refuses npm names and versions npm wouldn’t take', () => {
    expect(() => parseInstallSpec('Port-Manager')).toThrow(/isn't an npm package name/);
    expect(() => parseInstallSpec('emoji@^1.2.0')).toThrow(/Give one like 1\.2\.0/);
    expect(() => parseInstallSpec('emoji@')).toThrow(/isn't a version/);
    expect(() => parseInstallSpec('@you')).toThrow(/isn't an npm package name/);
    expect(() => parseInstallSpec('')).toThrow(/Type an npm package name/);
    expect(() => parseInstallSpec('two words')).toThrow(/no spaces/);
  });

  it('reads GitHub repositories in every way they’re written', () => {
    const repo = { kind: 'github', owner: 'alex', repo: 'emoji' };
    expect(parseInstallSpec('github:alex/emoji')).toEqual(repo);
    expect(parseInstallSpec('alex/emoji')).toEqual(repo);
    expect(parseInstallSpec('https://github.com/alex/emoji')).toEqual(repo);
    expect(parseInstallSpec('https://github.com/alex/emoji.git')).toEqual(repo);
    expect(parseInstallSpec('git+https://github.com/alex/emoji.git')).toEqual(repo);
    expect(parseInstallSpec('git@github.com:alex/emoji.git')).toEqual(repo);
    expect(parseInstallSpec('github:alex/emoji#v1.0.0')).toEqual({ ...repo, ref: 'v1.0.0' });
    expect(parseInstallSpec('https://github.com/alex/emoji#feature/skin-tones')).toEqual({
      ...repo,
      ref: 'feature/skin-tones',
    });
  });

  it('reads a link to a folder in a GitHub repository', () => {
    expect(parseInstallSpec('https://github.com/alex/tools/tree/main/extensions/emoji')).toEqual({
      kind: 'github',
      owner: 'alex',
      repo: 'tools',
      ref: 'main',
      path: 'extensions/emoji',
    });
    expect(parseInstallSpec('https://github.com/alex/tools/tree/HEAD/emoji')).toEqual({
      kind: 'github',
      owner: 'alex',
      repo: 'tools',
      path: 'emoji',
    });
    expect(() => parseInstallSpec('https://github.com/alex/tools/tree/main/../secrets')).toThrow(/without/);
    expect(() => parseInstallSpec('https://github.com/alex/tools/tree/main/%2e%2e/x')).toThrow(/without/);
    expect(() => parseInstallSpec('https://github.com/alex/tools/blob/main/index.js')).toThrow(
      /Link to the repository/,
    );
    expect(() => parseInstallSpec('https://github.com/alex')).toThrow(/Link to a repository/);
  });

  it('reads other git repositories by their https or ssh address', () => {
    expect(parseInstallSpec('https://gitlab.com/alex/emoji.git')).toEqual({
      kind: 'git',
      url: 'https://gitlab.com/alex/emoji.git',
    });
    expect(parseInstallSpec('git+https://codeberg.org/alex/emoji#v2')).toEqual({
      kind: 'git',
      url: 'https://codeberg.org/alex/emoji',
      ref: 'v2',
    });
    expect(parseInstallSpec('ssh://git@example.com/alex/emoji.git')).toEqual({
      kind: 'git',
      url: 'ssh://git@example.com/alex/emoji.git',
    });
    expect(parseInstallSpec('git@gitlab.com:alex/emoji.git#main')).toEqual({
      kind: 'git',
      url: 'git@gitlab.com:alex/emoji.git',
      ref: 'main',
    });
  });

  it('refuses addresses that aren’t safe or aren’t repositories', () => {
    expect(() => parseInstallSpec('http://example.com/emoji.git')).toThrow(/https/);
    expect(() => parseInstallSpec('git://example.com/emoji.git')).toThrow(/https/);
    expect(() => parseInstallSpec('https://user:token@gitlab.com/alex/emoji.git')).toThrow(/sign-in/);
    expect(() => parseInstallSpec('https://gitlab.com')).toThrow(/doesn't name a repository/);
    expect(() => parseInstallSpec('ftp://example.com/emoji')).toThrow(/can't install/);
    expect(() => parseInstallSpec('git@gitlab.com:-oProxyCommand=evil')).toThrow(/doesn't name a repository/);
    // A ref git could take for an option.
    expect(() => parseInstallSpec('github:alex/emoji#--upload-pack=evil')).toThrow(/isn't a branch or tag/);
    expect(() => parseInstallSpec('github:alex/emoji#a/../b')).toThrow(/isn't a branch or tag/);
    expect(() => parseInstallSpec('github:alex/emoji/extra')).toThrow(/owner\/repo/);
    expect(() => parseInstallSpec('github:../emoji')).toThrow(/isn't a GitHub repository/);
  });

  it('points folders on this computer to the extensions folder', () => {
    for (const path of ['./emoji', '../emoji', '/Users/alex/emoji', '~/emoji', 'C:\\emoji', 'file:///emoji']) {
      expect(() => parseInstallSpec(path)).toThrow(/put it in the extensions folder/);
    }
  });
});

describe('formatInstallSpec', () => {
  it('writes each source so it reads back the same', () => {
    const sources: InstallSource[] = [
      { kind: 'npm', name: 'emoji' },
      { kind: 'npm', name: '@you/emoji', version: '1.2.0' },
      { kind: 'github', owner: 'alex', repo: 'emoji' },
      { kind: 'github', owner: 'alex', repo: 'emoji', ref: 'v1' },
      { kind: 'github', owner: 'alex', repo: 'tools', path: 'extensions/emoji' },
      { kind: 'github', owner: 'alex', repo: 'tools', ref: 'main', path: 'emoji' },
      { kind: 'git', url: 'https://gitlab.com/alex/emoji.git', ref: 'main' },
      { kind: 'git', url: 'git@gitlab.com:alex/emoji.git' },
    ];
    for (const source of sources) expect(parseInstallSpec(formatInstallSpec(source))).toEqual(source);
  });
});

describe('describeSource', () => {
  it('says where an extension comes from', () => {
    expect(describeSource({ kind: 'npm', name: 'emoji', version: '1.0.0' })).toBe('npm (emoji)');
    expect(describeSource({ kind: 'github', owner: 'alex', repo: 'tools', ref: 'main', path: 'emoji' })).toBe(
      'github.com/alex/tools/emoji (main)',
    );
    expect(describeSource({ kind: 'git', url: 'https://gitlab.com/alex/emoji.git' })).toBe(
      'https://gitlab.com/alex/emoji.git',
    );
  });
});

describe('updateSource', () => {
  it('looks for the latest version instead of an exact one, and keeps tags and branches', () => {
    expect(updateSource({ kind: 'npm', name: 'emoji', version: '1.2.0' })).toEqual({ kind: 'npm', name: 'emoji' });
    expect(updateSource({ kind: 'npm', name: 'emoji', version: 'next' })).toEqual({
      kind: 'npm',
      name: 'emoji',
      version: 'next',
    });
    const branch: InstallSource = { kind: 'github', owner: 'alex', repo: 'emoji', ref: 'main' };
    expect(updateSource(branch)).toBe(branch);
  });
});
