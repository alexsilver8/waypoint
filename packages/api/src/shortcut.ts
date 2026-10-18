import type { Shortcut } from './types';

/** A modifier key. `mod` is ⌘ on macOS and Ctrl on Windows and Linux. */
export type Modifier = NonNullable<Shortcut['modifiers']>[number];

/**
 * A shortcut, or its keys joined with `+`: `'mod+shift+c'`, `'mod+Backspace'`, `'ctrl+space'`.
 * The last part is the key, named as in `KeyboardEvent.key`; case doesn't matter.
 */
export type ShortcutInput = Shortcut | string;

const MODIFIERS = new Map<string, Modifier>([
  ['mod', 'mod'],
  ['cmd', 'mod'],
  ['command', 'mod'],
  ['shift', 'shift'],
  ['alt', 'alt'],
  ['option', 'alt'],
  ['ctrl', 'ctrl'],
  ['control', 'ctrl'],
]);

/**
 * A keyboard shortcut for an action, from its keys: `shortcut('mod+shift+c')` is
 * `{ key: 'c', modifiers: ['mod', 'shift'] }`. `mod` (or `cmd`) is ⌘ on macOS and Ctrl
 * elsewhere; `alt` (or `option`), `shift` and `ctrl` are the others. Write `space` for the
 * space bar and `mod++` for the plus key. A shortcut object is returned as a copy.
 */
export function shortcut(input: ShortcutInput): Shortcut {
  if (typeof input !== 'string') {
    const modifiers = input.modifiers ?? [];
    return modifiers.length > 0 ? { key: input.key, modifiers: [...modifiers] } : { key: input.key };
  }
  const plus = input === '+' || input.endsWith('++');
  const parts = input === '+' ? [] : (plus ? input.slice(0, -2) : input).split('+');
  const key = plus ? '+' : parts.pop()?.trim();
  if (!key) throw new TypeError(`The shortcut "${input}" has no key: write it like "mod+shift+c".`);
  const modifiers: Modifier[] = [];
  for (const part of parts) {
    const modifier = MODIFIERS.get(part.trim().toLowerCase());
    if (!modifier) {
      throw new TypeError(`"${part}" in the shortcut "${input}" isn't a modifier: use mod, shift, alt or ctrl.`);
    }
    if (!modifiers.includes(modifier)) modifiers.push(modifier);
  }
  const named = key.toLowerCase() === 'space' ? ' ' : key;
  return modifiers.length > 0 ? { key: named, modifiers } : { key: named };
}
