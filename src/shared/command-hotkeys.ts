/**
 * Shortcuts for single commands: which command a `commandHotkeys` entry, a `--command` argument or
 * a `waypoint://commands/…` link names, whether a shortcut is usable, and which shortcuts clash.
 */
import { DEEPLINK_SCHEME } from './notes';
import type { CommandRef, Icon, Platform } from './types';

/** Extension and command names: lowercase letters, digits and dashes (see extensions/validate.ts). */
const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** How settings, `--command` and links name a command: `"<extension>/<command>"`. */
export function commandKey(ref: CommandRef): string {
  return `${ref.extension}/${ref.command}`;
}

/** The command `"<extension>/<command>"` names, if it's spelled like one. */
export function commandRefFromKey(key: string): CommandRef | undefined {
  const [extension, command, ...rest] = key.trim().split('/');
  if (rest.length > 0 || !extension || !command || !NAME.test(extension) || !NAME.test(command)) return undefined;
  return { extension, command };
}

/** The id the root search gives a command, which usage is counted under. */
export function commandItemId(ref: CommandRef): string {
  return `command:${commandKey(ref)}`;
}

// ── Accelerators ────────────────────────────────────────────

const MODIFIERS: Record<string, 'command' | 'control' | 'mod' | 'alt' | 'altgr' | 'shift' | 'super'> = {
  command: 'command',
  cmd: 'command',
  control: 'control',
  ctrl: 'control',
  commandorcontrol: 'mod',
  cmdorctrl: 'mod',
  alt: 'alt',
  option: 'alt',
  altgr: 'altgr',
  shift: 'shift',
  super: 'super',
  meta: 'super',
};

const NAMED_KEYS = new Set([
  'plus',
  'space',
  'tab',
  'capslock',
  'numlock',
  'scrolllock',
  'backspace',
  'delete',
  'insert',
  'return',
  'enter',
  'up',
  'down',
  'left',
  'right',
  'home',
  'end',
  'pageup',
  'pagedown',
  'escape',
  'esc',
  'printscreen',
  'numdec',
  'numadd',
  'numsub',
  'nummult',
  'numdiv',
]);

/** Keys that are fine on their own, since nobody types with them. */
const STANDALONE = /^(f([1-9]|1[0-9]|2[0-4])|volume(up|down|mute)|media(nexttrack|previoustrack|stop|playpause))$/;

const KEY_ALIASES: Record<string, string> = { return: 'enter', esc: 'escape' };

function parseAccelerator(accelerator: string): { modifiers: Array<(typeof MODIFIERS)[string]>; key: string } | null {
  const parts = accelerator.trim().split('+');
  const keyPart = parts.pop()?.toLowerCase();
  if (!keyPart) return null;
  const modifiers = parts.map((part) => MODIFIERS[part.trim().toLowerCase()]);
  if (modifiers.some((modifier) => modifier === undefined)) return null;
  const key = KEY_ALIASES[keyPart] ?? keyPart;
  const known =
    /^[a-z0-9]$/.test(key) ||
    /^num[0-9]$/.test(key) ||
    /^[)!@#$%^&*(:;=<,_\->.?/~`{\][|\\}"']$/.test(key) ||
    NAMED_KEYS.has(key) ||
    STANDALONE.test(key);
  return known ? { modifiers: modifiers as Array<(typeof MODIFIERS)[string]>, key } : null;
}

/**
 * Whether `value` is an Electron accelerator a command can use: modifiers and one key, like
 * `"Alt+Shift+L"`. Like the recorder, it needs a modifier besides Shift, unless the key is a
 * function or media key, so it can't take over ordinary typing.
 */
export function isUsableAccelerator(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const parsed = parseAccelerator(value);
  if (!parsed) return false;
  if (STANDALONE.test(parsed.key)) return true;
  return parsed.modifiers.some((modifier) => modifier !== 'shift');
}

/**
 * One spelling for the keys an accelerator presses on `platform`, to tell whether two shortcuts
 * are the same: `"Shift+CmdOrCtrl+K"` and `"Control+Shift+k"` are both `"ctrl+shift+k"` off the Mac.
 */
export function canonicalAccelerator(accelerator: string, platform: Platform): string {
  const parsed = parseAccelerator(accelerator);
  if (!parsed) return accelerator.trim().toLowerCase();
  const mac = platform === 'darwin';
  const names = parsed.modifiers.map((modifier) => {
    switch (modifier) {
      case 'mod':
        return mac ? 'cmd' : 'ctrl';
      case 'command':
        return mac ? 'cmd' : 'super';
      case 'super':
        return mac ? 'cmd' : 'super';
      case 'control':
        return 'ctrl';
      default:
        return modifier;
    }
  });
  return [...[...new Set(names)].sort(), parsed.key].join('+');
}

// ── Settings ────────────────────────────────────────────────

/**
 * The `commandHotkeys` setting, keeping the entries that name a command and give it a usable
 * shortcut. An empty shortcut is how you'd clear one by hand, so it's dropped without a word.
 */
