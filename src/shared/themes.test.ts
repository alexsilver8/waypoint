import { describe, expect, it } from 'vitest';
import { COLOR_THEMES, isHexColor, luminance, themeColors, themeCss } from './themes';

describe('themeColors', () => {
  it('has no colours for the default look, or a theme it doesn’t know', () => {
    expect(themeColors('waypoint', { accent: '#000000' })).toBeUndefined();
    expect(themeColors('gone', { accent: '#000000' })).toBeUndefined();
  });

  it('gives a built-in theme’s colours, or your own', () => {
    expect(themeColors('ocean', { accent: '#000000' })).toEqual(COLOR_THEMES.find((t) => t.id === 'ocean')?.colors);
    expect(themeColors('custom', { accent: '#ff0000' })).toEqual({ accent: '#ff0000' });
  });

  it('only has valid colours in the built-in themes', () => {
    for (const theme of COLOR_THEMES) {
      if (!theme.colors) continue;
      expect(isHexColor(theme.colors.accent)).toBe(true);
      if (theme.colors.tint) expect(isHexColor(theme.colors.tint)).toBe(true);
    }
  });
});

describe('luminance', () => {
  it('goes from 0 for black to 1 for white', () => {
    expect(luminance('#000000')).toBe(0);
    expect(luminance('#ffffff')).toBeCloseTo(1);
    expect(luminance('#808080')).toBeCloseTo(0.216, 2);
  });
});

describe('themeCss', () => {
  it('sets the accent for light and dark, outweighing tokens.css', () => {
    const css = themeCss({ accent: '#ff0000' });
    expect(css).toContain('html:root:root {\n  --accent: #ff0000;\n  --accent-ink: #c70000;');
    expect(css).toMatch(/@media \(prefers-color-scheme: dark\) \{\nhtml:root:root \{\n {2}--accent: #ff3333;/);
    // Without a tint, the panes stay as they are.
    expect(css).not.toContain('--pane');
    expect(css).not.toContain('data-glass');
  });

  it('puts dark text on a light badge and white on a dark one', () => {
    expect(themeCss({ accent: '#ffe066' })).toContain('--badge-ink: #111318;');
    expect(themeCss({ accent: '#1e3a8a' }).split('@media')[0]).toContain('--badge-ink: #ffffff;');
  });

  it('washes the tint into the panes, and into solid glass without the system blur', () => {
    const css = themeCss({ accent: '#ff0000', tint: '#00ff00' });
    expect(css).toContain('--pane: color-mix(in oklab, #00ff00 7%, rgb(247 247 250 / 0.94));');
    expect(css).toContain(
      'html:root:root[data-glass="none"] {\n  --glass: color-mix(in oklab, #00ff00 7%, rgb(244 244 246));',
    );
    expect(css).toContain('--pane: color-mix(in oklab, #00ff00 10%, rgb(28 28 33 / 0.94));');
  });
});
