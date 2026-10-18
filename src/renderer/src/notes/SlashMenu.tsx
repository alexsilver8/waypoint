import type { Editor } from '@tiptap/react';
import {
  Heading1,
  Heading2,
  Heading3,
  List,
  ListChecks,
  ListOrdered,
  type LucideIcon,
  Minus,
  Pilcrow,
  SquareCode,
  TextQuote,
} from 'lucide-react';
import { type CSSProperties, type RefObject, useLayoutEffect, useMemo, useState } from 'react';
import { rankItems } from '../../../shared/search';
import { type InlineMatch, type MenuKeys, placeMenu } from './inline-menu';
import { dismissSlash } from './slash';

interface SlashItem {
  title: string;
  keywords: string[];
  icon: LucideIcon;
  run(editor: Editor): void;
}

const ITEMS: SlashItem[] = [
  {
    title: 'Text',
    keywords: ['paragraph', 'plain'],
    icon: Pilcrow,
    run: (e) => e.chain().focus().setParagraph().run(),
  },
  ...([1, 2, 3] as const).map((level) => ({
    title: `Heading ${level}`,
    keywords: ['title', `h${level}`],
    icon: [Heading1, Heading2, Heading3][level - 1] ?? Heading1,
    run: (e: Editor) => e.chain().focus().setHeading({ level }).run(),
  })),
  {
    title: 'Bulleted List',
    keywords: ['unordered', 'bullets'],
    icon: List,
    run: (e) => e.chain().focus().toggleBulletList().run(),
  },
  {
    title: 'Numbered List',
    keywords: ['ordered', 'numbers'],
    icon: ListOrdered,
    run: (e) => e.chain().focus().toggleOrderedList().run(),
  },
  {
    title: 'Checklist',
    keywords: ['todo', 'task', 'checkbox'],
    icon: ListChecks,
    run: (e) => e.chain().focus().toggleTaskList().run(),
  },
  { title: 'Quote', keywords: ['blockquote'], icon: TextQuote, run: (e) => e.chain().focus().setBlockquote().run() },
  {
    title: 'Code Block',
    keywords: ['code', 'snippet', 'pre'],
    icon: SquareCode,
    run: (e) => e.chain().focus().setCodeBlock().run(),
  },
  {
    title: 'Divider',
    keywords: ['horizontal rule', 'line', 'separator', 'hr'],
    icon: Minus,
    run: (e) => e.chain().focus().setHorizontalRule().run(),
  },
];

const WIDTH = 220;
const ROW = 32;

/**
 * The menu the / opens, just below the line: ↑ ↓ to choose, ↵ or ⇥ to turn the line into
 * it, Esc to leave the / as typed. With nothing matching what's typed, it steps aside.
 */
export function SlashMenu({
  editor,
  match,
  keys,
}: {
  editor: Editor;
  match: InlineMatch;
  keys: RefObject<MenuKeys | null>;
}) {
  const items = useMemo(() => rankItems(ITEMS, match.query).map((ranked) => ranked.item), [match.query]);
  const [selected, setSelected] = useState(0);
  const [query, setQuery] = useState(match.query);
  if (query !== match.query) {
    setQuery(match.query);
    setSelected(0);
  }

  const apply = (item: SlashItem) => {
    editor.chain().focus().deleteRange({ from: match.from, to: match.to }).run();
    item.run(editor);
  };

  // The editor passes it the keys it uses while it's open.
  useLayoutEffect(() => {
    keys.current = {
      onKey(key) {
        if (key === 'Escape') {
          dismissSlash(editor);
          return true;
        }
        // Nothing matches: ↵ makes a new line as usual.
        if (items.length === 0) return false;
        if (key === 'ArrowDown' || key === 'ArrowUp') {
          setSelected((index) => (index + (key === 'ArrowDown' ? 1 : -1) + items.length) % items.length);
          return true;
        }
        const item = items[Math.min(selected, items.length - 1)];
        if (item) apply(item);
        return true;
      },
    };
    return () => {
      keys.current = null;
    };
  });

  const coords = editor.view.coordsAtPos(match.from);
  const style: CSSProperties = {
    ...placeMenu(
      coords,
      { width: WIDTH, height: items.length * ROW + 12 },
      { width: window.innerWidth, height: window.innerHeight },
    ),
    width: WIDTH,
  };

  if (items.length === 0) return null;
  return (
    <div className="toolbar__popover toolbar__list inline-menu" style={style} role="listbox" aria-label="Format as">
      {items.map((item, index) => (
        <div
          key={item.title}
          role="option"
          aria-selected={index === selected}
          ref={index === selected ? (row) => row?.scrollIntoView({ block: 'nearest' }) : undefined}
          className="toolbar__item inline-menu__item"
          onMouseMove={() => setSelected(index)}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => apply(item)}
        >
          <span className="toolbar__item-icon" aria-hidden="true">
            <item.icon size={15} />
          </span>
          <span className="toolbar__item-label">{item.title}</span>
        </div>
      ))}
    </div>
  );
}
