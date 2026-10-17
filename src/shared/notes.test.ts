import { describe, expect, it } from 'vitest';
import {
  browseSections,
  clampZoom,
  countCharacters,
  countWords,
  DEFAULT_NOTES_STATE,
  isOpenableLink,
  type Note,
  normalizeLink,
  normalizeNotesState,
  noteDeeplink,
  noteIdFromDeeplink,
  noteLength,
  notePreview,
  noteTitle,
  readableMarkdown,
  relativeTime,
  toPlainText,
} from './notes';

describe('noteTitle', () => {
  it('uses the first non-empty line without Markdown markers', () => {
    expect(noteTitle('\n\n# Groceries\n- oat milk')).toBe('Groceries');
    expect(noteTitle('- [ ] **call** the bank')).toBe('call the bank');
    expect(noteTitle('> quoted idea')).toBe('quoted idea');
  });

  it('reads formatted notes as text', () => {
    expect(noteTitle('Read [the docs](https://electronjs.org) first')).toBe('Read the docs first');
    expect(noteTitle('```js\nconst a = 1;\n```')).toBe('const a = 1;');
    expect(noteTitle('> - [x] quoted task')).toBe('quoted task');
    expect(noteTitle('## **Plan** for ~~Monday~~ Tuesday')).toBe('Plan for Monday Tuesday');
  });

  it('reads what the editor escapes as plain text', () => {
    expect(noteTitle('R&amp;D plan')).toBe('R&D plan');
    expect(noteTitle('fix snake\\_case and \\*stars\\*')).toBe('fix snake_case and *stars*');
    expect(noteTitle('snake_case _emphasis_')).toBe('snake_case emphasis');
    expect(noteTitle('1\\. Not a list')).toBe('1. Not a list');
    expect(noteTitle('&nbsp;\n\n&nbsp;\n\nReal title')).toBe('Real title');
    expect(notePreview('Title\n\n&nbsp;\n\nBody &lt;b&gt;')).toBe('Body <b>');
    expect(countWords('one\n\n&nbsp;\n\ntwo')).toBe(2);
  });

  it('falls back to Untitled', () => {
    expect(noteTitle('')).toBe('Untitled');
    expect(noteTitle('   \n#  \n')).toBe('Untitled');
  });

  it('shortens long titles', () => {
    expect(noteTitle('x'.repeat(200))).toHaveLength(80);
  });
});

describe('notePreview', () => {
  it('uses the second meaningful line', () => {
    expect(notePreview('# Groceries\n\n- oat milk\n- bread')).toBe('oat milk');
    expect(notePreview('Just one line')).toBe('');
  });
});

describe('countWords', () => {
  it('counts whitespace-separated words', () => {
    expect(countWords('')).toBe(0);
    expect(countWords('  one two\nthree  ')).toBe(3);
  });

  it("doesn't count Markdown markers as words", () => {
    expect(countWords('# Plan\n\n- [ ] Record a demo\n- [x] Ship\n\n```\ncode\n```')).toBe(6);
    expect(countWords('See [the docs](https://example.com)')).toBe(3);
  });
});

describe('isOpenableLink', () => {
  it('allows web and mail links only', () => {
    expect(isOpenableLink('https://example.com/a?b=1')).toBe(true);
    expect(isOpenableLink('mailto:alex@example.com')).toBe(true);
    expect(isOpenableLink('file:///etc/passwd')).toBe(false);
    expect(isOpenableLink('javascript:alert(1)')).toBe(false);
    expect(isOpenableLink('https://')).toBe(false);
  });
});

describe('normalizeLink', () => {
  it('turns what was typed into an address', () => {
    expect(normalizeLink('example.com')).toBe('https://example.com');
    expect(normalizeLink('localhost:5173')).toBe('https://localhost:5173');
    expect(normalizeLink('example.com:8080/a?b=1')).toBe('https://example.com:8080/a?b=1');
    expect(normalizeLink('http://example.com')).toBe('http://example.com');
    expect(normalizeLink('alex@example.com')).toBe('mailto:alex@example.com');
    expect(normalizeLink('mailto:alex@example.com')).toBe('mailto:alex@example.com');
    expect(normalizeLink('  ')).toBe('');
  });

  it('refuses addresses it would not open', () => {
    expect(normalizeLink('javascript:alert(1)')).toBeNull();
    expect(normalizeLink('file:///etc/passwd')).toBeNull();
    expect(normalizeLink('ftp://example.com')).toBeNull();
    expect(normalizeLink('two words')).toBeNull();
  });
});

describe('readableMarkdown', () => {
  it('decodes entities and escapes but keeps structure', () => {
    expect(readableMarkdown('# R&amp;D\n\n- [ ] snake\\_case\n\n&nbsp;')).toBe('# R&D\n\n- [ ] snake_case\n\n ');
  });
});

describe('countCharacters', () => {
  it('counts what you read, as Raycast does: no Markdown markers, one per emoji', () => {
    expect(countCharacters('')).toBe(0);
    expect(countCharacters('# Groceries\n\n- oat milk')).toBe('Groceries\noat milk'.length);
    expect(countCharacters('**bold** and [a link](https://example.com)')).toBe('bold and a link'.length);
    expect(countCharacters('👋🏽 hi')).toBe(4);
  });
});

describe('noteLength', () => {
  it('counts characters or words, with a plural only when it needs one', () => {
    expect(noteLength('', 'characters')).toBe('0 characters');
    expect(noteLength('a', 'characters')).toBe('1 character');
    expect(noteLength('one two', 'words')).toBe('2 words');
    expect(noteLength('one', 'words')).toBe('1 word');
    // Raycast writes 1366, not 1,366.
    expect(noteLength('x'.repeat(1366), 'characters')).toBe('1366 characters');
  });
});

