/** Turning key presses into Electron accelerators ("Alt+Space") and back into keycaps. */
import type { Platform } from '../../shared/types';

interface KeyPress {
  code: string;
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

const CODE_TO_KEY: Record<string, string> = {
  Space: 'Space',
  Enter: 'Enter',
  Tab: 'Tab',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Insert: 'Insert',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Comma: ',',
  Period: '.',
  Slash: '/',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  BracketLeft: '[',
  BracketRight: ']',
  Minus: '-',
  Equal: '=',
  Backquote: '`',
};

const MODIFIER_CODES = /^(Meta|OS|Control|Alt|Shift)(Left|Right)?$/;

/** The key part of an accelerator, from the physical key, so ⌥K doesn't become "˚". */
function keyName(code: string): string | undefined {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) return code;
  return CODE_TO_KEY[code];
}

/** The modifiers held during a key event, in accelerator order. */
export function heldModifiers(event: Omit<KeyPress, 'code' | 'key'>, platform: Platform): string[] {
  const modifiers: string[] = [];
  if (event.ctrlKey) modifiers.push('Control');
  if (event.altKey) modifiers.push('Alt');
  if (event.shiftKey) modifiers.push('Shift');
  if (event.metaKey) modifiers.push(platform === 'darwin' ? 'Command' : 'Super');
  return modifiers;
}

export type RecordResult =
  /** Still holding modifiers only; keep listening. */
  | { kind: 'pending'; modifiers: string[] }
  | { kind: 'done'; accelerator: string }
  | { kind: 'invalid'; reason: string };

/**
 * Builds an accelerator from a key press. A shortcut needs at least one modifier, except
 * for function keys, so it can't swallow ordinary typing.
 */
export function acceleratorFromKeyPress(event: KeyPress, platform: Platform): RecordResult {
  const modifiers = heldModifiers(event, platform);

  if (MODIFIER_CODES.test(event.code)) return { kind: 'pending', modifiers };
  const key = keyName(event.code);
  if (!key) return { kind: 'invalid', reason: `${event.key || event.code} can’t be used in a shortcut.` };
  const isFunctionKey = /^F\d+$/.test(key);
  if (modifiers.length === 0 && !isFunctionKey) {
    return { kind: 'invalid', reason: 'Add a modifier, like ⌥, ⌃ or ⌘.' };
  }
  if (modifiers.length === 1 && modifiers[0] === 'Shift' && !isFunctionKey) {
    return { kind: 'invalid', reason: 'Shift alone would get in the way of typing; add another modifier.' };
  }
  return { kind: 'done', accelerator: [...modifiers, key].join('+') };
}

const MAC_LABELS: Record<string, string> = {
  command: '⌘',
  cmd: '⌘',
  commandorcontrol: '⌘',
  cmdorctrl: '⌘',
  control: '⌃',
  ctrl: '⌃',
  alt: '⌥',
  option: '⌥',
  altgr: '⌥',
  shift: '⇧',
  super: '⌘',
  meta: '⌘',
  enter: '↵',
  return: '↵',
  backspace: '⌫',
  delete: '⌦',
  up: '↑',
  down: '↓',
  left: '←',
  right: '→',
  tab: '⇥',
  escape: 'esc',
  esc: 'esc',
};

const OTHER_LABELS: Record<string, string> = {
  command: 'Super',
  cmd: 'Super',
  commandorcontrol: 'Ctrl',
  cmdorctrl: 'Ctrl',
  control: 'Ctrl',
  ctrl: 'Ctrl',
  alt: 'Alt',
  option: 'Alt',
  altgr: 'AltGr',
  shift: 'Shift',
  super: 'Super',
  meta: 'Super',
  up: '↑',
  down: '↓',
  left: '←',
  right: '→',
  escape: 'Esc',
};

/** The keycaps to draw for an accelerator: "Alt+Space" → ["⌥", "Space"] on macOS. */
export function acceleratorKeys(accelerator: string, platform: Platform): string[] {
  const labels = platform === 'darwin' ? MAC_LABELS : OTHER_LABELS;
  // "Plus" is how accelerators spell the + key.
  return accelerator
    .split('+')
    .filter(Boolean)
    .map((part) => (part === 'Plus' ? '+' : (labels[part.toLowerCase()] ?? part)));
}

/** Whether two accelerators press the same keys, however they spell and order them. */
export function sameShortcut(a: string, b: string, platform: Platform): boolean {
  const keys = (accelerator: string) =>
    acceleratorKeys(accelerator, platform)
      .map((key) => key.toLowerCase())
      .sort()
      .join('+');
  return keys(a) === keys(b);
}
