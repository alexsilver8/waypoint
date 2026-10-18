import { existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  app,
  BrowserWindow,
  clipboard,
  Notification,
  nativeTheme,
  net,
  powerSaveBlocker,
  shell,
  systemPreferences,
} from 'electron';
import electronUpdater from 'electron-updater';
import { commandFromDeeplink, commandInArgv, launchArguments } from '../shared/command-hotkeys';
import { NotesChannel, noteIdFromDeeplink, RECENTLY_DELETED_DAYS } from '../shared/notes';
import type { OnboardingOutcome } from '../shared/onboarding';
import type { Platform } from '../shared/types';
import { updateMode } from '../shared/updates';
import { AppIndex } from './apps/app-index';
import { electronClipboard } from './clipboard/electron-source';
import { ClipboardHistory } from './clipboard/history';
import { commandShortcuts } from './command-shortcuts';
import { clipboardHistoryExtension, clipboardRootItems } from './commands/clipboard-history';
import { noteRootItems, notesExtension } from './commands/notes';
import { paletteExtension } from './commands/palette';
import { quicklinkRootItems, quicklinksExtension } from './commands/quicklinks';
import { snippetRootItems, snippetsExtension } from './commands/snippets';
import { system } from './commands/system';
import { webSearch } from './commands/web-search';
import { windowManagementExtension } from './commands/window-management';
import { QuicklinkStore, SnippetStore } from './entry-store';
import { ExchangeRateStore } from './exchange-rates';
import { ExtensionHostClient } from './extensions/host-client';
import { ExtensionInstaller } from './extensions/installer';
import { hostServices } from './extensions/services';
import { HotkeyManager } from './hotkey';
import { handleIconProtocol, registerIconScheme } from './icon-protocol';
import { registerIpc } from './ipc';
import { canLaunchAtLogin, syncLoginItem } from './login-item';
import { captureDeeplinks, deeplinkIn, handleDeeplinks, registerDeeplinkScheme } from './notes/deeplink';
import { registerNotesIpc } from './notes/ipc';
import { NotesStore } from './notes/store';
import { NotesWindow } from './notes/window';
import { registerOnboardingIpc } from './onboarding/ipc';
import { OnboardingStore } from './onboarding/store';
import { OnboardingWindow } from './onboarding/window';
import { openLink } from './open-link';
import { WakeLocks } from './power';
import { CommandRegistry } from './registry';
import { type Settings, SettingsStore } from './settings';
import { registerSettingsIpc } from './settings-ipc';
import { SettingsWindow } from './settings-window';
import { SnippetExpander } from './snippet-expansion/expander';
import { electronClipboardKeeper, loadKeyboardHook } from './snippet-expansion/system';
import { AppTray } from './tray';
import { Updater } from './updater';
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

