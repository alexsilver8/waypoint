import {
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

export interface PopoverEntry {
  /** Unique within the popover. */
  key: string;
  disabled?: boolean;
}

export interface PopoverSection<T extends PopoverEntry> {
  key: string;
  /** A heading over the section. Untitled sections are set apart by a line, like Raycast's action groups. */
  title?: string;
  items: T[];
}

/** The tallest a popover gets before its list scrolls, as in Raycast. */
export const POPOVER_MAX_HEIGHT = 420;

export interface ListPopoverProps<T extends PopoverEntry> {
  label: string;
  placeholder: string;
  query: string;
  onQueryChange(query: string): void;
  sections: PopoverSection<T>[];
  renderItem(item: T, selected: boolean): ReactNode;
  onChoose(item: T): void;
  onClose(): void;
  /** In a submenu, Esc (or ⌫ with nothing typed) goes back instead of closing. */
  onBack?(): void;
  /** Extra keys for the selected item, like ⌃X to delete a note. Returns whether it handled the key. */
  onItemKey?(event: ReactKeyboardEvent<HTMLInputElement>, item: T | undefined): boolean;
  /** The item selected at first; otherwise the first one that isn't disabled. */
  initialKey?: string;
  /** Shown at the top of the list, above the sections. */
  header?: ReactNode;
  /** Shown when there's nothing to list. */
  empty?: ReactNode;
  /** The height the popover would like to be, so the window can make room for it. */
  onHeight?(height: number): void;
  className?: string;
  itemClassName?: string;
}

/**
 * A Raycast-style popover: a search field over a list you move through with ↑ and ↓ and pick
 * from with ↵. The pointer selects what it's over, as in Raycast.
 */
export function ListPopover<T extends PopoverEntry>({
  label,
  placeholder,
  query,
  onQueryChange,
  sections,
  renderItem,
  onChoose,
  onClose,
  onBack,
  onItemKey,
  initialKey,
  header,
  empty,
  onHeight,
  className,
  itemClassName,
}: ListPopoverProps<T>) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const items = useMemo(() => sections.flatMap((section) => section.items), [sections]);
  const firstEnabled = items.find((item) => !item.disabled)?.key;
  const selectable = (key: string | undefined) => items.some((item) => item.key === key && !item.disabled);
  // The selection belongs to the query it was made for. Typing starts over at the top, as in
  // Raycast, and an item that's gone hands over to the first one, worked out as the list is
  // drawn so a ↵ pressed straight after typing picks what's shown.
  const [selection, setSelection] = useState(() => ({
    key: initialKey && selectable(initialKey) ? initialKey : firstEnabled,
    query,
  }));
  const selectedKey = selection.query === query && selectable(selection.key) ? selection.key : firstEnabled;
  const setSelectedKey = (key: string) => setSelection({ key, query });

  const selected = items.find((item) => item.key === selectedKey);
  const optionId = (key: string) => `${id}-${key.replace(/[^\w-]/g, '_')}`;

  useEffect(() => input.current?.focus(), []);

  useLayoutEffect(() => {
    if (!selectedKey) return;
    document.getElementById(optionId(selectedKey))?.scrollIntoView({ block: 'nearest' });
  });

  // Report the height the popover would like, list and all, whenever its content changes.
  useLayoutEffect(() => {
    const element = root.current;
    const scroller = list.current;
    if (!element || !scroller || !onHeight) return;
    const measure = () => {
      const chrome = element.offsetHeight - scroller.clientHeight;
      onHeight(Math.min(POPOVER_MAX_HEIGHT, chrome + scroller.scrollHeight));
    };
    measure();
    const observer = new ResizeObserver(measure);
    for (const child of scroller.children) observer.observe(child);
    return () => observer.disconnect();
  });

  const move = (step: number) => {
    const enabled = items.filter((item) => !item.disabled);
    if (enabled.length === 0) return;
    const index = enabled.findIndex((item) => item.key === selectedKey);
    const next = enabled[index === -1 ? 0 : Math.min(enabled.length - 1, Math.max(0, index + step))];
    if (next) setSelectedKey(next.key);
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (onItemKey?.(event, selected)) {
      event.preventDefault();
      return;
    }
    const plain = !event.metaKey && !event.ctrlKey && !event.altKey;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      move(event.key === 'ArrowDown' ? 1 : -1);
    } else if (plain && (event.key === 'PageDown' || event.key === 'PageUp')) {
      event.preventDefault();
      move(event.key === 'PageDown' ? 8 : -8);
    } else if (event.key === 'Enter' && plain) {
      event.preventDefault();
      // A held ↵ repeats; only the first press picks.
      if (!event.repeat && selected && !selected.disabled) onChoose(selected);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      if (onBack && !query) onBack();
      else if (query) onQueryChange('');
      else onClose();
    } else if (event.key === 'Backspace' && !query && onBack && plain) {
      event.preventDefault();
      onBack();
    }
  };

  return (
    <div ref={root} className={`popover${className ? ` ${className}` : ''}`} role="dialog" aria-label={label}>
      <div className="popover__search">
        <input
          ref={input}
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          aria-label={placeholder.replace(/\.+$/, '')}
          role="combobox"
          aria-expanded="true"
          aria-controls={`${id}-list`}
          aria-activedescendant={selectedKey ? optionId(selectedKey) : undefined}
          spellCheck={false}
          autoComplete="off"
        />
      </div>
      <div ref={list} id={`${id}-list`} className="popover__list" role="listbox" aria-label={label}>
        {header}
        {sections.map((section, index) =>
          section.items.length === 0 ? null : (
            <div key={section.key}>
              {section.title ? (
                <div className="popover__section" aria-hidden="true">
                  {section.title}
                </div>
              ) : (
                index > 0 && <div className="popover__separator" aria-hidden="true" />
              )}
              {section.items.map((item) => {
                const isSelected = item.key === selectedKey;
                return (
                  <div
                    key={item.key}
                    id={optionId(item.key)}
                    role="option"
                    aria-selected={isSelected}
                    aria-disabled={item.disabled || undefined}
                    className={`popover__item${itemClassName ? ` ${itemClassName}` : ''}`}
                    onMouseMove={() => {
                      if (!item.disabled && !isSelected) setSelectedKey(item.key);
                    }}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => {
                      if (!item.disabled) onChoose(item);
                    }}
                  >
                    {renderItem(item, isSelected)}
                  </div>
                );
              })}
            </div>
          ),
        )}
        {items.length === 0 && empty}
      </div>
    </div>
  );
}
