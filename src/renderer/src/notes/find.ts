import { type Editor, Extension } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

/**
 * Find in Note (⌘F): highlights every match in the note and steps through them, with
 * replace and replace all, as Raycast Notes does.
 */

export interface FindMatch {
  from: number;
  to: number;
}

interface FindState {
  query: string;
  matches: FindMatch[];
  /** The match you're on. */
  index: number;
  decorations: DecorationSet;
}

export const findKey = new PluginKey<FindState>('find');

/** A leaf inside a paragraph (a line break) takes one place in the document but isn't text. */
const LEAF = '\ufffc';

/** Every place `query` appears in the note, ignoring case, within a paragraph or heading. */
export function findMatches(doc: ProseMirrorNode, query: string): FindMatch[] {
  if (!query) return [];
  const matches: FindMatch[] = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    // The block's text, and where in the document each of its characters is.
    let text = '';
    const positions: number[] = [];
    node.forEach((child, offset) => {
      const start = pos + 1 + offset;
      if (child.isText && child.text) {
        for (let i = 0; i < child.text.length; i++) positions.push(start + i);
        text += child.text;
      } else {
        positions.push(start);
        text += LEAF;
      }
    });
    // Lowercasing can change a string's length (İ); then case has to match.
    const lower = text.toLowerCase();
    const caseless = lower.length === text.length;
    const haystack = caseless ? lower : text;
    const needle = caseless ? query.toLowerCase() : query;
    for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, at + needle.length)) {
      const from = positions[at];
      const last = positions[at + needle.length - 1];
      if (from !== undefined && last !== undefined) matches.push({ from, to: last + 1 });
    }
    return false;
  });
  return matches;
}

function decorate(doc: ProseMirrorNode, matches: FindMatch[], index: number): DecorationSet {
  return DecorationSet.create(
    doc,
    matches.map((match, i) =>
      Decoration.inline(match.from, match.to, { class: i === index ? 'find-match find-match--current' : 'find-match' }),
    ),
  );
}

export const Find = Extension.create({
  name: 'find',
  addProseMirrorPlugins() {
    return [
      new Plugin<FindState>({
        key: findKey,
        state: {
          init: () => ({ query: '', matches: [], index: 0, decorations: DecorationSet.empty }),
          apply(tr, previous) {
            const meta = tr.getMeta(findKey) as { query?: string; index?: number } | undefined;
            if (!meta && !tr.docChanged) return previous;
            const query = meta?.query ?? previous.query;
            if (!query) return { query, matches: [], index: 0, decorations: DecorationSet.empty };
            const matches = findMatches(tr.doc, query);
            const wanted = meta?.index ?? previous.index;
            const index = matches.length ? ((wanted % matches.length) + matches.length) % matches.length : 0;
            return { query, matches, index, decorations: decorate(tr.doc, matches, index) };
          },
        },
        props: {
          decorations: (state) => findKey.getState(state)?.decorations,
        },
      }),
    ];
  },
});

export function findState(editor: Editor): { query: string; count: number; index: number } {
  const state = findKey.getState(editor.state);
  return { query: state?.query ?? '', count: state?.matches.length ?? 0, index: state?.index ?? 0 };
}

/** Selects the match you're on and scrolls to it, without taking the keyboard from the find field. */
function reveal(editor: Editor): void {
  const state = findKey.getState(editor.state);
  const match = state?.matches[state.index];
  if (!match) return;
  const { tr } = editor.state;
  editor.view.dispatch(tr.setSelection(TextSelection.create(tr.doc, match.from, match.to)).scrollIntoView());
}

export function setFindQuery(editor: Editor, query: string): void {
  if (editor.isDestroyed) return;
  // Start from the match nearest the cursor, as editors do.
  const { from } = editor.state.selection;
  const matches = findMatches(editor.state.doc, query);
  const nearest = Math.max(
    0,
    matches.findIndex((match) => match.to > from),
  );
  editor.view.dispatch(editor.state.tr.setMeta(findKey, { query, index: nearest }));
  reveal(editor);
}

/** Moves to the next match (or the previous one, with a negative step), going round at the ends. */
export function findNext(editor: Editor, step: number): void {
  const state = findKey.getState(editor.state);
  if (!state?.matches.length) return;
  editor.view.dispatch(editor.state.tr.setMeta(findKey, { index: state.index + step }));
  reveal(editor);
}

export function replaceMatch(editor: Editor, replacement: string): void {
  const state = findKey.getState(editor.state);
  const match = state?.matches[state.index];
  if (!match) return;
  const { tr } = editor.state;
  if (replacement) tr.insertText(replacement, match.from, match.to);
  else tr.delete(match.from, match.to);
  // The same index is now the match after the one replaced.
  editor.view.dispatch(tr.setMeta(findKey, { index: state.index }));
  reveal(editor);
}

export function replaceAll(editor: Editor, replacement: string): number {
  const state = findKey.getState(editor.state);
  if (!state?.matches.length) return 0;
  const { tr } = editor.state;
  for (const match of [...state.matches].reverse()) {
    if (replacement) tr.insertText(replacement, match.from, match.to);
    else tr.delete(match.from, match.to);
  }
  editor.view.dispatch(tr);
  return state.matches.length;
}
