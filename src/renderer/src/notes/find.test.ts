import { type Editor, getSchema } from '@tiptap/core';
import { EditorState, type Transaction } from '@tiptap/pm/state';
import { describe, expect, it } from 'vitest';
import { findMatches, findPlugin, findState, replaceMatch, setFindQuery } from './find';
import { noteExtensions } from './markdown';

const schema = getSchema(noteExtensions({ onLinkShortcut: () => {} }));
const text = (value: string, marks: string[] = []) =>
  schema.text(
    value,
    marks.map((mark) => schema.mark(mark)),
  );
const paragraph = (...content: ReturnType<typeof text>[]) => schema.node('paragraph', null, content);

describe('findMatches', () => {
  it('finds every match, ignoring case, across bold and plain text', () => {
    const doc = schema.node('doc', null, [
      paragraph(text('Ship the '), text('glass', ['bold']), text(' look')),
      paragraph(text('Glass everywhere')),
    ]);
    const matches = findMatches(doc, 'glass');
    expect(matches).toHaveLength(2);
    expect(matches.map((match) => doc.textBetween(match.from, match.to))).toEqual(['glass', 'Glass']);
  });

  it('keeps positions right after a line break', () => {
    const doc = schema.node('doc', null, [
      schema.node('paragraph', null, [text('one'), schema.node('hardBreak'), text('two one')]),
    ]);
    const matches = findMatches(doc, 'one');
    expect(matches.map((match) => doc.textBetween(match.from, match.to))).toEqual(['one', 'one']);
  });

  it('finds nothing for an empty query', () => {
    expect(findMatches(schema.node('doc', null, [paragraph(text('a'))]), '')).toEqual([]);
  });
});

describe('replaceMatch', () => {
  /** Just enough of an editor for Find: its state, and a way to change it. */
  function editorWith(line: string): Editor {
    const doc = schema.node('doc', null, [paragraph(text(line))]);
    const editor: { isDestroyed: boolean; state: EditorState; view?: unknown } = {
      isDestroyed: false,
      state: EditorState.create({ doc, plugins: [findPlugin()] }),
    };
    editor.view = {
      dispatch: (tr: Transaction) => {
        editor.state = editor.state.apply(tr);
      },
    };
    return editor as unknown as Editor;
  }

  it('moves on to the next match, even when the replacement matches too', () => {
    const editor = editorWith('the cat and the dog');
    setFindQuery(editor, 'the');
    replaceMatch(editor, 'The');
    expect(findState(editor)).toMatchObject({ count: 2, index: 1 });
    replaceMatch(editor, 'The');
    expect(editor.state.doc.textContent).toBe('The cat and The dog');
  });

  it('goes round to the first match after the last one', () => {
    const editor = editorWith('one note, two notes');
    setFindQuery(editor, 'note');
    replaceMatch(editor, 'memo');
    replaceMatch(editor, 'memo');
    expect(editor.state.doc.textContent).toBe('one memo, two memos');
    expect(findState(editor)).toMatchObject({ count: 0, index: 0 });
  });

  it('deletes the match when the replacement is empty', () => {
    const editor = editorWith('a b a');
    setFindQuery(editor, 'a');
    replaceMatch(editor, '');
    expect(editor.state.doc.textContent).toBe(' b a');
    expect(findState(editor)).toMatchObject({ count: 1, index: 0 });
  });
});
