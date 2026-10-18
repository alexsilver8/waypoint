import { Extension, type Extensions, type JSONContent } from '@tiptap/core';
import { Link } from '@tiptap/extension-link';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import { Paragraph } from '@tiptap/extension-paragraph';
import { Placeholder } from '@tiptap/extensions';
import { Markdown, type MarkdownManager } from '@tiptap/markdown';
import { StarterKit } from '@tiptap/starter-kit';
import { Find } from './find';
import { SlashCommands, type SlashKeys } from './slash';

/**
 * How notes turn into Markdown and back. Notes are files people also open elsewhere, so
 * what the editor writes stays as close as it can to what was there: it only escapes what
 * Markdown would otherwise misread, and a note the editor can't show without losing
 * something isn't shown formatted at all (see `showsFaithfully`).
 */

/** Options for `marked`: GitHub-flavoured, and a single newline stays a newline, not a line break. */
export const MARKED_OPTIONS = { gfm: true, breaks: false } as const;

const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;

/**
 * Escapes plain text for Markdown, gently: `R&D`, `2 < 3` and `snake_case` stay as typed.
 * Only `&` that would start an entity, `<` that would start a tag, and `_` at the edge of a
 * word are escaped, plus the characters that always mean something inline.
 */
export function escapeText(text: string): string {
  return text
    .replace(/[\\`*[\]~]/g, '\\$&')
    .replace(/&(?=#?[\da-z]+;)/gi, '&amp;')
    .replace(/<(?=[a-z/!?])/gi, '&lt;')
    .replace(/_/g, (underscore, offset: number, whole: string) =>
      LETTER_OR_DIGIT.test(whole[offset - 1] ?? '') && LETTER_OR_DIGIT.test(whole[offset + 1] ?? '')
        ? underscore
        : '\\_',
    );
}

/**
 * Escapes the start of each line of a paragraph that Markdown would read as a list, heading,
 * quote, code fence or rule, so plain text that happens to start with `1. ` or `- ` comes back
 * as plain text.
 */
export function escapeBlockStarts(markdown: string): string {
  return markdown
    .split('\n')
    .map((line) =>
      line
        .replace(/^(\s{0,3})([-*_])(?=(?:\s*\2){2,}\s*$)/, '$1\\$2')
        .replace(/^(\s{0,3})([-+*])(?=\s|$)/, '$1\\$2')
        .replace(/^(\s{0,3}\d{1,9})([.)])(?=\s|$)/, '$1\\$2')
        .replace(/^(\s{0,3})(#{1,6})(?=\s|$)/, '$1\\$2')
        .replace(/^(\s{0,3})(>|```|~~~|=+\s*$)/, '$1\\$2'),
    )
    .join('\n');
}

/** Plain text that reads back as itself: a paragraph never turns into a list on reopening. */
const NoteParagraph = Paragraph.extend({
  renderMarkdown(node: JSONContent, helpers, context) {
    return escapeBlockStarts(this.parent?.(node, helpers, context) ?? '');
  },
});

const LINK = /(?<![\\!])\[([^\]\s]+)\]\(([^)\s]+)\)/g;

