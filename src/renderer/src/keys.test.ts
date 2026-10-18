import { describe, expect, it } from 'vitest';
import { isBackKey, isCopyKey, matchesShortcut, shortcutKeys } from './keys';

const event = (key: string, mods: Partial<Record<'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey', boolean>> = {}) => ({
  key,
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  ...mods,
});

describe('matchesShortcut', () => {
  const deleteShortcut = { key: 'Backspace', modifiers: ['mod' as const] };

  it('maps mod to ⌘ on macOS and Ctrl elsewhere', () => {
    expect(matchesShortcut(event('Backspace', { metaKey: true }), deleteShortcut, 'darwin')).toBe(true);
    expect(matchesShortcut(event('Backspace', { ctrlKey: true }), deleteShortcut, 'darwin')).toBe(false);
    expect(matchesShortcut(event('Backspace', { ctrlKey: true }), deleteShortcut, 'win32')).toBe(true);
  });

  it('requires the exact modifiers', () => {
    expect(matchesShortcut(event('Backspace', { metaKey: true, shiftKey: true }), deleteShortcut, 'darwin')).toBe(
      false,
    );
    expect(matchesShortcut(event('Backspace'), deleteShortcut, 'darwin')).toBe(false);
  });

  it('ignores letter case', () => {
    expect(
      matchesShortcut(
        event('R', { metaKey: true, shiftKey: true }),
        { key: 'r', modifiers: ['mod', 'shift'] },
        'darwin',
      ),
    ).toBe(true);
  });
});

describe('isBackKey', () => {
  it('is ⌘[ on macOS and Ctrl+[ elsewhere', () => {
    expect(isBackKey(event('[', { metaKey: true }), 'darwin')).toBe(true);
    expect(isBackKey(event('[', { ctrlKey: true }), 'darwin')).toBe(false);
    expect(isBackKey(event('[', { ctrlKey: true }), 'linux')).toBe(true);
    expect(isBackKey(event('[', { ctrlKey: true, shiftKey: true }), 'win32')).toBe(false);
    expect(isBackKey(event('['), 'win32')).toBe(false);
  });
});

describe('isCopyKey', () => {
  it('is ⌘C on macOS and Ctrl+C elsewhere, and nothing more', () => {
    expect(isCopyKey(event('c', { metaKey: true }), 'darwin')).toBe(true);
    expect(isCopyKey(event('C', { ctrlKey: true }), 'win32')).toBe(true);
    expect(isCopyKey(event('c', { ctrlKey: true }), 'darwin')).toBe(false);
    expect(isCopyKey(event('c', { metaKey: true, shiftKey: true }), 'darwin')).toBe(false);
  });
});

describe('shortcutKeys', () => {
  it('uses symbols on macOS and words elsewhere', () => {
    const shortcut = { key: 'Backspace', modifiers: ['mod' as const, 'shift' as const] };
    expect(shortcutKeys(shortcut, 'darwin')).toEqual(['⇧', '⌘', '⌫']);
    expect(shortcutKeys(shortcut, 'linux')).toEqual(['Shift', 'Ctrl', 'Backspace']);
    expect(shortcutKeys({ key: 'k', modifiers: ['mod'] }, 'win32')).toEqual(['Ctrl', 'K']);
  });
});
