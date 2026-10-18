import { describe, expect, it } from 'vitest';
import { isNetworkPath } from './paths';

describe('isNetworkPath', () => {
  it('finds file shares however they are written', () => {
    for (const path of [
      '\\\\server\\share\\x.png',
      '//server/share/x.png',
      '//upload.wikimedia.org/x.png',
      '/\\server\\share\\x.png',
      '\\/server/share/x.png',
      '\\\\?\\UNC\\server\\share\\x.png',
      '\\\\.\\pipe\\name',
      '  \\\\server\\share',
    ]) {
      expect(isNetworkPath(path), path).toBe(true);
    }
  });

  it('leaves paths on this computer alone', () => {
    for (const path of ['/Users/me/x.png', 'C:\\Pictures\\x.png', 'C:/Pictures/x.png', 'x.png', '/', '']) {
      expect(isNetworkPath(path), path).toBe(false);
    }
  });
});
