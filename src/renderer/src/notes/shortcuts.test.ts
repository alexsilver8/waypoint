import { describe, expect, it } from 'vitest';
import { matchesShortcut, pinnedNoteNumber } from './shortcuts';

type Mods = Partial<Record<'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey', boolean>>;
const press = (key: string, code: string, mods: Mods = {}) => ({
  key,
  code,
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  ...mods,
});

describe('matchesShortcut', () => {
  it('matches ⌘ on macOS and Ctrl elsewhere, with exactly the modifiers asked for', () => {
    const browse = { key: 'p', modifiers: ['mod' as const] };
    expect(matchesShortcut(press('p', 'KeyP', { metaKey: true }), browse, 'darwin')).toBe(true);
    expect(matchesShortcut(press('p', 'KeyP', { ctrlKey: true }), browse, 'linux')).toBe(true);
    expect(matchesShortcut(press('P', 'KeyP', { metaKey: true, shiftKey: true }), browse, 'darwin')).toBe(false);
    expect(
      matchesShortcut(
        press('P', 'KeyP', { metaKey: true, shiftKey: true }),
        { ...browse, modifiers: ['mod', 'shift'] },
        'darwin',
      ),
    ).toBe(true);
  });

  it('knows ⌥⌘, on a Mac, where ⌥ turns the comma into ≤', () => {
    const formatBar = { key: ',', modifiers: ['mod' as const, 'alt' as const] };
    expect(matchesShortcut(press('≤', 'Comma', { metaKey: true, altKey: true }), formatBar, 'darwin')).toBe(true);
  });

  it('knows ⇧⌘/ though ⇧ makes the slash a question mark', () => {
    const autoResize = { key: '/', modifiers: ['mod' as const, 'shift' as const] };
    expect(matchesShortcut(press('?', 'Slash', { metaKey: true, shiftKey: true }), autoResize, 'darwin')).toBe(true);
  });

  it('leaves AltGr to type its character, though Windows reports it as Ctrl+Alt', () => {
    const formatBar = { key: ',', modifiers: ['mod' as const, 'alt' as const] };
    // AltGr+, types < on a Czech keyboard.
    const altGr = press('<', 'Comma', { ctrlKey: true, altKey: true });
    expect(matchesShortcut(altGr, formatBar, 'win32')).toBe(false);
    expect(matchesShortcut({ ...altGr, getModifierState: (key) => key === 'AltGraph' }, formatBar, 'linux')).toBe(
      false,
    );
    // Ctrl+Alt+, on a keyboard where it's still a comma.
    expect(matchesShortcut(press(',', 'Comma', { ctrlKey: true, altKey: true }), formatBar, 'win32')).toBe(true);
  });

  it('goes by the character typed when no modifier changes it', () => {
    // Dvorak: the key where QWERTY has N types B, so ⌘B is bold, not New Note.
    const newNote = { key: 'n', modifiers: ['mod' as const] };
    expect(matchesShortcut(press('b', 'KeyN', { metaKey: true }), newNote, 'darwin')).toBe(false);
  });

  it('matches Raycast’s ⌃X for Delete Note', () => {
    const remove = { key: 'x', modifiers: ['ctrl' as const] };
    expect(matchesShortcut(press('x', 'KeyX', { ctrlKey: true }), remove, 'darwin')).toBe(true);
    expect(matchesShortcut(press('x', 'KeyX', { metaKey: true }), remove, 'darwin')).toBe(false);
  });
});

describe('pinnedNoteNumber', () => {
  it('reads ⌘1–⌘9', () => {
    expect(pinnedNoteNumber(press('1', 'Digit1', { metaKey: true }), 'darwin')).toBe(1);
    expect(pinnedNoteNumber(press('9', 'Digit9', { ctrlKey: true }), 'win32')).toBe(9);
  });

  it('ignores other digits and modifiers', () => {
    expect(pinnedNoteNumber(press('0', 'Digit0', { metaKey: true }), 'darwin')).toBeUndefined();
    expect(pinnedNoteNumber(press('1', 'Digit1'), 'darwin')).toBeUndefined();
    expect(pinnedNoteNumber(press('!', 'Digit1', { metaKey: true, shiftKey: true }), 'darwin')).toBeUndefined();
    expect(pinnedNoteNumber(press('1', 'Digit1', { ctrlKey: true }), 'darwin')).toBeUndefined();
  });
});
