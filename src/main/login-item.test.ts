import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, type Settings } from '../shared/settings';

const electron = vi.hoisted(() => ({
  app: {
    isPackaged: true,
    getLoginItemSettings: vi.fn(() => ({ openAtLogin: false })),
    setLoginItemSettings: vi.fn(),
  },
}));
vi.mock('electron', () => electron);

const { canLaunchAtLogin, syncLoginItem } = await import('./login-item');
const { SettingsStore } = await import('./settings');

const savedEnv = { ...process.env };
let config: string;
let store: InstanceType<typeof SettingsStore>;
const entry = () => join(config, 'autostart', 'dev.waypoint.app.desktop');
const settings = (patch: Partial<Settings>): Settings => ({ ...DEFAULT_SETTINGS, ...patch });

beforeEach(() => {
  config = mkdtempSync(join(tmpdir(), 'waypoint-login-'));
  for (const key of ['APPIMAGE', 'APPDIR', 'SNAP', 'SNAP_NAME', 'FLATPAK_ID']) delete process.env[key];
  process.env.XDG_CONFIG_HOME = config;
  store = new SettingsStore(join(mkdtempSync(join(tmpdir(), 'waypoint-settings-')), 'settings.json'));
  electron.app.isPackaged = true;
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  process.env = { ...savedEnv };
  vi.restoreAllMocks();
  electron.app.setLoginItemSettings.mockClear();
});

describe('canLaunchAtLogin', () => {
  it('is only the installed app', () => {
    expect(canLaunchAtLogin()).toBe(true);
    electron.app.isPackaged = false;
    expect(canLaunchAtLogin()).toBe(false);
  });
});

describe('syncLoginItem on Linux', () => {
  it('follows the setting at startup and when it changes', () => {
    syncLoginItem('linux', store, settings({ launchAtLogin: true }));
    expect(existsSync(entry())).toBe(true);
    syncLoginItem('linux', store, settings({ launchAtLogin: false }), settings({ launchAtLogin: true }));
    expect(existsSync(entry())).toBe(false);
  });

  it("leaves it alone when something else changes, so it doesn't undo the desktop's own settings", () => {
    syncLoginItem('linux', store, settings({ launchAtLogin: true }));
    rmSync(entry());
    syncLoginItem('linux', store, settings({ launchAtLogin: true, theme: 'dark' }), settings({ launchAtLogin: true }));
    expect(existsSync(entry())).toBe(false);
  });

  it('wins over the file at startup', () => {
    syncLoginItem('linux', store, settings({ launchAtLogin: true }));
    syncLoginItem('linux', store, settings({ launchAtLogin: false }));
    expect(existsSync(entry())).toBe(false);
  });

  it('does nothing from source, where it would register Electron', () => {
    electron.app.isPackaged = false;
    syncLoginItem('linux', store, settings({ launchAtLogin: true }));
    expect(existsSync(join(config, 'autostart'))).toBe(false);
  });

  it("turns the setting back off when the entry can't be written", () => {
    writeFileSync(join(config, 'autostart'), '');
    store.update({ launchAtLogin: true });
    syncLoginItem('linux', store, store.get(), settings({ launchAtLogin: false }));
    expect(store.get().launchAtLogin).toBe(false);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('Could not write'));
  });
});

describe('syncLoginItem on macOS and Windows', () => {
  it('registers through Electron', () => {
    syncLoginItem('darwin', store, settings({ launchAtLogin: true }));
    expect(electron.app.setLoginItemSettings).toHaveBeenCalledWith({ openAtLogin: true });
    expect(existsSync(join(config, 'autostart'))).toBe(false);
  });

  it('keeps the setting when Electron fails, as before', () => {
    electron.app.setLoginItemSettings.mockImplementationOnce(() => {
      throw new Error('Operation not permitted');
    });
    store.update({ launchAtLogin: true });
    syncLoginItem('win32', store, store.get());
    expect(store.get().launchAtLogin).toBe(true);
    expect(console.warn).toHaveBeenCalled();
  });
});
