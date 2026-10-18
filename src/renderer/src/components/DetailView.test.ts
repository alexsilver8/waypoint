import { describe, expect, it } from 'vitest';
import { pageScroll } from './DetailView';

const key = (
  k: string,
  mods: Partial<{ metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }> = {},
) => ({
  key: k,
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  ...mods,
});

describe('pageScroll', () => {
  it('scrolls a line with the arrows and most of a page with Page Up, Page Down and Space', () => {
    expect(pageScroll(key('ArrowDown'), 400, 'linux')).toBe(40);
    expect(pageScroll(key('ArrowUp'), 400, 'linux')).toBe(-40);
    expect(pageScroll(key('PageDown'), 400, 'linux')).toBe(340);
    expect(pageScroll(key('PageUp'), 400, 'linux')).toBe(-340);
    expect(pageScroll(key(' '), 400, 'linux')).toBe(340);
    expect(pageScroll(key(' ', { shiftKey: true }), 400, 'linux')).toBe(-340);
  });

  it('goes to the top or the bottom with Home, End and ⌘ with an arrow', () => {
    expect(pageScroll(key('Home'), 400, 'linux')).toBe('top');
    expect(pageScroll(key('End'), 400, 'linux')).toBe('bottom');
    expect(pageScroll(key('ArrowUp', { metaKey: true }), 400, 'darwin')).toBe('top');
    expect(pageScroll(key('ArrowDown', { ctrlKey: true }), 400, 'win32')).toBe('bottom');
  });

  it('leaves other keys alone', () => {
    expect(pageScroll(key('Enter'), 400, 'linux')).toBeUndefined();
    expect(pageScroll(key('ArrowDown', { altKey: true }), 400, 'linux')).toBeUndefined();
    expect(pageScroll(key('ArrowDown', { ctrlKey: true }), 400, 'darwin')).toBeUndefined();
    expect(pageScroll(key('k', { metaKey: true }), 400, 'darwin')).toBeUndefined();
  });
});