// A second copy sends its arguments along as it got them (see `launchArguments`).
if (!app.requestSingleInstanceLock({ argv: process.argv })) {
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
  const onboarding = new OnboardingStore(join(dataDir, 'onboarding.json'), firstRun);
  const usage = new UsageTracker(join(dataDir, 'usage.json'));
  const apps = new AppIndex(platform);
  const clipboardHistory = new ClipboardHistory(
    join(dataDir, 'clipboard-history.json'),
    electronClipboard,
    settings.get().clipboardHistory.maxItems,
  );
  // Wake locks are held here, so they last when the extension host restarts.
  const host = new ExtensionHostClient(
    join(import.meta.dirname, 'extension-host.js'),
    hostServices(new WakeLocks(powerSaveBlocker)),
  );

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
  /**
   * A waypoint://notes/<id> link opens that note, or just the Notes window if it's gone; a
   * waypoint://commands/<extension>/<command> link opens that command.
   */
  const openDeeplink = (url: string) => {
    const command = commandFromDeeplink(url);
    if (command) {
      void commands.runner.run(command, { ask: true });
      return;
    }
    const id = noteIdFromDeeplink(url);
    if (!id) return;
    void notesStore.get(id).then((note) => notesWindow.open(note?.id));
  };
  // Closing it mid-recording mustn't leave the shortcuts paused.
  const settingsWindow = new SettingsWindow({ onClosed: () => hotkeys.resume() });
  // Quicklinks and snippets: made and changed in forms in the launcher, or in Settings.
  const quicklinks = new QuicklinkStore(join(dataDir, 'quicklinks.json'));
  const snippets = new SnippetStore(join(dataDir, 'snippets.json'));
  const readClipboard = () => clipboard.readText();
  // Type a snippet's keyword in any app, and it's replaced by the snippet.
  const snippetExpander = new SnippetExpander({
    platform,
    loadHook: loadKeyboardHook,
    snippets: () => snippets.list(),
    waypointFocused: () => BrowserWindow.getFocusedWindow() !== null,
    trusted: (prompt) => systemPreferences.isTrustedAccessibilityClient(prompt),
    readClipboard,
    clipboard: electronClipboardKeeper((text) => clipboardHistory.ignore(text)),
  });
  const usageScore = (id: string) => usage.score(id);
  // Extensions from npm and git. Each is downloaded and checked next to the extensions folder, and
  // moved in once you confirm it. Electron's own fetch goes through the system's proxy.
  const installer = new ExtensionInstaller({
    extensionsDir,
    stagingDir: join(dataDir, 'extension-installs'),
    fetch: ((input, init) => net.fetch(input as string, init)) as typeof fetch,
    // Lets tests install from a registry of their own.
    ...(process.env.WAYPOINT_NPM_REGISTRY ? { registry: process.env.WAYPOINT_NPM_REGISTRY } : {}),
    nameTaken: (name, dir) =>
      registry
        .listExtensions()
        .some((info) => info.manifest?.name === name && (!info.dir || resolve(info.dir) !== resolve(dir))),
  });
  installer.cleanUp();

  const registry: CommandRegistry = new CommandRegistry({
    platform,
    host,
    apps,
    usage,
    supportRoot: join(dataDir, 'extension-data'),
    rootSources: [
      () => noteRootItems(notesStore),
      () => clipboardRootItems(clipboardHistory, () => settings.get().clipboardHistory.enabled),
      () => quicklinkRootItems(quicklinks, usageScore),
      () => snippetRootItems(snippets, usageScore, readClipboard),
    ],
    commandHotkey: (key) => commands.hotkeys.activeFor(key),
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
      quicklinksExtension({
        store: quicklinks,
        platform,
        readClipboard,
        open: (link, openWith) =>
          openLink(link, openWith, { platform, home: homedir(), apps: () => apps.list(), shell }),
        apps: () => apps.byName(),
        editInSettings: (id) => settingsWindow.open({ section: 'quicklinks', edit: id }),
      }),
      snippetsExtension({
        store: snippets,
        readClipboard,
        editInSettings: (id) => settingsWindow.open({ section: 'snippets', edit: id }),
      }),
      webSearch,
      system,
      // The launcher is created below; window commands only reach for it when they run.
      windowManagementExtension({ platform, launcher: () => launcher }),
      paletteExtension({
        openSettings: (command) => settingsWindow.open(command ? { section: 'extensions', command } : undefined),
        // Setup's window is made below too; the command only reaches for it when it runs.
        openOnboarding: () => onboardingWindow.open(),
        extensionsDir,
        registry: () => registry,
        installer,
      }),
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

  // New versions come from the GitHub releases (see `publish` in electron-builder.yml).
  // The notification is kept, or it can be collected before it's clicked.
  let updateNotification: Notification | undefined;
  const updater = new Updater({
    mode: updateMode({ platform, packaged: app.isPackaged, appImage: process.env.APPIMAGE }),
    backend: () => {
      const { autoUpdater } = electronUpdater;
      autoUpdater.logger = console;
      return autoUpdater;
    },
    enabled: () => settings.get().checkForUpdates,
    notify: (text, onClick) => {
      if (!Notification.isSupported()) return;
      updateNotification = new Notification({ title: 'Waypoint', body: text });
      updateNotification.on('click', onClick);
      updateNotification.show();
    },
    openUrl: (url) => void shell.openExternal(url),
  });

  let quitting = false;
  app.on('before-quit', () => {
    quitting = true;
  });
  /** Ends setup for good: remembers how, closes its window and opens the launcher. */
  const finishOnboarding = (outcome: OnboardingOutcome) => {
    onboarding.complete(outcome);
    onboardingWindow.close();
    launcher.show();
  };
  const onboardingWindow = new OnboardingWindow({
    onClosed: () => {
      // Closing it mid-recording mustn't leave the shortcut paused.
      hotkeys.resume();
      // Closed some other way than its buttons (⌘W, Alt+F4), it counts as skipped. Quitting
      // halfway doesn't, so setup opens again next time.
      if (!quitting && onboarding.pending) finishOnboarding('skipped');
    },
    // Nor must its page going away mid-recording.
    onPageGone: () => hotkeys.resume(),
  });

  // While setup is open the shortcut answers there instead, so you can try it.
  const hotkeys = new HotkeyManager(() => {
    if (onboardingWindow.isOpen) onboardingWindow.hotkeyPressed();
    else launcher.toggle();
  });
  const commands = commandShortcuts({
    platform,
    settings,
    registry,
    launcher,
    hotkeys,
    onChange: () => {
      launcher.rootItemsChanged();
      settingsIpc.notifyChanged();
    },
  });
  // For converting currencies in the calculator; fetched when the launcher asks and they're a day old.
  const exchangeRates = new ExchangeRateStore({
    path: join(dataDir, 'exchange-rates.json'),
    fetch: (url, init) => net.fetch(url, init),
  });
  exchangeRates.on('change', () => launcher.exchangeRatesChanged());
  registerIpc(registry, launcher, { pasteIntoApps: () => settings.get().pasteIntoApps, exchangeRates });
  const settingsIpc = registerSettingsIpc({
    store: settings,
    window: settingsWindow,
    hotkeys,
    commandHotkeys: commands.hotkeys,
    registry,
    clipboardHistory,
    platform,
    paths: {
      settingsFile: settingsPath,
      dataDirectory: dataDir,
      extensionsDirectory: extensionsDir,
      notesDirectory: () => notesDirectoryFor(settings.get()),
    },
    openOnboarding: () => onboardingWindow.open(),
    entries: { quicklinks, snippets, apps },
    snippetExpansion: snippetExpander,
    updater,
    installer,
    openCommand: (ref) => void commands.runner.run(ref),
  });
  snippetExpander.on('status', () => settingsIpc.notifyChanged());
  const onboardingIpc = registerOnboardingIpc({
    store: settings,
    window: onboardingWindow,
    hotkeys,
    platform,
    canLaunchAtLogin: canLaunchAtLogin(),
    onFinish: finishOnboarding,
  });
  registry.on('change', () => {
    launcher.rootItemsChanged();
    settingsIpc.notifyChanged();
  });
  notesStore.on('change', () => launcher.rootItemsChanged());
  for (const store of [quicklinks, snippets]) {
    store.on('change', () => {
      launcher.rootItemsChanged();
      settingsIpc.notifyChanged();
    });
    store.watch();
  }
  app.on('second-instance', (_event, rawArgv: readonly string[] | undefined, _directory, data: unknown) => {
    const argv = launchArguments(rawArgv, data);
    const command = commandInArgv(argv);
    const link = deeplinkIn(argv);
    // `waypoint --command <extension>/<command>` runs it, for desktop shortcuts where global ones don't arrive.
    if (command) void commands.runner.run(command);
    else if (link) openDeeplink(link);
    else if (argv?.includes('--onboarding')) onboardingWindow.open();
    // On Linux, running `waypoint` again is how a desktop shortcut opens Waypoint where global
    // shortcuts don't arrive (Wayland), so during setup it counts as the shortcut being pressed.
    else if (onboardingWindow.isOpen && platform === 'linux') onboardingWindow.hotkeyPressed();
    else if (onboardingWindow.isOpen) onboardingWindow.open();
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
    updates: () => ({ status: updater.status, mode: updater.mode }),
    onUpdate: () => updater.act(),
  });
  updater.on('change', () => {
    tray.refresh();
    settingsIpc.notifyChanged();
  });
  updater.start();

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
    syncLoginItem(platform, settings, current, previous);
    clipboardHistory.setMaxItems(current.clipboardHistory.maxItems);
    clipboardHistory.setKeepImages(current.clipboardHistory.images);
    if (current.clipboardHistory.enabled) void clipboardHistory.start();
    else clipboardHistory.stop();
    if (current.snippetExpansion !== previous?.snippetExpansion) {
      // Asks for Accessibility when it's turned on, not each time Waypoint starts with it on.
      void snippetExpander.setEnabled(current.snippetExpansion, previous !== undefined);
    }
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
    onboardingIpc.notifyChanged();
  });
  settings.watch();

  // On first run, setup opens in place of the launcher (and again until it's finished or skipped).
  // Otherwise show the launcher right away in development, or when asked to. Apps and extensions
  // fill in as they load.
  const launchCommand = commandInArgv(process.argv);
  if (onboarding.pending || process.argv.includes('--onboarding')) onboardingWindow.open();
  else if (launchCommand) void commands.runner.run(launchCommand);
  else if (!app.isPackaged || process.argv.includes('--show')) launcher.show();

  await Promise.all([apps.refresh(), registry.loadUserExtensions()]);
  apps.startAutoRefresh();

  app.on('will-quit', () => {
    updater.stop();
    hotkeys.dispose();
    snippetExpander.dispose();
    usage.flush();
    clipboardHistory.flush();
    notesWindow.flushState();
    notesStore.unwatch();
    quicklinks.close();
    snippets.close();
    host.stop();
  });
  // A launcher lives in the tray; closing its window must not quit the app.
  app.on('window-all-closed', () => {});
}
