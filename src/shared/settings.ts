import { normalizeCommandHotkeys } from './command-hotkeys';

/** User settings, stored as JSON in the app's data folder and editable by hand. */
export interface Settings {
  /** Global shortcut that toggles the launcher, as an Electron accelerator. */
  hotkey: string;
  /** Hide the launcher when it loses focus. */
  hideOnBlur: boolean;
  /** Start Waypoint in the tray when you log in (the installed app, on every system). */
  launchAtLogin: boolean;
  theme: 'system' | 'light' | 'dark';
  clipboardHistory: {
    enabled: boolean;
    /** How many entries to keep. */
    maxItems: number;
  };
  /** Extra folders to load extensions from: an extension folder, or a folder of them. */
  extensionDirectories: string[];
  /** Where notes are kept, one Markdown file each. Empty means the app's data folder. */
  notesDirectory: string;
  /** Paste actions (emoji, gitmoji, commit messages) type into the app you were in; off, they copy. */
  pasteIntoApps: boolean;
  /** Type a snippet's keyword in any app to replace it with the snippet. Off until turned on. */
  snippetExpansion: boolean;
  /** A global shortcut for any command, as an Electron accelerator, by `"<extension>/<command>"`. */
  commandHotkeys: Record<string, string>;
  /** Look for new versions every few hours (the installed app). */
  checkForUpdates: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  hotkey: 'Alt+Space',
  hideOnBlur: true,
  launchAtLogin: false,
  theme: 'system',
  clipboardHistory: { enabled: true, maxItems: 200 },
  extensionDirectories: [],
  notesDirectory: '',
  pasteIntoApps: true,
  snippetExpansion: false,
  commandHotkeys: {},
  checkForUpdates: true,
};

export interface NormalizedSettings {
  settings: Settings;
  /** Human-readable notes about values that were invalid and replaced by defaults. */
  problems: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Merges whatever was read from disk over the defaults, dropping values of the wrong type. */
export function normalizeSettings(raw: unknown): NormalizedSettings {
  const problems: string[] = [];
  const settings: Settings = structuredClone(DEFAULT_SETTINGS);
  if (raw === undefined) return { settings, problems };
  if (!isRecord(raw)) return { settings, problems: ['Settings must be a JSON object; using defaults.'] };

  const take = <T>(key: string, value: unknown, valid: (v: unknown) => v is T, apply: (v: T) => void) => {
    if (value === undefined) return;
    if (valid(value)) apply(value);
    else problems.push(`Ignoring invalid value for "${key}".`);
  };
  const isString = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
  const isBoolean = (v: unknown): v is boolean => typeof v === 'boolean';

  take('hotkey', raw.hotkey, isString, (v) => {
    settings.hotkey = v.trim();
  });
  take('hideOnBlur', raw.hideOnBlur, isBoolean, (v) => {
    settings.hideOnBlur = v;
  });
  take('launchAtLogin', raw.launchAtLogin, isBoolean, (v) => {
    settings.launchAtLogin = v;
  });
  take('pasteIntoApps', raw.pasteIntoApps, isBoolean, (v) => {
    settings.pasteIntoApps = v;
  });
  take('snippetExpansion', raw.snippetExpansion, isBoolean, (v) => {
    settings.snippetExpansion = v;
  });
  take('checkForUpdates', raw.checkForUpdates, isBoolean, (v) => {
    settings.checkForUpdates = v;
  });
  take(
    'theme',
    raw.theme,
    (v): v is Settings['theme'] => v === 'system' || v === 'light' || v === 'dark',
    (v) => {
      settings.theme = v;
    },
  );
  take('clipboardHistory', raw.clipboardHistory, isRecord, (v) => {
    take('clipboardHistory.enabled', v.enabled, isBoolean, (enabled) => {
      settings.clipboardHistory.enabled = enabled;
    });
    take(
      'clipboardHistory.maxItems',
      v.maxItems,
      (n): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= 10_000,
      (maxItems) => {
        settings.clipboardHistory.maxItems = maxItems;
      },
    );
  });
  take(
    'extensionDirectories',
    raw.extensionDirectories,
    (v): v is string[] => Array.isArray(v) && v.every(isString),
    (v) => {
      settings.extensionDirectories = v;
    },
  );

  take(
    'notesDirectory',
    raw.notesDirectory,
    (v): v is string => typeof v === 'string',
    (v) => {
      settings.notesDirectory = v.trim();
    },
  );
  settings.commandHotkeys = normalizeCommandHotkeys(raw.commandHotkeys, problems);

  return { settings, problems };
}
