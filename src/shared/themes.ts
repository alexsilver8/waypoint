/**
 * Colour themes: an accent for what's picked and matched, and a tint for the panes, on top of
 * light or dark. The main process puts a theme's stylesheet into every window; the default theme
 * has none, so the windows look as tokens.css draws them.
 */

export interface ThemeColors {
  /** `#rrggbb`: selection, matched letters, badges, toggles and links. */
  accent: string;
  /** `#rrggbb`, washed into the panes and glass; none leaves them neutral. */
  tint?: string;
}

export interface ColorTheme {
  id: string;
  name: string;
  /** Left out for the default look. */
  colors?: ThemeColors;
}

export const DEFAULT_COLOR_THEME = 'waypoint';
/** Your own colours, from `customTheme` in settings. */
export const CUSTOM_COLOR_THEME = 'custom';

export const COLOR_THEMES: ColorTheme[] = [
  { id: DEFAULT_COLOR_THEME, name: 'Waypoint' },
  { id: 'graphite', name: 'Graphite', colors: { accent: '#6b7280', tint: '#64748b' } },
  { id: 'ocean', name: 'Ocean', colors: { accent: '#0e9de0', tint: '#0ea5e9' } },
  { id: 'forest', name: 'Forest', colors: { accent: '#1f9d55', tint: '#22c55e' } },
  { id: 'grape', name: 'Grape', colors: { accent: '#8b5cf6', tint: '#a855f7' } },
  { id: 'rose', name: 'Rose', colors: { accent: '#e5487a', tint: '#f43f5e' } },
  { id: 'amber', name: 'Amber', colors: { accent: '#e8890c', tint: '#f59e0b' } },
];

const HEX = /^#[0-9a-f]{6}$/i;

export function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && HEX.test(value);
}

/** The colours a theme picks, or none for the default look (or a theme that isn't known). */
export function themeColors(colorTheme: string, customTheme: ThemeColors): ThemeColors | undefined {
  if (colorTheme === CUSTOM_COLOR_THEME) return customTheme;
  return COLOR_THEMES.find((theme) => theme.id === colorTheme)?.colors;
}

type Rgb = [number, number, number];

const toRgb = (hex: string): Rgb => [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16)) as Rgb;
const toHex = (rgb: Rgb) => `#${rgb.map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')}`;

/** `hex` moved `amount` (0 to 1) of the way to `toward`. */
function mix(hex: string, toward: Rgb, amount: number): string {
  const from = toRgb(hex);
  return toHex(from.map((c, i) => c + ((toward[i] ?? 0) - c) * amount) as Rgb);
}

const WHITE: Rgb = [255, 255, 255];
const BLACK: Rgb = [0, 0, 0];

/** Relative luminance, from 0 for black to 1 for white. */
export function luminance(hex: string): number {
  const [r, g, b] = toRgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as Rgb;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Text that reads on `background`: white on dark colours, near-black on light ones. */
function inkOn(background: string): string {
  return luminance(background) > 0.4 ? '#111318' : '#ffffff';
}

/** Washes `tint` into a surface, keeping the surface's own transparency. */
const wash = (tint: string, percent: number, surface: string) => `color-mix(in oklab, ${tint} ${percent}%, ${surface})`;

/**
 * The stylesheet for a theme, for light and dark. Its selectors outweigh tokens.css's, which
 * they replace, so it applies wherever it lands in the page.
 */
export function themeCss({ accent, tint }: ThemeColors): string {
  const root = 'html:root:root';
  const light = {
    '--accent': accent,
    '--accent-ink': mix(accent, BLACK, 0.22),
    '--match': mix(accent, BLACK, 0.22),
    '--badge': accent,
    '--badge-ink': inkOn(accent),
  };
  const darkAccent = mix(accent, WHITE, 0.2);
  const darkBadge = mix(accent, WHITE, 0.3);
  const dark = {
    '--accent': darkAccent,
    '--accent-ink': mix(accent, WHITE, 0.42),
    '--match': mix(accent, WHITE, 0.42),
    '--badge': darkBadge,
    '--badge-ink': inkOn(darkBadge),
  };
  const lightSurfaces: Record<string, string> = tint
    ? {
        '--glass': wash(tint, 10, 'rgb(250 250 252 / 0.42)'),
        '--glass-panel': wash(tint, 7, 'rgb(252 252 253 / 0.78)'),
        '--pane': wash(tint, 7, 'rgb(247 247 250 / 0.94)'),
      }
    : {};
  const darkSurfaces: Record<string, string> = tint
    ? {
        '--glass': wash(tint, 12, 'rgb(22 22 28 / 0.36)'),
        '--glass-panel': wash(tint, 10, 'rgb(40 40 46 / 0.78)'),
        '--pane': wash(tint, 10, 'rgb(28 28 33 / 0.94)'),
      }
    : {};
  const block = (selector: string, variables: Record<string, string>) =>
    Object.keys(variables).length === 0
      ? ''
      : `${selector} {\n${Object.entries(variables)
          .map(([name, value]) => `  ${name}: ${value};`)
          .join('\n')}\n}\n`;
  const opaque = (surface: string): Record<string, string> => (tint ? { '--glass': wash(tint, 7, surface) } : {});
  return [
    block(root, { ...light, ...lightSurfaces }),
    // Without the system's blur, the glass is solid.
    block(`${root}[data-glass="none"]`, opaque('rgb(244 244 246)')),
    `@media (prefers-color-scheme: dark) {\n${block(root, { ...dark, ...darkSurfaces })}${block(
      `${root}[data-glass="none"]`,
      opaque('rgb(30 30 34)'),
    )}}\n`,
  ].join('');
}
