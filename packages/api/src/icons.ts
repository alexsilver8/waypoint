import type * as api from './types';

/** An icon: a built-in glyph, an emoji, or an image file. */
export type Icon = api.Icon;

/** Builds icons. Each returns the plain object, so `{ emoji: '🎲' }` and `Icon.emoji('🎲')` are the same. */
export const Icon: {
  /** A built-in glyph on a coloured tile, e.g. `Icon.builtin('globe', 'blue')`. */
  builtin(name: api.BuiltinIconName, tint?: api.Tint): Extract<api.Icon, { builtin: unknown }>;
  /** A single emoji, or up to three characters of text. */
  emoji(emoji: string): Extract<api.Icon, { emoji: unknown }>;
  /**
   * A file: an absolute path, or an image's path relative to the extension's folder. Images are
   * shown as they are; any other file shows its icon from the system.
   */
  path(path: string): Extract<api.Icon, { path: unknown }>;
} = {
  builtin: (name, tint) => (tint ? { builtin: name, tint } : { builtin: name }),
  emoji: (emoji) => ({ emoji }),
  path: (path) => ({ path }),
};