describe('toPlainText', () => {
  it('drops Markdown but keeps lists and checklists readable', () => {
    const markdown =
      '# Launch plan\n\nShip **v1.3** with [the docs](https://example.com).\n\n- [ ] Record a demo\n- [x] Settings\n\n1. Tag\n2. Publish\n\n> Keep it short.\n\n- one\n  - nested';
    expect(toPlainText(markdown)).toBe(
      'Launch plan\n\nShip v1.3 with the docs.\n\n☐ Record a demo\n☑ Settings\n\n1. Tag\n2. Publish\n\nKeep it short.\n\n• one\n  • nested',
    );
  });

  it('keeps code as it is, without its fences', () => {
    expect(toPlainText('Run:\n\n```sh\npnpm *dev*\n```')).toBe('Run:\n\npnpm *dev*');
  });

  it('reads escapes and entities as the characters they stand for', () => {
    expect(toPlainText('R&amp;D for snake\\_case and 1\\. not a list')).toBe('R&D for snake_case and 1. not a list');
  });
});

describe('relativeTime', () => {
  const now = Date.UTC(2026, 9, 17, 12);
  const ago = (ms: number) => relativeTime(now - ms, now);
  const minute = 60_000;
  const day = 24 * 60 * minute;

  it('says how long ago, the way Raycast lists notes', () => {
    expect(ago(10_000)).toBe('just now');
    expect(ago(5 * minute)).toBe('5 minutes ago');
    expect(ago(60 * minute)).toBe('1 hour ago');
    expect(ago(day)).toBe('yesterday');
    expect(ago(3 * day)).toBe('3 days ago');
    expect(ago(8 * day)).toBe('last week');
    expect(ago(35 * day)).toBe('last month');
    expect(ago(62 * day)).toBe('2 months ago');
    expect(ago(210 * day)).toBe('7 months ago');
    expect(ago(400 * day)).toBe('last year');
  });

  it('treats a time in the future as now', () => {
    expect(relativeTime(now + 5 * minute, now)).toBe('just now');
  });
});

describe('browseSections', () => {
  const note = (id: string, updatedAt: number): Note => ({ id, text: id, createdAt: 0, updatedAt });
  const notes = [note('a', 4), note('b', 3), note('c', 2), note('d', 1)];

  it('lists pinned notes first, in the order they were pinned', () => {
    const sections = browseSections(notes, { pinned: ['c', 'gone', 'a'], opened: {}, currentId: null });
    expect(sections.pinned.map((n) => n.id)).toEqual(['c', 'a']);
    expect(sections.notes.map((n) => n.id)).toEqual(['b', 'd']);
  });

  it('orders the rest by when they were last open, with the note you are on at the end', () => {
    const sections = browseSections(notes, { pinned: [], opened: { d: 10, b: 9 }, currentId: 'a' });
    expect(sections.notes.map((n) => n.id)).toEqual(['d', 'b', 'c', 'a']);
  });
});

describe('note deeplinks', () => {
  it('round-trips a note id', () => {
    expect(noteDeeplink('mf3x2k1a-9c1e')).toBe('waypoint://notes/mf3x2k1a-9c1e');
    expect(noteIdFromDeeplink(noteDeeplink('Trip to Lisbon'))).toBe('Trip to Lisbon');
    expect(noteIdFromDeeplink('waypoint://notes/groceries/')).toBe('groceries');
  });

  it('refuses links to anything else', () => {
    expect(noteIdFromDeeplink('https://notes/groceries')).toBeUndefined();
    expect(noteIdFromDeeplink('waypoint://settings/general')).toBeUndefined();
    expect(noteIdFromDeeplink('waypoint://notes/')).toBeUndefined();
    expect(noteIdFromDeeplink('waypoint://notes/..%2Fsecrets')).toBeUndefined();
    expect(noteIdFromDeeplink('waypoint://notes/.hidden')).toBeUndefined();
    expect(noteIdFromDeeplink('not a url')).toBeUndefined();
  });
});

describe('normalizeNotesState', () => {
  it('starts like Raycast Notes: floating, resizing to fit, no format bar', () => {
    expect(normalizeNotesState(undefined)).toEqual(DEFAULT_NOTES_STATE);
    expect(DEFAULT_NOTES_STATE).toMatchObject({ alwaysOnTop: true, autoResize: true, formatBar: false });
  });

  it('keeps valid values and drops the rest', () => {
    const state = normalizeNotesState({
      alwaysOnTop: false,
      autoResize: 'yes',
      count: 'words',
      zoom: 5,
      pinned: ['a', 'a', 3, 'b'],
      opened: { a: 100, b: 'yesterday', c: -1 },
      back: Array.from({ length: 80 }, (_, i) => `n${i}`),
    });
    expect(state.alwaysOnTop).toBe(false);
    expect(state.autoResize).toBe(true);
    expect(state.count).toBe('words');
    expect(state.zoom).toBe(2);
    expect(state.pinned).toEqual(['a', 'b']);
    expect(state.opened).toEqual({ a: 100 });
    expect(state.back).toHaveLength(50);
    expect(state.back.at(-1)).toBe('n79');
  });

  it('steps text size by 10% within its range', () => {
    expect(clampZoom(1.04)).toBe(1);
    expect(clampZoom(0.2)).toBe(0.6);
    expect(clampZoom(1.1 + 0.1)).toBe(1.2);
  });
});
