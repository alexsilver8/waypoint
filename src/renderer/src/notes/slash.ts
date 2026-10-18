import type { Editor } from '@tiptap/core';
import { dismissInlineMenu, type InlineMatch, inlineMatch, matchAtEnd, menuPluginKey } from './inline-menu';

/**
 * The / menu, as in Raycast Notes: typing / at the start of a line, or after a space, offers
 * headings, lists, a quote, a code block and a divider, narrowed down as you keep typing.
 * Links aren't in it; ⌘L adds those.
 */

export const slashKey = menuPluginKey('slash');

/** A / at the start of a line or after a space, and what's typed after it. */
export const SLASH_TRIGGER = /(^|\s)\/([\p{L}\p{N}-]{0,20})$/u;

/** The / and what's typed after it, if the cursor is right after one that starts a command. */
export function slashMatch(textBefore: string): { offset: number; query: string } | null {
  return matchAtEnd(textBefore, SLASH_TRIGGER);
}

export function slashState(editor: Editor): InlineMatch | null {
  return inlineMatch(editor, slashKey);
}

/** Closes the menu and leaves what was typed, / and all. */
export function dismissSlash(editor: Editor): void {
  dismissInlineMenu(editor, slashKey);
}