/** Whether `[text](href)` reads the same as the bare text, which GitHub-flavoured Markdown links. */
function isAutolink(text: string, href: string): boolean {
  if (/^https?:\/\//i.test(text)) return href === text;
  if (/^www\./i.test(text)) return href === `http://${text}`;
  return /^[^@]+@[^@]+\.[^@]+$/.test(text) && href === `mailto:${text}`;
}

/**
 * Links whose text is their own address go back to being bare, as they were typed or pasted
 * (`https://example.com`, `alex@example.com`), instead of `[https://example.com](https://example.com)`.
 * Code blocks and code spans are left exactly as they are.
 */
export function bareAutolinks(markdown: string): string {
  let fence: string | null = null;
  return markdown
    .split('\n')
    .map((line) => {
      const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(line)?.[1];
      if (fence) {
        if (marker && marker[0] === fence[0] && marker.length >= fence.length) fence = null;
        return line;
      }
      if (marker) {
        fence = marker;
        return line;
      }
      // Odd pieces are code spans.
      return line
        .split(/(`+[^`]*`+)/)
        .map((piece, index) =>
          index % 2 === 1
            ? piece
            : piece.replace(LINK, (link, text: string, href: string) => (isAutolink(text, href) ? text : link)),
        )
        .join('');
    })
    .join('\n');
}

/** ⌘L (Ctrl+L) edits the link under the cursor, or adds one, as in Raycast Notes. */
const LinkShortcut = Extension.create<{ open: () => void }>({
  name: 'linkShortcut',
  addOptions() {
    return { open: () => {} };
  },
  addKeyboardShortcuts() {
    return {
      'Mod-l': () => {
        this.options.open();
        return true;
      },
    };
  },
});

/** ⌘↵ (Ctrl+Enter) ticks or unticks the checklist item the cursor is in; elsewhere it's a line break. */
const TaskToggle = Extension.create({
  name: 'taskToggle',
  // Before the line break that ⌘↵ inserts otherwise.
  priority: 1000,
  addKeyboardShortcuts() {
    return {
      'Mod-Enter': () => {
        const { $from } = this.editor.state.selection;
        for (let depth = $from.depth; depth > 0; depth--) {
          const node = $from.node(depth);
          if (node.type.name !== 'taskItem') continue;
          const position = $from.before(depth);
          return this.editor.commands.command(({ tr }) => {
            tr.setNodeMarkup(position, undefined, { ...node.attrs, checked: !node.attrs.checked });
            return true;
          });
        }
        return false;
      },
    };
  },
});

/** Everything the Notes editor understands. */
export function noteExtensions({
  onLinkShortcut,
  slashKeys = { current: null },
}: {
  onLinkShortcut(): void;
  /** Where the / menu, while it's open, takes the keys it uses. */
  slashKeys?: { current: SlashKeys | null };
}): Extensions {
  return [
    StarterKit.configure({
      // All six levels, so headings from other apps survive; the toolbar offers three.
      heading: { levels: [1, 2, 3, 4, 5, 6] },
      // No Markdown for underlines, and a trailing empty line would be saved into the file.
      underline: false,
      trailingNode: false,
      paragraph: false,
      link: false,
    }),
    NoteParagraph,
    Link.configure({ openOnClick: false, autolink: true, linkOnPaste: true, defaultProtocol: 'https' }),
    TaskList,
    TaskItem.configure({ nested: true }),
    Placeholder.configure({ placeholder: 'Start writing...' }),
    Markdown.configure({ markedOptions: MARKED_OPTIONS }),
    LinkShortcut.configure({ open: onLinkShortcut }),
    TaskToggle,
    Find,
    SlashCommands.configure({ onKey: (key) => slashKeys.current?.onKey(key) ?? false }),
  ];
}

/**
 * Makes a Markdown manager write notes the way they were written: gentler escaping and bare
 * links. Call once on the editor's (or a test's) manager.
 */
export function applyNoteStyle(manager: MarkdownManager): void {
  // `encodeTextForMarkdown` is private in Tiptap's types; this pinned version calls it for
  // every text node outside code, which the tests check.
  const target = manager as unknown as {
    encodeTextForMarkdown(text: string, node: JSONContent, parent?: JSONContent): string;
    codeTypes: Set<string>;
  };
  const serialize = manager.serialize.bind(manager);
  manager.serialize = (doc) => bareAutolinks(serialize(doc));
  target.encodeTextForMarkdown = (text, node, parent) => {
    const inCode =
      (parent?.type !== undefined && target.codeTypes.has(parent.type)) ||
      (node.marks ?? []).some((mark) => target.codeTypes.has(typeof mark === 'string' ? mark : mark.type));
    return inCode ? text : escapeText(text);
  };
}

/** The words and numbers of a note, ignoring punctuation and entities, to spot anything lost. */
function substance(markdown: string): string {
  return markdown
    .replace(/&(?:#\d+|#x[\da-f]+|[a-z]+);/gi, '')
    .replace(/\[([^\]]*)\]\(\1\)/g, '$1')
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

/**
 * Whether the editor can show a note without losing anything when it's saved again. Front
 * matter, tables, images and the like aren't something it can show, and saving after any
 * edit would drop them, so those notes are edited as plain Markdown instead.
 */
export function showsFaithfully(manager: MarkdownManager, markdown: string): boolean {
  if (/^---\s*\r?\n/.test(markdown)) return false;
  let roundTrip: string;
  try {
    roundTrip = manager.serialize(manager.parse(markdown));
  } catch {
    return false;
  }
  return substance(roundTrip) === substance(markdown);
}
