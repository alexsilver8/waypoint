import { existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { app, nativeTheme, shell } from 'electron';
import { NotesChannel, noteIdFromDeeplink, RECENTLY_DELETED_DAYS } from '../shared/notes';
import type { Platform } from '../shared/types';
import { AppIndex } from './apps/app-index';
import { electronClipboard } from './clipboard/electron-source';
import { ClipboardHistory } from './clipboard/history';
import { clipboardHistoryExtension, clipboardRootItems } from './commands/clipboard-history';
import { noteRootItems, notesExtension } from './commands/notes';
import { paletteExtension } from './commands/palette';
import { system } from './commands/system';
import { webSearch } from './commands/web-search';
import { windowManagementExtension } from './commands/window-management';
import { ExtensionHostClient } from './extensions/host-client';
import { HotkeyManager } from './hotkey';
import { handleIconProtocol, registerIconScheme } from './icon-protocol';
import { registerIpc } from './ipc';
import { captureDeeplinks, deeplinkIn, handleDeeplinks, registerDeeplinkScheme } from './notes/deeplink';
import { registerNotesIpc } from './notes/ipc';
import { NotesStore } from './notes/store';
import { NotesWindow } from './notes/window';
import { CommandRegistry } from './registry';
import { type Settings, SettingsStore } from './settings';
import { registerSettingsIpc } from './settings-ipc';
import { SettingsWindow } from './settings-window';
import { AppTray } from './tray';
import { UsageTracker } from './usage';
import { LauncherWindow } from './window';

// Lets tests and multiple dev copies use their own data folder. Otherwise, people who
// installed the app as Open Palette keep their notes and settings in the folder under that name.
const legacyData = join(app.getPath('appData'), 'Open Palette');
if (process.env.WAYPOINT_USER_DATA) app.setPath('userData', process.env.WAYPOINT_USER_DATA);
else if (existsSync(legacyData)) app.setPath('userData', legacyData);

registerIconScheme();
captureDeeplinks();

const DAY_MS = 24 * 60 * 60 * 1000;

if (!app.requestSingleInstanceLock()) {
  // Running `waypoint` again toggles the existing instance (handy on Wayland,
  // where global shortcuts can be bound to a command instead).
  app.quit();
} else {
  void main();
}

async function main(): Promise<void> {
  await app.whenReady();
  if (process.platform === 'darwin') app.dock?.hide();

  const platform = process.platform as Platform;
  const dataDir = app.getPath('userData');
  const extensionsDir = join(dataDir, 'extensions');
  mkdirSync(extensionsDir, { recursive: true });

  const settingsPath = join(dataDir, 'settings.json');
  const firstRun = !existsSync(settingsPath);
  const settings = new SettingsStore(settingsPath);
  const usage = new UsageTracker(join(dataDir, 'usage.json'));
  const apps = new AppIndex(platform);
  const clipboardHistory = new ClipboardHistory(
    join(dataDir, 'clipboard-history.json'),
    electronClipboard,
    settings.get().clipboardHistory.maxItems,
  );
  const host = new ExtensionHostClient(join(import.meta.dirname, 'extension-host.js'));

  const notesDirectoryFor = (current: Settings) => {
    const dir = current.notesDirectory;
    if (!dir) return join(dataDir, 'notes');
    return resolve(dir === '~' || /^~[\\/]/.test(dir) ? join(homedir(), dir.slice(1)) : dir);
  };
  const notesStore = new NotesStore(notesDirectoryFor(settings.get()), (path) => shell.trashItem(path));
  const notesWindow = new NotesWindow(join(dataDir, 'notes-window.json'));
  registerNotesIpc(notesStore, notesWindow);
  notesStore.on('change', () => notesWindow.webContents?.send(NotesChannel.changed));
  void notesStore.watch();
  // Recently Deleted keeps notes for 60 days; after that they go to the system Trash.
  const purgeDeletedNotes = () => void notesStore.purgeOlderThan(RECENTLY_DELETED_DAYS * DAY_MS);
  purgeDeletedNotes();
  setInterval(purgeDeletedNotes, DAY_MS / 4).unref();
  /** A waypoint://notes/<id> link opens that note, or just the Notes window if it's gone. */
  const openDeeplink = (url: string) => {
    const id = noteIdFromDeeplink(url);
    if (!id) return;
    void notesStore.get(id).then((note) => notesWindow.open(note?.id));
  };
  const settingsWindow = new SettingsWindow();

  const registry: CommandRegistry = new CommandRegistry({
    platform,
    host,
    apps,
    usage,
    supportRoot: join(dataDir, 'extension-data'),
    rootSources: [
      () => noteRootItems(notesStore),
      () => clipboardRootItems(clipboardHistory, () => settings.get().clipboardHistory.enabled),
    ],
    // Shipped with the app: inside its resources once installed, the repo's folder from source.
    bundledRoots: () => [join(app.isPackaged ? process.resourcesPath : app.getAppPath(), 'extensions')],
    extensionRoots: () => [
      extensionsDir,
      ...settings.get().extensionDirectories,
      // While developing, load the bundled examples too.
      ...(app.isPackaged ? [] : [join(app.getAppPath(), 'examples', 'extensions')]),
    ],
    builtins: [
      clipboardHistoryExtension(clipboardHistory, () => settings.get().clipboardHistory.enabled),
      notesExtension(notesStore, notesWindow),
      webSearch,
      system,
      // The launcher is created below; window commands only reach for it when they run.
      windowManagementExtension({ platform, launcher: () => launcher }),
      paletteExtension({ openSettings: () => settingsWindow.open(), extensionsDir, registry: () => registry }),
    ],
  });

  handleIconProtocol();
  // Leave a trace when a window's renderer or a helper process dies, instead of a silent blank.
  app.on('child-process-gone', (_event, details) => {
    console.error(`[process] ${details.type} process gone: ${details.reason} (exit code ${details.exitCode})`);
  });
  app.on('web-contents-created', (_event, contents) => {
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    contents.on('will-navigate', (event) => event.preventDefault());
  });

  const launcher = new LauncherWindow({ hideOnBlur: () => settings.get().hideOnBlur });
  const hotkeys = new HotkeyManager(() => launcher.toggle());
  registerIpc(registry, launcher, { pasteIntoApps: () => settings.get().pasteIntoApps });
  const settingsIpc = registerSettingsIpc({
    store: settings,
    window: settingsWindow,
    hotkeys,
    registry,
    clipboardHistory,
    platform,
    paths: {
      settingsFile: settingsPath,
      dataDirectory: dataDir,
      extensionsDirectory: extensionsDir,
      notesDirectory: () => notesDirectoryFor(settings.get()),
    },
  });
  registry.on('change', () => {
    launcher.rootItemsChanged();
    settingsIpc.notifyChanged();
  });
  notesStore.on('change', () => launcher.rootItemsChanged());
  app.on('second-instance', (_event, argv) => {
    const link = deeplinkIn(argv);
    if (link) openDeeplink(link);
    else launcher.show();
  });
  handleDeeplinks(openDeeplink);
  registerDeeplinkScheme();

  const tray = new AppTray({
    hotkey: () => hotkeys.current,
    onOpen: () => launcher.show(),
    onOpenNotes: () => notesWindow.open(),
    onOpenSettings: () => settingsWindow.open(),
    onOpenExtensionsFolder: () => void shell.openPath(extensionsDir),
    onReloadExtensions: () => void registry.loadUserExtensions(),
  });

  // Only the installed app can register itself to open at login: in development macOS
  // refuses ("Operation not permitted"), and it would register Electron itself anyway.
  const syncLoginItem = (openAtLogin: boolean) => {
    if (platform === 'linux' || !app.isPackaged) return;
    try {
      if (app.getLoginItemSettings().openAtLogin !== openAtLogin) app.setLoginItemSettings({ openAtLogin });
    } catch (error) {
      console.warn('[login item] Could not update:', error);
    }
  };

  const apply = (current: Settings, previous?: Settings) => {
    if (current.hotkey !== previous?.hotkey && !hotkeys.set(current.hotkey)) {
      const fallback = hotkeys.current ? ` Still using ${hotkeys.current}.` : '';
      console.warn(`[hotkey] Could not register "${current.hotkey}".`);
      launcher.toast({
        text: `Couldn't use “${current.hotkey}” as the shortcut. It may be invalid or taken by another app.${fallback}`,
        style: 'failure',
      });
      if (!hotkeys.current) launcher.show();
    }
    tray.refresh();
    nativeTheme.themeSource = current.theme;
    syncLoginItem(current.launchAtLogin);
    clipboardHistory.setMaxItems(current.clipboardHistory.maxItems);
    if (current.clipboardHistory.enabled) void clipboardHistory.start();
    else clipboardHistory.stop();
    if (previous && current.notesDirectory !== previous.notesDirectory) {
      notesStore.setDirectory(notesDirectoryFor(current));
    }
    if (previous && JSON.stringify(current.extensionDirectories) !== JSON.stringify(previous.extensionDirectories)) {
      void registry.loadUserExtensions();
    }
  };
  apply(settings.get());
  settings.on('change', (current, previous) => {
    apply(current, previous);
    settingsIpc.notifyChanged();
  });
  settings.watch();

  // Show the launcher right away in development, on first run, or when asked to. Apps and
  // extensions fill in as they load.
  if (!app.isPackaged || firstRun || process.argv.includes('--show')) launcher.show();

  await Promise.all([apps.refresh(), registry.loadUserExtensions()]);
  apps.startAutoRefresh();

  app.on('will-quit', () => {
    hotkeys.dispose();
    usage.flush();
    clipboardHistory.flush();
    notesWindow.flushState();
    notesStore.unwatch();
    host.stop();
  });
  // A launcher lives in the tray; closing its window must not quit the app.
  app.on('window-all-closed', () => {});
}
