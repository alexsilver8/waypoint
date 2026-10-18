/** Contract between the main process and the Settings window. */
import type { CommandShortcutInfo } from './command-hotkeys';
import type { Quicklink, QuicklinkDraft } from './quicklinks';
import type { Settings } from './settings';
import type { Snippet, SnippetDraft, SnippetExpansionStatus } from './snippets';
import type { ExtensionSource, Platform } from './types';
import type { UpdateMode, UpdateStatus } from './updates';

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
  /** Every command, with its own shortcut and alias if it has them. */
  commands: CommandShortcutInfo[];
  quicklinks: readonly Quicklink[];
  snippets: readonly Snippet[];
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
    /** Whether snippets expand as you type in other apps, and if not, why. */
    snippetExpansion: SnippetExpansionStatus;
    updates: { mode: UpdateMode; status: UpdateStatus };
  };
}

export type SettingsLocation = 'settingsFile' | 'dataDirectory' | 'extensionsDirectory' | 'notesDirectory';

/** Where to take the Settings window when it opens: a section, and something to edit there. */
export interface SettingsTarget {
  /** A section's id, like "quicklinks". */
  section: string;
  /** The id of the quicklink or snippet to edit. */
  edit?: string;
  /** A command to give a shortcut (Set Shortcut… in the launcher), as `"<extension>/<command>"`. */
  command?: string;
  /** Give that command an alias instead (Set Alias… in the launcher). */
  alias?: boolean;
  /** Start a new one. */
  create?: boolean;
}

/** What saving a quicklink or snippet gives back: the new state, or why it wasn't saved. */
export interface SaveResult {
  state: SettingsState;
  error?: string;
}

/** An installed app, to open quicklinks with. */
export interface AppChoice {
  name: string;
  path: string;
}

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
  setCommandAlias: 'settings:set-command-alias',
  saveQuicklink: 'settings:save-quicklink',
  deleteQuicklink: 'settings:delete-quicklink',
  saveSnippet: 'settings:save-snippet',
  deleteSnippet: 'settings:delete-snippet',
  listApps: 'settings:list-apps',
  takeTarget: 'settings:take-target',
  openAccessibility: 'settings:open-accessibility',
  updateAction: 'settings:update-action',
  /** main → window: something changed; fetch the state again. */
  changed: 'settings:changed',
  /** main → window: the window was asked to go somewhere; `takeTarget()` says where. */
  navigate: 'settings:navigate',
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
  /** Checks for updates, opens the download, or restarts into the new version, as updates stand. */
  updateAction(): void;
  /** Opens first-launch setup again. */
  openOnboarding(): void;
  /** Gives a command its own shortcut, or none with `null`; on failure the old one stays and `error` says why. */
  setCommandHotkey(key: string, accelerator: string | null): Promise<{ state: SettingsState; error?: string }>;
  /** Gives a command an alias, or none with `null`; on failure the old one stays and `error` says why. */
  setCommandAlias(key: string, alias: string | null): Promise<{ state: SettingsState; error?: string }>;
  /** Adds a quicklink, or changes the one with the draft's `id`. */
  saveQuicklink(draft: QuicklinkDraft): Promise<SaveResult>;
  /** Removes a quicklink; `error` says why when it couldn't be. */
  deleteQuicklink(id: string): Promise<SaveResult>;
  /** Adds a snippet, or changes the one with the draft's `id`. */
  saveSnippet(draft: SnippetDraft): Promise<SaveResult>;
  /** Removes a snippet; `error` says why when it couldn't be. */
  deleteSnippet(id: string): Promise<SaveResult>;
  /** The installed apps, A to Z. */
  listApps(): Promise<AppChoice[]>;
  /** Asks macOS for Accessibility, which expanding snippets needs, and opens its page. */
  openAccessibility(): void;
  /** Where the window was last asked to go, once; `null` when nowhere in particular. */
  takeTarget(): Promise<SettingsTarget | null>;
  onChanged(listener: () => void): () => void;
  onNavigate(listener: () => void): () => void;
}
