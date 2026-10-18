import { describe, expect, it } from 'vitest';
import { releaseUrl, updateDescription, updateMenuLabel, updateMode } from './updates';

describe('updateMode', () => {
  it('never checks from source', () => {
    expect(updateMode({ platform: 'win32', packaged: false })).toBe('off');
    expect(updateMode({ platform: 'linux', packaged: false, appImage: '/a/Waypoint.AppImage' })).toBe('off');
  });

  it('installs on Windows and from an AppImage', () => {
    expect(updateMode({ platform: 'win32', packaged: true })).toBe('install');
    expect(updateMode({ platform: 'linux', packaged: true, appImage: '/a/Waypoint.AppImage' })).toBe('install');
  });

  it('only says a version is out on macOS, which needs a signed app, and from a .deb', () => {
    expect(updateMode({ platform: 'darwin', packaged: true })).toBe('notify');
    expect(updateMode({ platform: 'linux', packaged: true })).toBe('notify');
  });
});

describe('updateMenuLabel', () => {
  it('checks when there is nothing going on', () => {
    expect(updateMenuLabel({ state: 'idle' }, 'install')).toEqual({ label: 'Check for Updates…', enabled: true });
    expect(updateMenuLabel({ state: 'error', message: 'offline' }, 'install').label).toBe('Check for Updates…');
    expect(updateMenuLabel({ state: 'checking' }, 'install').enabled).toBe(false);
  });

  it('downloads by itself, or offers the download', () => {
    const available = { state: 'available', version: '1.2.0' } as const;
    expect(updateMenuLabel(available, 'install')).toEqual({ label: 'Downloading Waypoint 1.2.0…', enabled: false });
    expect(updateMenuLabel(available, 'notify')).toEqual({ label: 'Download Waypoint 1.2.0…', enabled: true });
    expect(updateMenuLabel({ state: 'downloading', version: '1.2.0', percent: 42.7 }, 'install').label).toBe(
      'Downloading Waypoint 1.2.0 (42%)…',
    );
  });

  it('restarts into a downloaded version', () => {
    expect(updateMenuLabel({ state: 'ready', version: '1.2.0' }, 'install')).toEqual({
      label: 'Restart to Update to 1.2.0',
      enabled: true,
    });
  });
});

describe('updateDescription', () => {
  it('says how this copy updates until it has checked', () => {
    expect(updateDescription({ state: 'idle' }, 'install')).toMatch(/download by themselves/);
    expect(updateDescription({ state: 'idle' }, 'notify')).toMatch(/tells you/);
    expect(updateDescription({ state: 'error', message: 'offline' }, 'notify')).toBe(
      "Couldn't check for updates: offline",
    );
  });
});

it('links to a version’s release', () => {
  expect(releaseUrl('1.2.0')).toBe('https://github.com/alexsilver8/waypoint/releases/tag/v1.2.0');
});
