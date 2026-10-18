import { describe, expect, it } from 'vitest';
import { fileIconSize, IconCache, type IconSources, iconRequestPath, loadFileIcon } from './icon-cache';

const bytes = (n: number) => new Uint8Array([n]);

describe('iconRequestPath', () => {
  const request = (path: string) => `palette-icon://icon?path=${encodeURIComponent(path)}`;

  it('serves files on this computer', () => {
    expect(iconRequestPath(request('/Users/me/shot.png'))).toBe('/Users/me/shot.png');
    expect(iconRequestPath(request('C:\\Pictures\\cat.jpg'))).toBe('C:\\Pictures\\cat.jpg');
  });

  it('refuses file shares, which Windows would sign in to', () => {
    for (const path of [
      '//upload.wikimedia.org/x.png',
      '\\\\server\\share\\x.png',
      '\\\\?\\UNC\\server\\share\\x.png',
      '/\\server\\share\\x.png',
    ]) {
      expect(iconRequestPath(request(path)), path).toBeUndefined();
    }
  });

  it('refuses a request without a path', () => {
    expect(iconRequestPath('palette-icon://icon')).toBeUndefined();
    expect(iconRequestPath('palette-icon://icon?path=')).toBeUndefined();
    expect(iconRequestPath('not a url')).toBeUndefined();
  });
});

describe('IconCache', () => {
  it('loads each icon once', async () => {
    const calls: string[] = [];
    const cache = new IconCache(async (path) => {
      calls.push(path);
      return bytes(path.length);
    });
    await Promise.all([cache.get('/a'), cache.get('/a'), cache.get('/bb')]);
    await cache.get('/a');
    expect(calls).toEqual(['/a', '/bb']);
  });

  it('never runs more loads at once than allowed', async () => {
    let running = 0;
    let peak = 0;
    const cache = new IconCache(
      async () => {
        running++;
        peak = Math.max(peak, running);
        await new Promise((resolve) => setTimeout(resolve, 5));
        running--;
        return bytes(0);
      },
      100,
      3,
    );
    await Promise.all(Array.from({ length: 20 }, (_, i) => cache.get(`/app-${i}`)));
    expect(peak).toBe(3);
  });

  it('retries icons that failed to load', async () => {
    let attempts = 0;
    const cache = new IconCache(async () => {
      attempts++;
      if (attempts === 1) throw new Error('not yet');
      return bytes(1);
    });
    await expect(cache.get('/a')).rejects.toThrow('not yet');
    await expect(cache.get('/a')).resolves.toEqual(bytes(1));
  });

  it('forgets the least recently used icons when full', async () => {
    const calls: string[] = [];
    const cache = new IconCache(async (path) => {
      calls.push(path);
      return bytes(0);
    }, 2);
    await cache.get('/a');
    await cache.get('/b');
    await cache.get('/a');
    await cache.get('/c'); // evicts /b, the least recently used
    await cache.get('/a');
    await cache.get('/b');
    expect(calls).toEqual(['/a', '/b', '/c', '/b']);
  });
});

describe('fileIconSize', () => {
  it('never asks macOS for the unsupported large size', () => {
    expect(fileIconSize('darwin')).toBe('normal');
    expect(fileIconSize('win32')).toBe('normal');
    expect(fileIconSize('linux')).toBe('large');
  });
});

describe('loadFileIcon', () => {
  const sources = (overrides: Partial<IconSources> = {}) => {
    const calls: string[] = [];
    const all: IconSources = {
      thumbnail: async (path) => {
        calls.push(`thumbnail ${path}`);
        return bytes(1);
      },
      fileIcon: async (path) => {
        calls.push(`fileIcon ${path}`);
        return bytes(2);
      },
      realpath: async (path) => (path === '/Applications/Safari.app' ? '/System/Cryptexes/Safari.app' : path),
      ...overrides,
    };
    return { all, calls };
  };

  it("draws an app's own icon with Quick Look on macOS, from its real path", async () => {
    const { all, calls } = sources();
    expect(await loadFileIcon('/Applications/Safari.app', 'darwin', all)).toEqual(bytes(1));
    expect(calls).toEqual(['thumbnail /System/Cryptexes/Safari.app']);
  });

  it("falls back to the file icon when Quick Look can't draw it", async () => {
    for (const thumbnail of [
      async () => {
        throw new Error('unable to retrieve thumbnail preview image');
      },
      async () => undefined,
    ]) {
      const { all, calls } = sources({ thumbnail });
      expect(await loadFileIcon('/Applications/Odd.app', 'darwin', all)).toEqual(bytes(2));
      expect(calls).toEqual(['fileIcon /Applications/Odd.app']);
    }
  });

  it('uses the file icon elsewhere, and fails when there is none', async () => {
    const { all, calls } = sources();
    expect(await loadFileIcon('C:\\Program Files\\App\\app.exe', 'win32', all)).toEqual(bytes(2));
    expect(calls).toEqual(['fileIcon C:\\Program Files\\App\\app.exe']);
    await expect(loadFileIcon('/x', 'linux', sources({ fileIcon: async () => undefined }).all)).rejects.toThrow(
      'No icon for /x',
    );
  });
});
