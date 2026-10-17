import { getSchema } from '@tiptap/core';
import { describe, expect, it } from 'vitest';
import { findMatches } from './find';
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