export function normalizeCommandHotkeys(raw: unknown, problems: string[]): Record<string, string> {
  const hotkeys: Record<string, string> = {};
  if (raw === undefined) return hotkeys;
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    problems.push('Ignoring invalid value for "commandHotkeys".');
    return hotkeys;
  }
  for (const [key, value] of Object.entries(raw)) {
    if (value === '' || value === null) continue;
    const ref = commandRefFromKey(key);
    if (!ref) {
      problems.push(`Ignoring "commandHotkeys.${key}": name a command as "<extension>/<command>".`);
    } else if (!isUsableAccelerator(value)) {
      problems.push(`Ignoring invalid shortcut for "commandHotkeys.${key}".`);
    } else {
      hotkeys[commandKey(ref)] = value.trim();
    }
  }
  return hotkeys;
}

// ── Clashes ─────────────────────────────────────────────────

export const LAUNCHER_CLASH = 'That’s the shortcut that opens Waypoint.';

export interface HotkeyPlanInput {
  /** The shortcuts set in settings, by command key, in the order they're written. */
  wanted: Readonly<Record<string, string>>;
  /** The commands there are on this computer, by key, with their titles. */
  commands: ReadonlyMap<string, string>;
  /** The launcher's shortcut, which comes first. */
  launcher: string | undefined;
  platform: Platform;
}

export interface HotkeyPlan {
  /** The shortcuts to register, by command key. */
  register: Map<string, string>;
  /** Why the others can't be used, by command key. Commands that aren't here are in neither. */
  problems: Map<string, string>;
}

/**
 * Sorts out which shortcuts can be used. The launcher's always wins; between two commands, the
 * one written first in settings keeps it and the other is told why it can't have it.
 */
export function planCommandHotkeys({ wanted, commands, launcher, platform }: HotkeyPlanInput): HotkeyPlan {
  const register = new Map<string, string>();
  const problems = new Map<string, string>();
  const taken = new Map<string, string>();
  if (launcher) taken.set(canonicalAccelerator(launcher, platform), '');
  for (const [key, accelerator] of Object.entries(wanted)) {
    const title = commands.get(key);
    if (title === undefined) continue;
    const keys = canonicalAccelerator(accelerator, platform);
    const holder = taken.get(keys);
    if (holder === '') problems.set(key, LAUNCHER_CLASH);
    else if (holder !== undefined) problems.set(key, `${holder} already uses it.`);
    else {
      taken.set(keys, title);
      register.set(key, accelerator);
    }
  }
  return { register, problems };
}

// ── Running a command from outside ──────────────────────────

const COMMANDS_HOST = 'commands';

/** A link that runs a command from anywhere: `waypoint://commands/<extension>/<command>`. */
export function commandDeeplink(ref: CommandRef): string {
  return `${DEEPLINK_SCHEME}://${COMMANDS_HOST}/${commandKey(ref)}`;
}

/** The command a `waypoint://commands/<extension>/<command>` link runs, if it is one. */
export function commandFromDeeplink(url: string): CommandRef | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  if (parsed.protocol !== `${DEEPLINK_SCHEME}:` || parsed.hostname !== COMMANDS_HOST) return undefined;
  return commandRefFromKey(parsed.pathname.replace(/^\/+|\/+$/g, ''));
}

/**
 * The command `--command <extension>/<command>` (or `--command=…`) asks for, if any. Not when a
 * `waypoint:` link is among the arguments: then the system started Waypoint to open a link, which
 * any web page can do, and the other arguments may have been smuggled in with it. The link is
 * opened instead, which asks before running anything.
 */
export function commandInArgv(argv: readonly string[] | undefined): CommandRef | undefined {
  if (!argv || argv.some((arg) => arg.toLowerCase().startsWith(`${DEEPLINK_SCHEME}:`))) return undefined;
  for (const [index, arg] of argv.entries()) {
    if (arg.startsWith('--command=')) return commandRefFromKey(arg.slice('--command='.length));
    if (arg === '--command') {
      const next = argv[index + 1];
      return next === undefined ? undefined : commandRefFromKey(next);
    }
  }
  return undefined;
}

/**
 * The arguments a second copy of the app was started with, as it sent them itself. Electron hands
 * over its own copy too, but it may reorder them, which would part `--command` from its value.
 */
export function launchArguments(argv: readonly string[] | undefined, additionalData: unknown): readonly string[] {
  const sent = (additionalData as { argv?: unknown } | null | undefined)?.argv;
  return Array.isArray(sent) && sent.every((arg) => typeof arg === 'string') ? sent : (argv ?? []);
}

// ── Settings window ─────────────────────────────────────────

/** A command as Settings → Extensions lists it, with its shortcut. */
export interface CommandShortcutInfo {
  /** `"<extension>/<command>"`. */
  key: string;
  title: string;
  icon?: Icon;
  extension: { name: string; title: string };
  /** The shortcut set for it, if any. */
  hotkey?: string;
  /** Why that shortcut isn't working. */
  error?: string;
}
