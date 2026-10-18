import type { Platform, Shortcut } from '../../shared/types';

interface KeyEventLike {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

/** ⌘ on macOS, Ctrl elsewhere. */
export function isModKey(event: KeyEventLike, platform: Platform): boolean {
  return platform === 'darwin' ? event.metaKey : event.ctrlKey;
}

/** ⌘[ (Ctrl+[ on Windows and Linux): back one step from any view, a form's fields too, as in a browser. */
export function isBackKey(event: KeyEventLike, platform: Platform): boolean {
  return isModKey(event, platform) && !event.shiftKey && event.key === '[';
}

/** ⌘C (Ctrl+C on Windows and Linux). */
export function isCopyKey(event: KeyEventLike, platform: Platform): boolean {
  return isModKey(event, platform) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'c';
}

export function matchesShortcut(event: KeyEventLike, shortcut: Shortcut, platform: Platform): boolean {
  const modifiers = new Set(shortcut.modifiers ?? []);
  const mac = platform === 'darwin';
  const wantMeta = mac && modifiers.has('mod');
  const wantCtrl = (!mac && modifiers.has('mod')) || modifiers.has('ctrl');
  return (
    event.key.toLowerCase() === shortcut.key.toLowerCase() &&
    event.metaKey === wantMeta &&
    event.ctrlKey === wantCtrl &&
    event.shiftKey === modifiers.has('shift') &&
    event.altKey === modifiers.has('alt')
  );
}

const MAC_KEYS: Record<string, string> = {
  backspace: '⌫',
  delete: '⌦',
  enter: '↵',
  escape: 'esc',
  arrowup: '↑',
  arrowdown: '↓',
  arrowleft: '←',
  arrowright: '→',
  tab: '⇥',
  ' ': 'Space',
};
const OTHER_KEYS: Record<string, string> = {
  ...MAC_KEYS,
  backspace: 'Backspace',
  delete: 'Del',
  enter: 'Enter',
  tab: 'Tab',
};

/** The keycaps to draw for a shortcut, e.g. ["⌘", "⇧", "⌫"] or ["Ctrl", "Shift", "Backspace"]. */
export function shortcutKeys(shortcut: Shortcut, platform: Platform): string[] {
  const mac = platform === 'darwin';
  const modifiers = shortcut.modifiers ?? [];
  const order: Array<NonNullable<Shortcut['modifiers']>[number]> = ['ctrl', 'alt', 'shift', 'mod'];
  const labels = mac
    ? { ctrl: '⌃', alt: '⌥', shift: '⇧', mod: '⌘' }
    : { ctrl: 'Ctrl', alt: 'Alt', shift: 'Shift', mod: 'Ctrl' };
  const caps = [...new Set(order.filter((m) => modifiers.includes(m)).map((m) => labels[m]))];
  const key = shortcut.key.toLowerCase();
  caps.push(
    (mac ? MAC_KEYS : OTHER_KEYS)[key] ?? (shortcut.key.length === 1 ? shortcut.key.toUpperCase() : shortcut.key),
  );
  return caps;
}
