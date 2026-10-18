/**
 * What was just typed, from the keys the system-wide hook sees, and whether it ends in a
 * snippet's keyword. The hook reports keys by where they are on the keyboard, not by the
 * character the layout gives them, so they're read as on a US keyboard.
 */

/** A key going down, as the hook reports it. */
export interface KeyPress {
  keycode: number;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
}

/** The characters of the keys that type one, unshifted and shifted, by keycode (uiohook's, from scan codes). */
const CHARACTERS: Record<number, readonly [string, string]> = {
  2: ['1', '!'],
  3: ['2', '@'],
  4: ['3', '#'],
  5: ['4', '$'],
  6: ['5', '%'],
  7: ['6', '^'],
  8: ['7', '&'],
  9: ['8', '*'],
  10: ['9', '('],
  11: ['0', ')'],
  12: ['-', '_'],
  13: ['=', '+'],
  26: ['[', '{'],
  27: [']', '}'],
  39: [';', ':'],
  40: ["'", '"'],
  41: ['`', '~'],
  43: ['\\', '|'],
  51: [',', '<'],
  52: ['.', '>'],
  53: ['/', '?'],
  57: [' ', ' '],
  55: ['*', '*'],
  74: ['-', '-'],
  78: ['+', '+'],
  3637: ['/', '/'],
};
for (const [row, first] of [
  ['qwertyuiop', 16],
  ['asdfghjkl', 30],
  ['zxcvbnm', 44],
] as const) {
  [...row].forEach((letter, index) => {
    CHARACTERS[first + index] = [letter, letter.toUpperCase()];
  });
}

const BACKSPACE = 14;
/** Shift, Ctrl, Alt, Meta (left and right) and Caps Lock: on their own they type nothing. */
const MODIFIERS = new Set([42, 54, 29, 3613, 56, 3640, 3675, 3676, 58]);

/** The character a key types, or what it does to the text instead. */
export function keyEffect(key: KeyPress): { character: string } | 'erase' | 'none' | 'reset' {
  if (MODIFIERS.has(key.keycode)) return 'none';
  // A shortcut, or a character this can't read (Option and AltGr ones): where the text
  // stands afterwards is anyone's guess.
  if (key.ctrlKey || key.metaKey || key.altKey) return 'reset';
  if (key.keycode === BACKSPACE) return 'erase';
  const characters = CHARACTERS[key.keycode];
  // Enter, Tab, the arrows and the like move on from what was typed.
  if (!characters) return 'reset';
  return { character: characters[key.shiftKey ? 1 : 0] };
}

/** The last few characters typed, as the hook saw them. */
export class TypedKeys {
  private typed = '';

  /** `length`: how many characters to keep, enough for the longest keyword and one before it. */
  constructor(private readonly length: number) {}

  get text(): string {
    return this.typed;
  }

  press(key: KeyPress): void {
    const effect = keyEffect(key);
    if (effect === 'none') return;
    if (effect === 'reset') this.reset();
    else if (effect === 'erase') this.typed = this.typed.slice(0, -1);
    else this.typed = (this.typed + effect.character).slice(-this.length);
  }

  reset(): void {
    this.typed = '';
  }
}

const WORD_CHARACTER = /[\p{L}\p{N}]/u;

/**
 * The keyword `text` ends with, in any letter case. One that starts with a letter or digit only
 * counts at the start of a word, so `sig` expands in "my sig" but not in "design"; one that
 * starts with punctuation, like `!sig`, counts anywhere.
 */
export function keywordAtEnd(text: string, keywords: readonly string[]): string | undefined {
  const typed = text.toLowerCase();
  let found: string | undefined;
  for (const keyword of keywords) {
    if (!keyword || !typed.endsWith(keyword.toLowerCase())) continue;
    const before = typed.at(-keyword.length - 1);
    if (WORD_CHARACTER.test(keyword[0] ?? '') && before !== undefined && WORD_CHARACTER.test(before)) continue;
    // `;sig` typed ends with `sig` too: the longer keyword is what was meant.
    if (!found || keyword.length > found.length) found = keyword;
  }
  return found;
}
