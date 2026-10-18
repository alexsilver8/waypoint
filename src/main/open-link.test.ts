import { describe, expect, it, vi } from 'vitest';
import { linkTarget, openLink, openWithCommand, resolveApp, windowsArgument } from './open-link';

describe('linkTarget', () => {
  it('opens web addresses and app links as URLs', () => {
    expect(linkTarget('https://github.com/search?q=a%20b', 'darwin', '/Users/me')).toEqual({
      type: 'url',
      url: 'https://github.com/search?q=a%20b',
    });
    expect(linkTarget('spotify:search:jazz', 'linux', '/home/me')).toEqual({ type: 'url', url: 'spotify:search:jazz' });
    expect(linkTarget('github.com/alexsilver8', 'linux', '/home/me')).toEqual({
      type: 'url',
      url: 'https://github.com/alexsilver8',
    });
  });

  it('opens paths, file links and ~ as files', () => {
    expect(linkTarget('~/Documents', 'darwin', '/Users/me')).toEqual({ type: 'path', path: '/Users/me/Documents' });
    expect(linkTarget('/tmp/a b.txt', 'linux', '/home/me')).toEqual({ type: 'path', path: '/tmp/a b.txt' });
    expect(linkTarget('file:///tmp/a%20b.txt', 'linux', '/home/me')).toEqual({ type: 'path', path: '/tmp/a b.txt' });
    expect(linkTarget('C:\\Users\\me\\notes.txt', 'win32', 'C:\\Users\\me')).toEqual({
      type: 'path',
      path: 'C:\\Users\\me\\notes.txt',
    });
    expect(linkTarget('~\\Downloads', 'win32', 'C:\\Users\\me')).toEqual({
      type: 'path',
      path: 'C:\\Users\\me\\Downloads',
    });
  });

  it('gives a web address as the URL parser writes it, so quotes and spaces can’t split it', () => {
    expect(linkTarget('https://example.com/" --renderer-cmd-prefix=calc.exe "', 'win32', 'C:\\')).toEqual({
      type: 'url',
      url: 'https://example.com/%22%20--renderer-cmd-prefix=calc.exe%20%22',
    });
    expect(linkTarget('example.com/"--flag"', 'win32', 'C:\\')).toEqual({
      type: 'url',
      url: 'https://example.com/%22--flag%22',
    });
  });

  it('refuses what it can’t or mustn’t open', () => {
    expect(() => linkTarget('javascript:alert(1)', 'darwin', '/')).toThrow("Can't open javascript: links.");
    expect(() => linkTarget('two words', 'darwin', '/')).toThrow('Not a link or a path: two words');
  });
});

describe('openWithCommand', () => {
  it('uses each system’s way of opening something with an app', () => {
    expect(openWithCommand('darwin', 'Firefox', 'https://x.com')).toEqual({
      file: 'open',
      args: ['-a', 'Firefox', 'https://x.com'],
    });
    expect(openWithCommand('linux', '/usr/share/applications/firefox.desktop', 'https://x.com')).toEqual({
      file: 'gio',
      args: ['launch', '/usr/share/applications/firefox.desktop', 'https://x.com'],
    });
    expect(openWithCommand('linux', '/usr/bin/code', '/tmp/a')).toEqual({ file: '/usr/bin/code', args: ['/tmp/a'] });
  });

  it('hands Windows the app and the target as values, never as PowerShell code', () => {
    const command = openWithCommand('win32', "C:\\Start Menu\\Bob's ‘Editor’.lnk", 'C:\\it’s; calc\\a b.txt');
    expect(command.file).toBe('powershell.exe');
    expect(command.args.at(-1)).toBe(
      'Start-Process -FilePath $env:WAYPOINT_OPEN_APP -ArgumentList $env:WAYPOINT_OPEN_ARGUMENT',
    );
    expect(command.env).toEqual({
      WAYPOINT_OPEN_APP: "C:\\Start Menu\\Bob's ‘Editor’.lnk",
      WAYPOINT_OPEN_ARGUMENT: '"C:\\it’s; calc\\a b.txt"',
    });
    // A quote in the target stays inside the one argument, rather than starting a switch.
    expect(
      openWithCommand('win32', 'chrome', 'foo:" --renderer-cmd-prefix=calc.exe "').env?.WAYPOINT_OPEN_ARGUMENT,
    ).toBe('"foo:\\" --renderer-cmd-prefix=calc.exe \\""');
  });
});

describe('windowsArgument', () => {
  it('quotes one argument so a Windows program reads it back whole', () => {
    expect(windowsArgument('C:\\a b.txt')).toBe('"C:\\a b.txt"');
    expect(windowsArgument('say "hi"')).toBe('"say \\"hi\\""');
    // Backslashes are doubled only before a quote, or the closing one.
    expect(windowsArgument('C:\\folder\\')).toBe('"C:\\folder\\\\"');
    expect(windowsArgument('a\\"b')).toBe('"a\\\\\\"b"');
    expect(windowsArgument('')).toBe('""');
  });
});

describe('resolveApp', () => {
  const apps = [{ name: 'Firefox', path: '/usr/share/applications/firefox.desktop' }];

  it('finds an app by name, or takes a path as it is', () => {
    expect(resolveApp('firefox', apps, 'linux')).toBe('/usr/share/applications/firefox.desktop');
    expect(resolveApp('/opt/app/run', apps, 'linux')).toBe('/opt/app/run');
    // macOS finds apps by name itself.
    expect(resolveApp('Safari', [], 'darwin')).toBe('Safari');
    expect(() => resolveApp('Nope', apps, 'win32')).toThrow("Couldn't find an app called “Nope”.");
  });
});

describe('openLink', () => {
  it('opens URLs and paths with the system when no app is named', async () => {
    const shell = { openExternal: vi.fn(async () => {}), openPath: vi.fn(async () => '') };
    const deps = { platform: 'linux' as const, home: '/home/me', apps: () => [], shell };
    await openLink('https://x.com/?q=1', undefined, deps);
    await openLink('~/notes', undefined, deps);
    expect(shell.openExternal).toHaveBeenCalledWith('https://x.com/?q=1');
    expect(shell.openPath).toHaveBeenCalledWith('/home/me/notes');
  });

  it('says why a path didn’t open', async () => {
    const shell = { openExternal: vi.fn(async () => {}), openPath: vi.fn(async () => 'No such file') };
    await expect(
      openLink('/nope', undefined, { platform: 'linux', home: '/home/me', apps: () => [], shell }),
    ).rejects.toThrow('No such file');
  });
});
