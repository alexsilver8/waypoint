import { compact } from './internal';
import { type ShortcutInput, shortcut } from './shortcut';
import type * as api from './types';

/**
 * Something the user can do with an item. The first action of an item runs on ↵, the second on
 * ⌘↵ (Ctrl+Enter on Windows and Linux), and all of them are listed in the action panel (⌘K).
 */
export type Action = api.Action;

/** The action whose `type` is `T`, e.g. `ActionOf<'copy'>`. */
export type ActionOf<T extends api.Action['type']> = Extract<api.Action, { type: T }>;

/**
 * What an action takes besides the arguments given to its builder: `title`, a `shortcut`
 * (an object, or a string like `'mod+shift+c'`), and that action's optional fields.
 */
export type ActionOptions<T extends api.Action['type'], Given extends keyof ActionOf<T> = never> = Omit<
  ActionOf<T>,
  'type' | 'shortcut' | Given
> & { shortcut?: ShortcutInput };

function build<T extends api.Action['type']>(
  type: T,
  fields: Partial<ActionOf<T>>,
  options: { shortcut?: ShortcutInput } | undefined,
): ActionOf<T> {
  const { shortcut: keys, ...rest } = options ?? {};
  return compact({
    type,
    ...fields,
    ...rest,
    shortcut: keys === undefined ? undefined : shortcut(keys),
  }) as ActionOf<T>;
}

/**
 * Builds actions. Each returns the plain object, so
 * `Action.copy(uuid, { title: 'Copy UUID' })` and `{ type: 'copy', text: uuid, title: 'Copy UUID' }`
 * are the same.
 */
export const Action: {
  /** Copies the text and closes the launcher. */
  copy(text: string, options?: ActionOptions<'copy', 'text'>): ActionOf<'copy'>;
  /** Closes the launcher and pastes the text into the app that was in front. */
  paste(text: string, options?: ActionOptions<'paste', 'text'>): ActionOf<'paste'>;
  /** Opens the URL in the default browser, or the app that handles it. */
  openUrl(url: string, options?: ActionOptions<'open-url', 'url'>): ActionOf<'open-url'>;
  /** Opens a file, folder or app; `path` must be absolute. */
  openPath(path: string, options?: ActionOptions<'open-path', 'path'>): ActionOf<'open-path'>;
  /** Shows the file in Finder, Explorer or the file manager; `path` must be absolute. */
  revealPath(path: string, options?: ActionOptions<'reveal-path', 'path'>): ActionOf<'reveal-path'>;
  /** Opens a command, of this extension or another, with `options.argument` as its argument. */
  openCommand(ref: api.CommandRef, options?: ActionOptions<'open-command', 'ref'>): ActionOf<'open-command'>;
  /**
   * Calls the command's `onAction(id, payload, ctx)`. `options.payload` is any JSON value;
   * `style: 'destructive'` shows it in red in the action panel.
   */
  callback(id: string, title: string, options?: ActionOptions<'callback', 'id' | 'title'>): ActionOf<'callback'>;
} = {
  copy: (text, options) => build('copy', { text }, options),
  paste: (text, options) => build('paste', { text }, options),
  openUrl: (url, options) => build('open-url', { url }, options),
  openPath: (path, options) => build('open-path', { path }, options),
  revealPath: (path, options) => build('reveal-path', { path }, options),
  openCommand: (ref, options) =>
    build('open-command', { ref: { extension: ref.extension, command: ref.command } }, options),
  callback: (id, title, options) => build('callback', { id, title }, options),
};
