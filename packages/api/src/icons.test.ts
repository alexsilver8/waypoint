import { describe, expect, it } from 'vitest';
import { Icon } from './icons';

describe('Icon', () => {
  it('builds a built-in glyph, with a tint or without', () => {
    expect(Icon.builtin('globe', 'blue')).toEqual({ builtin: 'globe', tint: 'blue' });
    expect(Icon.builtin('globe')).toEqual({ builtin: 'globe' });
    expect(Object.keys(Icon.builtin('globe'))).toEqual(['builtin']);
  });

  it('builds an emoji and a file icon', () => {
    expect(Icon.emoji('🎲')).toEqual({ emoji: '🎲' });
    expect(Icon.path('/Applications/Safari.app')).toEqual({ path: '/Applications/Safari.app' });
    expect(Icon.path('assets/logo.png')).toEqual({ path: 'assets/logo.png' });
  });
});
