import { type Editor, Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';

/**
 * The / menu, as in Raycast Notes: typing / at the start of a line, or after a space, offers
 * headings, lists, a quote, a code block and a divider, narrowed down as you keep typing.
 * Links aren't in it; ⌘L adds those.
 */

export interface SlashState {
  /** Where the / is and where the cursor is now; the text between is the query. */
  from: number;
  to: number;
  query: string;
}

interface PluginState {
  match: SlashState | null;
}

export const slashKey = new PluginKey<PluginState>('slash');

/** What the menu does with the keys it uses while it's open. */
export interface SlashKeys {
  onKey(key: 'ArrowUp' | 'ArrowDown' | 'Enter' | 'Tab' | 'Escape'): boolean;
}

/** The / and what's typed after it, if the cursor is right after one that starts a command. */
export function slashMatch(textBefore: string): { offset: number; query: string } | null {
  const match = /(^|\s)\/([\p{L}\p{N}-]{0,20})$/u.exec(textBefore);
  if (!match) return null;
  const offset = match.index + (match[1] ?? '').length;
  return { offset, query: match[2] ?? '' };
}

export const SlashCommands = Extension.create<SlashKeys>({
  name: 'slashCommands',
  addOptions() {
    return { onKey: () => false };
  },
  addProseMirrorPlugins() {
    // Options are copied when configured, so the menu is reached through a function.
    const { onKey } = this.options;
    return [
      new Plugin<PluginState>({
        key: slashKey,
        state: {
          init: () => ({ match: null }),
          apply(tr, previous, _old, state) {
            // Esc closes the menu; typing more after that doesn't bring it back.
            if (tr.getMeta(slashKey)?.dismiss) return { match: null };
            const { selection } = state;
            if (!selection.empty || selection.$from.parent.type.spec.code) return { match: null };
            const { $from } = selection;
            const found = slashMatch($from.parent.textBetween(0, $from.parentOffset, undefined, '\ufffc'));
            if (!found) return { match: null };
            const match = { from: $from.start() + found.offset, to: selection.from, query: found.query };
            // An open menu follows what you type after its /. A new one opens only when you've
            // just typed a /, not when the cursor lands after one already in the note.
            if (previous.match && tr.mapping.map(previous.match.from) === match.from) return { match };
            return { match: tr.docChanged && match.query === '' ? match : null };
          },
        },
        props: {
          handleKeyDown(view, event) {
            const state = slashKey.getState(view.state);
            if (!state?.match || event.metaKey || event.ctrlKey || event.altKey) return false;
            const key = event.key;
            if (key !== 'ArrowUp' && key !== 'ArrowDown' && key !== 'Enter' && key !== 'Tab' && key !== 'Escape') {
              return false;
            }
            if (event.shiftKey && key !== 'Tab') return false;
            const handled = onKey(key);
            // Esc closes the menu, not the window.
            if (handled) event.stopPropagation();
            return handled;
          },
        },
      }),
    ];
  },
});

export function slashState(editor: Editor): SlashState | null {
  return slashKey.getState(editor.state)?.match ?? null;
}

/** Closes the menu and leaves what was typed, / and all. */
export function dismissSlash(editor: Editor): void {
  if (slashState(editor)) editor.view.dispatch(editor.state.tr.setMeta(slashKey, { dismiss: true }));
}
