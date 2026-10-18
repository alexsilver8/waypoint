import { describe, expect, it } from 'vitest';
import { type KeyPress, keyEffect, keywordAtEnd, TypedKeys } from './typed-keys';

const key = (keycode: number, modifiers: Partial<KeyPress> = {}): KeyPress => ({
  keycode,
  shiftKey: false,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  ...modifiers,
});

/** The keys for `text` on a US keyboard, for the characters these tests use. */
function keys(text: string): KeyPress[] {
  const codes: Record<string, [number, boolean]> = {
    '!': [2, true],
    ';': [39, false],
    ' ': [57, false],
    '1': [2, false],
  };
  for (const [row, first] of [
    ['qwertyuiop', 16],
    ['asdfghjkl', 30],
    ['zxcvbnm', 44],
  ] as const) {
    [...row].forEach((letter, index) => {
      codes[letter] = [first + index, false];
      codes[letter.toUpperCase()] = [first + index, true];
    });
  }
  return [...text].map((character) => {
    const code = codes[character];
    if (!code) throw new Error(`No key for ${character}`);
    return key(code[0], { shiftKey: code[1] });
  });
}

function typed(text: string, length = 20): TypedKeys {
  const result = new TypedKeys(length);
  for (const press of keys(text)) result.press(press);
  return result;
}

describe('keyEffect', () => {
  it('reads letters, digits and punctuation as on a US keyboard, with Shift', () => {
    expect(keyEffect(key(30))).toEqual({ character: 'a' });
    expect(keyEffect(key(30, { shiftKey: true }))).toEqual({ character: 'A' });
    expect(keyEffect(key(2, { shiftKey: true }))).toEqual({ character: '!' });
    expect(keyEffect(key(53))).toEqual({ character: '/' });
    expect(keyEffect(key(57))).toEqual({ character: ' ' });
  });

  it('lets modifiers alone pass, and starts over after a shortcut or a key that moves on', () => {
    expect(keyEffect(key(42, { shiftKey: true }))).toBe('none');
    expect(keyEffect(key(3675, { metaKey: true }))).toBe('none');
    expect(keyEffect(key(47, { metaKey: true }))).toBe('reset');
    expect(keyEffect(key(30, { altKey: true }))).toBe('reset');
    expect(keyEffect(key(28))).toBe('reset');
    expect(keyEffect(key(57419))).toBe('reset');
  });

  it('erases with Backspace', () => {
    expect(keyEffect(key(14))).toBe('erase');
  });
});

describe('TypedKeys', () => {
  it('keeps what was typed, minus what was erased', () => {
    const text = typed('!sigg');
    text.press(key(14));
    expect(text.text).toBe('!sig');
  });

  it('keeps only the last few characters', () => {
    expect(typed('hello there', 5).text).toBe('there');
  });

  it('starts over after Enter or a shortcut', () => {
    const text = typed('hello');
    text.press(key(28));
    expect(text.text).toBe('');
    for (const press of keys('ab')) text.press(press);
    text.press(key(47, { ctrlKey: true }));
    expect(text.text).toBe('');
  });
});

describe('keywordAtEnd', () => {
  it('finds a keyword that was just typed, in any letter case', () => {
    expect(keywordAtEnd('hi !sig', ['!sig', '!email'])).toBe('!sig');
    expect(keywordAtEnd('!SIG', ['!sig'])).toBe('!sig');
    expect(keywordAtEnd('!si', ['!sig'])).toBeUndefined();
  });

  it('only counts a keyword starting with a letter at the start of a word', () => {
    expect(keywordAtEnd('sig', ['sig'])).toBe('sig');
    expect(keywordAtEnd('my sig', ['sig'])).toBe('sig');
    expect(keywordAtEnd('design', ['sig'])).toBeUndefined();
    expect(keywordAtEnd('hello!sig', ['!sig'])).toBe('!sig');
  });

  it('takes the longer of two keywords that both end the text', () => {
    expect(keywordAtEnd(';sig', ['sig', ';sig'])).toBe(';sig');
    expect(keywordAtEnd(';sig', [';sig', 'sig'])).toBe(';sig');
  });

  it('works with what TypedKeys reads', () => {
    expect(keywordAtEnd(typed('Thanks !SIG').text, ['!sig'])).toBe('!sig');
  });
});
