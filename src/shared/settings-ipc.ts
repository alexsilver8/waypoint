/** Contract between the main process and the Settings window. */
import type { CommandShortcutInfo } from './command-hotkeys';
import type { Settings } from './settings';
import type { ExtensionSource, Platform } from './types';

export interface ExtensionSummary {
  name: string;
  title: string;
  source: ExtensionSource;
  /** Folder of an extension that isn't compiled in. */
  dir?: string;
  /** Why it failed to load. */
  error?: string;
  commands: number;
}

/** Everything the Settings window shows. */
export interface SettingsState {
  settings: Settings;
  /** The shortcut that actually works right now (may differ from `settings.hotkey` if that one failed). */
  activeHotkey?: string;
  extensions: ExtensionSummary[];
  /** Every command, with its own shortcut if it has one. */
  commands: CommandShortcutInfo[];
  info: {
    version: string;
    electron: string;
    node: string;
    platform: Platform;
    settingsFile: string;
    dataDirectory: string;
    extensionsDirectory: string;
    /** `settings.notesDirectory` resolved, or the default. */
    notesDirectory: string;
    clipboardEntries: number;
    /** Only the installed app can open at login, not a copy run from source. */
    canLaunchAtLogin: boolean;
    /** Running the installed app, rather than from source. */
    packaged: boolean;
  };
}

export type SettingsLocation = 'settingsFile' | 'dataDirectory' | 'extensionsDirectory' | 'notesDirectory';

export const SettingsChannel = {
  get: 'settings:get',
  update: 'settings:update',
  setHotkey: 'settings:set-hotkey',
  pauseHotkey: 'settings:pause-hotkey',
  chooseFolder: 'settings:choose-folder',
  open: 'settings:open',
  openLink: 'settings:open-link',
  reloadExtensions: 'settings:reload-extensions',
  clearClipboard: 'settings:clear-clipboard',
  openOnboarding: 'settings:open-onboarding',
  setCommandHotkey: 'settings:set-command-hotkey',
  takeReveal: 'settings:take-reveal',
  /** main → window: there's a command to show (Set Shortcut… in the launcher); take it. */
  reveal: 'settings:reveal',
  /** main → window: something changed; fetch the state again. */
  changed: 'settings:changed',
} as const;

/** Links the Settings window may open. */
export const SETTINGS_LINKS = {
  repository: 'https://github.com/alexsilver8/waypoint',
  issues: 'https://github.com/alexsilver8/waypoint/issues/new/choose',
  extensionDocs: 'https://github.com/alexsilver8/waypoint/blob/main/docs/extensions.md',
} as const;

export type SettingsLink = keyof typeof SETTINGS_LINKS;

/** What the Settings window's preload exposes as `window.settings`. */
export interface SettingsApi {
  platform: Platform;
  get(): Promise<SettingsState>;
  update(patch: Partial<Settings>): Promise<SettingsState>;
  /** Tries the shortcut; on failure the previous one stays and `error` says why. */
  setHotkey(accelerator: string): Promise<{ state: SettingsState; error?: string }>;
  /** Stops the current shortcut from firing while a new one is being recorded. */
  pauseHotkey(paused: boolean): void;
  chooseFolder(title: string): Promise<string | null>;
  open(location: SettingsLocation): void;
  openLink(link: SettingsLink): void;
  reloadExtensions(): Promise<SettingsState>;
  clearClipboard(): Promise<SettingsState>;
  /** Opens first-launch setup again. */
  openOnboarding(): void;
  /** Gives a command its own shortcut, or none with `null`; on failure the old one stays and `error` says why. */
  setCommandHotkey(key: string, accelerator: string | null): Promise<{ state: SettingsState; error?: string }>;
  /** The command Settings was opened to give a shortcut, once; `null` when there's none. */
  takeReveal(): Promise<string | null>;
  onReveal(listener: () => void): () => void;
  onChanged(listener: () => void): () => void;
}
