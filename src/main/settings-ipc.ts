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
import { type CommandHotkeys, changeCommandHotkey, commandShortcutList } from './command-hotkeys';
import { changeHotkey, type HotkeyManager } from './hotkey';
import { canLaunchAtLogin } from './login-item';
import type { CommandRegistry } from './registry';
import type { SettingsStore } from './settings';
import { registerEntriesIpc, type SettingsEntries } from './settings-entries-ipc';
import type { SettingsWindow } from './settings-window';
import type { Updater } from './updater';

export interface SettingsIpcOptions {
  store: SettingsStore;
  window: SettingsWindow;
  hotkeys: HotkeyManager;
  commandHotkeys: CommandHotkeys;
  registry: CommandRegistry;
  clipboardHistory: ClipboardHistory;
  platform: Platform;
  paths: { settingsFile: string; dataDirectory: string; extensionsDirectory: string; notesDirectory: () => string };
  /** Opens first-launch setup again. */
  openOnboarding(): void;
  /** Quicklinks and snippets, and the apps quicklinks can open with. */
  entries: SettingsEntries;
  updater: Updater;
}

const PATCHABLE: Array<keyof Settings> = [
  'hideOnBlur',
  'launchAtLogin',
  'theme',
  'clipboardHistory',
  'extensionDirectories',
  'notesDirectory',
  'checkForUpdates',
];

/** Wires the Settings window's `window.settings` API. */
export function registerSettingsIpc(options: SettingsIpcOptions): { notifyChanged(): void } {
  const {
    store,
    window,
    hotkeys,
    commandHotkeys,
    registry,
    clipboardHistory,
    platform,
    paths,
    openOnboarding,
    entries,
    updater,
  } = options;

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
      commands: commandShortcutList(registry.listCommands(), store.get().commandHotkeys, commandHotkeys),
      quicklinks: entries.quicklinks.list(),
      snippets: entries.snippets.list(),
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
        canLaunchAtLogin: canLaunchAtLogin(),
        packaged: app.isPackaged,
        updates: { mode: updater.mode, status: updater.status },
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

  ipcMain.on(SettingsChannel.updateAction, (event) => {
    check(event);
    updater.act();
  });

  ipcMain.handle(SettingsChannel.clearClipboard, (event) => {
    check(event);
    clipboardHistory.clear();
    return state();
  });

  ipcMain.handle(SettingsChannel.setCommandHotkey, (event, key: unknown, accelerator: unknown) => {
    check(event);
    const error = changeCommandHotkey(hotkeys, commandHotkeys, store, key, accelerator);
    return error ? { state: state(), error } : { state: state() };
  });

  ipcMain.handle(SettingsChannel.takeTarget, (event) => {
    check(event);
    return window.takeTarget();
  });

  registerEntriesIpc(check, entries, state);

  return {
    notifyChanged: () => window.webContents?.send(SettingsChannel.changed),
  };
}
