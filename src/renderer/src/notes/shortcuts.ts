import type { Platform, Shortcut } from '../../../shared/types';

interface KeyEventLike {
  key: string;
  code: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

/** Keys by where they are on the keyboard, for when ⌥ or ⇧ changes the character typed. */
const CODE_KEYS: Record<string, string> = {
  BracketLeft: '[',
  BracketRight: ']',
  Comma: ',',
  Period: '.',
  Slash: '/',
  Equal: '=',
  Minus: '-',
  Backquote: '`',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
};

/**
 * What a key press could mean: the character it typed and, when ⌥ or ⇧ may have changed that
 * character (⌥, on a Mac is ≤, ⇧/ is ?), the key it was on.
 */
function pressedKeys(event: KeyEventLike): string[] {
  const keys = [event.key.toLowerCase()];
  if (!event.altKey && !event.shiftKey) return keys;
  const { code } = event;
  if (/^Key[A-Z]$/.test(code)) keys.push(code.slice(3).toLowerCase());
  else if (/^Digit\d$/.test(code)) keys.push(code.slice(5));
  else if (CODE_KEYS[code]) keys.push(CODE_KEYS[code] as string);
  return keys;
}

/**
 * Whether a key press is a shortcut, with exactly its modifiers: ⌘ on macOS and Ctrl elsewhere
 * for `mod`. ⌥⌘, still matches on a Mac, where ⌥ turns the comma into another character.
 */
export function matchesShortcut(event: KeyEventLike, shortcut: Shortcut, platform: Platform): boolean {
  const modifiers = new Set(shortcut.modifiers ?? []);
  const mac = platform === 'darwin';
  const meta = mac && modifiers.has('mod');
  const ctrl = (!mac && modifiers.has('mod')) || modifiers.has('ctrl');
  if (event.metaKey !== meta || event.ctrlKey !== ctrl) return false;
  if (event.altKey !== modifiers.has('alt') || event.shiftKey !== modifiers.has('shift')) return false;
  return pressedKeys(event).includes(shortcut.key.toLowerCase());
}

/** The digit of ⌘1–⌘9 (Ctrl elsewhere), with no other modifier, or undefined. */
export function pinnedNoteNumber(event: KeyEventLike, platform: Platform): number | undefined {
  const mac = platform === 'darwin';
  if ((mac ? !event.metaKey || event.ctrlKey : !event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) {
    return undefined;
  }
  const digit = /^Digit([1-9])$/.exec(event.code)?.[1] ?? /^[1-9]$/.exec(event.key)?.[0];
  return digit ? Number(digit) : undefined;
}
