import type { Editor } from '@tiptap/react';
import { type CSSProperties, type RefObject, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { dismissEmoji, type EmojiEntry, loadEmoji, searchEmoji } from './emoji';
import { type InlineMatch, type MenuKeys, placeMenu } from './inline-menu';

const WIDTH = 240;
const ROW = 32;

/**
 * The emoji the colon offers, just below the line: ↑ ↓ to choose, ↵ or ⇥ to put it in place
 * of what you typed, Esc to keep the text. With nothing matching, it steps aside.
 */
export function EmojiMenu({
  editor,
  match,
  keys,
}: {
  editor: Editor;
  match: InlineMatch;
  keys: RefObject<MenuKeys | null>;
}) {
  const [entries, setEntries] = useState<EmojiEntry[] | null>(null);
  useEffect(() => {
    let current = true;
    void loadEmoji().then((loaded) => {
      if (current) setEntries(loaded);
    });
    return () => {
      current = false;
    };
  }, []);
  const items = useMemo(() => (entries ? searchEmoji(entries, match.query) : []), [entries, match.query]);
  const [selected, setSelected] = useState(0);
  const [query, setQuery] = useState(match.query);
  if (query !== match.query) {
    setQuery(match.query);
    setSelected(0);
  }

  const insert = (item: EmojiEntry) => {
    editor.chain().focus().insertContentAt({ from: match.from, to: match.to }, item.emoji).run();
  };

  // The editor passes it the keys it uses while it's open.
  useLayoutEffect(() => {
    keys.current = {
      onKey(key) {
        if (key === 'Escape') {
          dismissEmoji(editor);
          return true;
        }
        // Nothing matches: the keys do what they always do.
        if (items.length === 0) return false;
        if (key === 'ArrowDown' || key === 'ArrowUp') {
          setSelected((index) => (index + (key === 'ArrowDown' ? 1 : -1) + items.length) % items.length);
          return true;
        }
        const item = items[Math.min(selected, items.length - 1)];
        if (item) insert(item);
        return true;
      },
    };
    return () => {
      keys.current = null;
    };
  });

  if (items.length === 0) return null;
  const coords = editor.view.coordsAtPos(match.from);
  const style: CSSProperties = {
    ...placeMenu(
      coords,
      { width: WIDTH, height: items.length * ROW + 12 },
      { width: window.innerWidth, height: window.innerHeight },
    ),
    width: WIDTH,
  };
  return (
    <div className="toolbar__popover toolbar__list inline-menu" style={style} role="listbox" aria-label="Emoji">
      {items.map((item, index) => (
        <div
          key={item.emoji}
          role="option"
          aria-selected={index === selected}
          ref={index === selected ? (row) => row?.scrollIntoView({ block: 'nearest' }) : undefined}
          className="toolbar__item inline-menu__item"
          onMouseMove={() => setSelected(index)}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => insert(item)}
        >
          <span className="inline-menu__emoji" aria-hidden="true">
            {item.emoji}
          </span>
          <span className="toolbar__item-label inline-menu__label">{item.code ? `:${item.code}:` : item.name}</span>
        </div>
      ))}
    </div>
  );
}
