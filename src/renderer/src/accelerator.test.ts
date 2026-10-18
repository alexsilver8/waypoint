import { describe, expect, it } from 'vitest';
import { acceleratorFromKeyPress, acceleratorKeys, sameShortcut } from './accelerator';

const press = (
  code: string,
  mods: Partial<Record<'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey', boolean>> = {},
  key = '',
) => ({
  code,
  key,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...mods,
});

describe('acceleratorFromKeyPress', () => {
  it('builds accelerators from the physical key', () => {
    expect(acceleratorFromKeyPress(press('Space', { altKey: true }), 'darwin')).toEqual({
      kind: 'done',
      accelerator: 'Alt+Space',
    });
    // ⌥K types "˚" on a Mac; the shortcut is still Alt+K.
    expect(acceleratorFromKeyPress(press('KeyK', { altKey: true }, '˚'), 'darwin')).toEqual({
      kind: 'done',
      accelerator: 'Alt+K',
    });
    expect(acceleratorFromKeyPress(press('Digit1', { ctrlKey: true, shiftKey: true }), 'linux')).toEqual({
      kind: 'done',
      accelerator: 'Control+Shift+1',
    });
  });

  it('names the meta key per platform', () => {
    expect(acceleratorFromKeyPress(press('Space', { metaKey: true }), 'darwin')).toMatchObject({
      accelerator: 'Command+Space',
    });
    expect(acceleratorFromKeyPress(press('Space', { metaKey: true }), 'win32')).toMatchObject({
      accelerator: 'Super+Space',
    });
  });

  it('waits while only modifiers are held', () => {
    expect(acceleratorFromKeyPress(press('AltLeft', { altKey: true }), 'darwin')).toEqual({
      kind: 'pending',
      modifiers: ['Alt'],
    });
  });

  it('allows function keys alone, but not plain or shift-only keys', () => {
    expect(acceleratorFromKeyPress(press('F5'), 'win32')).toEqual({ kind: 'done', accelerator: 'F5' });
    expect(acceleratorFromKeyPress(press('KeyA'), 'win32').kind).toBe('invalid');
    expect(acceleratorFromKeyPress(press('KeyA', { shiftKey: true }), 'win32').kind).toBe('invalid');
    expect(acceleratorFromKeyPress(press('IntlRo', { altKey: true }), 'win32').kind).toBe('invalid');
  });
});

describe('acceleratorKeys', () => {
  it('draws macOS symbols', () => {
    expect(acceleratorKeys('Alt+Space', 'darwin')).toEqual(['⌥', 'Space']);
    expect(acceleratorKeys('CommandOrControl+Shift+K', 'darwin')).toEqual(['⌘', '⇧', 'K']);
  });

  it('draws words elsewhere', () => {
    expect(acceleratorKeys('CommandOrControl+Shift+K', 'win32')).toEqual(['Ctrl', 'Shift', 'K']);
    expect(acceleratorKeys('Control+Plus', 'linux')).toEqual(['Ctrl', '+']);
  });
});

describe('sameShortcut', () => {
  it('ignores the order and spelling of the modifiers', () => {
    expect(sameShortcut('Shift+Command+Space', 'Command+Shift+Space', 'darwin')).toBe(true);
    expect(sameShortcut('CommandOrControl+Space', 'Command+Space', 'darwin')).toBe(true);
    expect(sameShortcut('CommandOrControl+Space', 'Control+Space', 'win32')).toBe(true);
  });

  it('tells different keys apart', () => {
    expect(sameShortcut('Alt+Space', 'Control+Space', 'darwin')).toBe(false);
    expect(sameShortcut('Command+Space', 'Command+Shift+Space', 'darwin')).toBe(false);
  });
});
