import { app, dialog, ipcMain, shell } from 'electron';
import type { Settings } from '../shared/settings';
import {
  SETTINGS_LINKS,
  SettingsChannel,
  type SettingsLink,
  type SettingsLocation,
  type SettingsState,
} from '../shared/settings-ipc';
import type { Platform } from '../shared/types';
import type { ClipboardHistory } from './clipboard/history';
import { changeHotkey, type HotkeyManager } from './hotkey';
import type { CommandRegistry } from './registry';
import type { SettingsStore } from './settings';
import type { SettingsWindow } from './settings-window';

export interface SettingsIpcOptions {
  store: SettingsStore;
  window: SettingsWindow;
  hotkeys: HotkeyManager;
  registry: CommandRegistry;
  clipboardHistory: ClipboardHistory;
  platform: Platform;
  paths: { settingsFile: string; dataDirectory: string; extensionsDirectory: string; notesDirectory: () => string };
  /** Opens first-launch setup again. */
  openOnboarding(): void;
}

const PATCHABLE: Array<keyof Settings> = [
  'hideOnBlur',
  'launchAtLogin',
  'theme',
  'clipboardHistory',
  'extensionDirectories',
  'notesDirectory',
];

/** Wires the Settings window's `window.settings` API. */
export function registerSettingsIpc(options: SettingsIpcOptions): { notifyChanged(): void } {
  const { store, window, hotkeys, registry, clipboardHistory, platform, paths, openOnboarding } = options;

  const check = (event: Electron.IpcMainInvokeEvent | Electron.IpcMainEvent) => {
    if (!window.webContents || event.sender !== window.webContents) throw new Error('Unexpected sender');
  };

  const state = (): SettingsState => {
    const activeHotkey = hotkeys.current;
    return {
      settings: store.get(),
      ...(activeHotkey ? { activeHotkey } : {}),
      extensions: registry.listExtensions().map((info) => ({
        name: info.manifest?.name ?? info.dir ?? 'unknown',
        title: info.manifest?.title ?? info.dir ?? 'Unknown extension',
        source: info.source,
        commands: info.manifest?.commands.length ?? 0,
        ...(info.dir ? { dir: info.dir } : {}),
        ...(info.error ? { error: info.error } : {}),
      })),
      info: {
        version: app.getVersion(),
        electron: process.versions.electron,
        node: process.versions.node,
        platform,
        settingsFile: paths.settingsFile,
        dataDirectory: paths.dataDirectory,
        extensionsDirectory: paths.extensionsDirectory,
        notesDirectory: paths.notesDirectory(),
        clipboardEntries: clipboardHistory.entries().length,
        canLaunchAtLogin: platform !== 'linux' && app.isPackaged,
        packaged: app.isPackaged,
      },
    };
  };

  ipcMain.handle(SettingsChannel.get, (event) => {
    check(event);
    return state();
  });

  ipcMain.handle(SettingsChannel.update, (event, raw: unknown) => {
    check(event);
    const patch: Partial<Settings> = {};
    if (typeof raw === 'object' && raw !== null) {
      for (const key of PATCHABLE) {
        if (key in raw) (patch as Record<string, unknown>)[key] = (raw as Record<string, unknown>)[key];
      }
    }
    store.update(patch);
    return state();
  });

  ipcMain.handle(SettingsChannel.setHotkey, (event, accelerator: unknown) => {
    check(event);
    const error = changeHotkey(hotkeys, store, accelerator);
    return error ? { state: state(), error } : { state: state() };
  });

  ipcMain.on(SettingsChannel.pauseHotkey, (event, paused: unknown) => {
    check(event);
    if (paused === true) hotkeys.pause();
    else hotkeys.resume();
  });

  ipcMain.handle(SettingsChannel.chooseFolder, async (event, title: unknown) => {
    check(event);
    const result = await dialog.showOpenDialog({
      title: typeof title === 'string' ? title : 'Choose a folder',
      properties: ['openDirectory', 'createDirectory'],
    });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });

  ipcMain.on(SettingsChannel.open, (event, location: unknown) => {
    check(event);
    const targets: Record<SettingsLocation, () => string> = {
      settingsFile: () => paths.settingsFile,
      dataDirectory: () => paths.dataDirectory,
      extensionsDirectory: () => paths.extensionsDirectory,
      notesDirectory: paths.notesDirectory,
    };
    const target = targets[location as SettingsLocation];
    if (target) void shell.openPath(target());
  });

  ipcMain.on(SettingsChannel.openLink, (event, link: unknown) => {
    check(event);
    const url = SETTINGS_LINKS[link as SettingsLink];
    if (url) void shell.openExternal(url);
  });

  ipcMain.handle(SettingsChannel.reloadExtensions, async (event) => {
    check(event);
    await registry.loadUserExtensions();
    return state();
  });

  ipcMain.on(SettingsChannel.openOnboarding, (event) => {
    check(event);
    openOnboarding();
  });

  ipcMain.handle(SettingsChannel.clearClipboard, (event) => {
    check(event);
    clipboardHistory.clear();
    return state();
  });

  return {
    notifyChanged: () => window.webContents?.send(SettingsChannel.changed),
  };
}
