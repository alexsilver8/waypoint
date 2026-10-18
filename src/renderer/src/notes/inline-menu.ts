import { type Editor, Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';

/**
 * Menus that open as you type in a note, like Raycast's: / for formatting and : for emoji.
 * Each watches the text before the cursor for its pattern; the React side draws the menu and
 * handles the keys it uses while it's open.
 */

export interface InlineMatch {
  /** Where the trigger (/ or :) is, and where the cursor is now. */
  from: number;
  to: number;
  /** What's typed after the trigger. */
  query: string;
}

export type MenuKey = 'ArrowUp' | 'ArrowDown' | 'Enter' | 'Tab' | 'Escape';

/** What an open menu does with a key; true if it used it. */
export interface MenuKeys {
  onKey(key: MenuKey): boolean;
}

export interface MenuState {
  match: InlineMatch | null;
}

export interface InlineMenuOptions extends MenuKeys {
  /** Matches the end of the text before the cursor: group 1 is what precedes the trigger, group 2 the query. */
  pattern: RegExp;
  /** Whether a menu opens for what you've just typed (it then follows what you type after it). */
  opensFor(query: string): boolean;
}

/** The trigger and query at the end of `textBefore`, if `pattern` matches there. */
export function matchAtEnd(textBefore: string, pattern: RegExp): { offset: number; query: string } | null {
  const match = pattern.exec(textBefore);
  if (!match) return null;
  return { offset: match.index + (match[1] ?? '').length, query: match[2] ?? '' };
}

const MENU_KEYS = new Set<string>(['ArrowUp', 'ArrowDown', 'Enter', 'Tab', 'Escape']);

/** An extension that watches for one menu's trigger. */
export function inlineMenu(name: string, key: PluginKey<MenuState>) {
  return Extension.create<InlineMenuOptions>({
    name,
    addOptions() {
      return { pattern: /$^/, opensFor: () => false, onKey: () => false };
    },
    addProseMirrorPlugins() {
      // Options are copied when configured, so the menu is reached through functions.
      const { pattern, opensFor, onKey } = this.options;
      return [
        new Plugin<MenuState>({
          key,
          state: {
            init: () => ({ match: null }),
            apply(tr, previous, _old, state) {
              // Esc closes the menu; typing more after that doesn't bring it back.
              if (tr.getMeta(key)?.dismiss) return { match: null };
              const { selection } = state;
              if (!selection.empty || selection.$from.parent.type.spec.code) return { match: null };
              const { $from } = selection;
              const found = matchAtEnd($from.parent.textBetween(0, $from.parentOffset, undefined, '\ufffc'), pattern);
              if (!found) return { match: null };
              const match = { from: $from.start() + found.offset, to: selection.from, query: found.query };
              // An open menu follows what you type after its trigger. A new one opens only for
              // something you've just typed, not when the cursor lands after it.
              if (previous.match && tr.mapping.map(previous.match.from) === match.from) return { match };
              return { match: tr.docChanged && opensFor(match.query) ? match : null };
            },
          },
          props: {
            handleKeyDown(view, event) {
              if (!key.getState(view.state)?.match) return false;
              if (event.metaKey || event.ctrlKey || event.altKey || !MENU_KEYS.has(event.key)) return false;
              if (event.shiftKey && event.key !== 'Tab') return false;
              const handled = onKey(event.key as MenuKey);
              // Esc closes the menu, not the window.
              if (handled) event.stopPropagation();
              return handled;
            },
          },
        }),
      ];
    },
  });
}

export function inlineMatch(editor: Editor, key: PluginKey<MenuState>): InlineMatch | null {
  return key.getState(editor.state)?.match ?? null;
}

/** Closes a menu and leaves what was typed as it is. */
export function dismissInlineMenu(editor: Editor, key: PluginKey<MenuState>): void {
  if (inlineMatch(editor, key)) editor.view.dispatch(editor.state.tr.setMeta(key, { dismiss: true }));
}

export function menuPluginKey(name: string): PluginKey<MenuState> {
  return new PluginKey<MenuState>(name);
}

/** Below the title bar, a menu never covers it. */
const TOP_LIMIT = 56;
const GAP = 6;
const MARGIN = 8;

/**
 * Where a menu goes for a line at `line` (its top and bottom): below it, or above when there's
 * more room there, as tall as it can be in that room (it scrolls if it has to).
 */
export function placeMenu(
  line: { top: number; bottom: number; left: number },
  size: { width: number; height: number },
  view: { width: number; height: number },
): { left: number; top?: number; bottom?: number; maxHeight: number } {
  const left = Math.max(MARGIN, Math.min(line.left - MARGIN, view.width - size.width - MARGIN));
  const below = view.height - line.bottom - GAP - MARGIN;
  const above = line.top - GAP - TOP_LIMIT;
  if (below >= size.height || below >= above) {
    return { left, top: line.bottom + GAP, maxHeight: Math.max(0, below) };
  }
  return { left, bottom: view.height - line.top + GAP, maxHeight: above };
}
