import { describe, expect, it } from 'vitest';
import { shortcut } from './shortcut';

describe('shortcut', () => {
  it('reads modifiers and a key joined with +', () => {
    expect(shortcut('mod+shift+c')).toEqual({ key: 'c', modifiers: ['mod', 'shift'] });
    expect(shortcut('ctrl+alt+Delete')).toEqual({ key: 'Delete', modifiers: ['ctrl', 'alt'] });
  });

  it('takes a key on its own', () => {
    expect(shortcut('Backspace')).toEqual({ key: 'Backspace' });
    expect(shortcut('F5')).toEqual({ key: 'F5' });
  });

  it('ignores case and spaces in modifiers, and keeps the key as written', () => {
    expect(shortcut('Mod + Shift + K')).toEqual({ key: 'K', modifiers: ['mod', 'shift'] });
  });

  it('knows the other names of modifiers', () => {
    expect(shortcut('cmd+option+control+x')).toEqual({ key: 'x', modifiers: ['mod', 'alt', 'ctrl'] });
    expect(shortcut('command+k')).toEqual({ key: 'k', modifiers: ['mod'] });
  });

  it('lists each modifier once', () => {
    expect(shortcut('mod+cmd+r')).toEqual({ key: 'r', modifiers: ['mod'] });
  });

  it('writes the space bar as space, and the plus key as +', () => {
    expect(shortcut('ctrl+space')).toEqual({ key: ' ', modifiers: ['ctrl'] });
    expect(shortcut('mod++')).toEqual({ key: '+', modifiers: ['mod'] });
    expect(shortcut('+')).toEqual({ key: '+' });
  });

  it('copies a shortcut object', () => {
    const modifiers: Array<'mod' | 'shift'> = ['mod', 'shift'];
    const copy = shortcut({ key: 'c', modifiers });
    expect(copy).toEqual({ key: 'c', modifiers: ['mod', 'shift'] });
    expect(copy.modifiers).not.toBe(modifiers);
    expect(shortcut({ key: 'r', modifiers: [] })).toEqual({ key: 'r' });
  });

  it('says what is wrong with a shortcut it cannot read', () => {
    expect(() => shortcut('')).toThrow('has no key');
    expect(() => shortcut('mod+')).toThrow('has no key');
    expect(() => shortcut('hyper+k')).toThrow('"hyper" in the shortcut "hyper+k" isn\'t a modifier');
    expect(() => shortcut('toString+k')).toThrow("isn't a modifier");
  });
});
