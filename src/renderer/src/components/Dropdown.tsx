import { Check, ChevronsUpDown } from 'lucide-react';
import {
  type CSSProperties,
  type KeyboardEvent,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { rankItems } from '../../../shared/search';
import type { Icon } from '../../../shared/types';
import { ItemIcon } from './ItemIcon';

export interface DropdownOption {
  value: string;
  title: string;
  icon?: Icon;
}

interface DropdownProps {
  id: string;
  options: DropdownOption[];
  value: string;
  /** The label's id, which names the dropdown. */
  labelledBy: string;
  describedBy?: string;
  onChange(value: string): void;
}

/** Room kept between the list and the window's edge. */
const EDGE = 24;
const MAX_HEIGHT = 260;
/** The search field, an option and the list's padding, as styled in views.css. */
const FILTER_HEIGHT = 37;
const OPTION_HEIGHT = 32;
const LIST_PADDING = 10;

/**
 * A field to pick one of several options, drawn like the action panel: ↵, Space or an arrow key
 * opens it, typing narrows it down, ↵ picks and Esc closes it again.
 */
export function Dropdown({ id, options, value, labelledBy, describedBy, onChange }: DropdownProps) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const [index, setIndex] = useState(0);
  const [place, setPlace] = useState<CSSProperties>({});
  const trigger = useRef<HTMLButtonElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const listId = useId();
  const current = options.find((option) => option.value === value) ?? options[0];

  const shown = useMemo(
    () => (filter ? rankItems(options, filter).map((ranked) => ranked.item) : options),
    [options, filter],
  );

  const show = (typed = '') => {
    setFilter(typed);
    setIndex(
      typed
        ? 0
        : Math.max(
            0,
            options.findIndex((option) => option.value === current?.value),
          ),
    );
    setOpen(true);
  };

  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) trigger.current?.focus();
  };

  const pick = (option: DropdownOption | undefined) => {
    if (option) onChange(option.value);
    close(true);
  };

  // Opens below the field when it fits there, or else on whichever side has more room.
  const count = options.length;
  useLayoutEffect(() => {
    if (!open || !trigger.current) return;
    const box = trigger.current.getBoundingClientRect();
    const below = window.innerHeight - box.bottom - EDGE;
    const above = box.top - EDGE;
    const wanted = Math.min(MAX_HEIGHT, FILTER_HEIGHT + count * OPTION_HEIGHT + LIST_PADDING);
    const down = below >= wanted || below >= above;
    setPlace({
      left: box.left,
      width: box.width,
      maxHeight: Math.min(MAX_HEIGHT, down ? below : above),
      ...(down ? { top: box.bottom + 4 } : { bottom: window.innerHeight - box.top + 4 }),
    });
    search.current?.focus();
  }, [open, count]);

  // Scrolling the form would leave it behind.
  useEffect(() => {
    if (!open) return;
    const onScroll = (event: Event) => {
      if (!(event.target instanceof Node && search.current?.parentElement?.contains(event.target))) setOpen(false);
    };
    window.addEventListener('scroll', onScroll, true);
    return () => window.removeEventListener('scroll', onScroll, true);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    document.getElementById(`${listId}-${index}`)?.scrollIntoView({ block: 'nearest' });
  }, [open, index, listId]);

  const onTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const plain = !event.metaKey && !event.ctrlKey && !event.altKey;
    if (
      (plain && ['Enter', ' ', 'ArrowDown', 'ArrowUp'].includes(event.key)) ||
      (event.altKey && event.key === 'ArrowDown')
    ) {
      event.preventDefault();
      event.stopPropagation();
      if (!event.repeat) show();
    } else if (plain && event.key.length === 1 && event.key !== ' ') {
      // Typing on the field starts narrowing the list down.
      event.preventDefault();
      show(event.key);
    }
  };

  const onListKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return;
    const plain = !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setIndex((i) => Math.min(i + 1, shown.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setIndex((i) => Math.max(i - 1, 0));
    } else if (event.key === 'Enter' && plain) {
      event.preventDefault();
      event.stopPropagation();
      if (!event.repeat) pick(shown[index]);
    } else if (event.key === 'Escape' || event.key === 'Tab') {
      // Closes the list only, not the form.
      event.preventDefault();
      event.stopPropagation();
      close(true);
    }
  };

  return (
    <div className="dropdown">
      <button
        ref={trigger}
        id={id}
        type="button"
        className="form__input dropdown__button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-labelledby={`${labelledBy} ${id}`}
        aria-describedby={describedBy}
        data-field-control=""
        onClick={() => (open ? close(true) : show())}
        onKeyDown={onTriggerKeyDown}
      >
        {current?.icon && <ItemIcon icon={current.icon} />}
        <span className="dropdown__value">{current?.title}</span>
        <ChevronsUpDown className="dropdown__chevron" size={14} strokeWidth={2} aria-hidden="true" />
      </button>
      {open && (
        <div className="dropdown__popover" style={place}>
          <input
            ref={search}
            className="dropdown__filter"
            value={filter}
            placeholder="Search…"
            aria-label="Search options"
            aria-controls={listId}
            aria-activedescendant={shown[index] ? `${listId}-${index}` : undefined}
            spellCheck={false}
            autoComplete="off"
            onChange={(event) => {
              setFilter(event.target.value);
              setIndex(0);
            }}
            onKeyDown={onListKeyDown}
            onBlur={() => setOpen(false)}
          />
          <div id={listId} className="dropdown__list" role="listbox" aria-labelledby={labelledBy}>
            {shown.map((option, i) => (
              <div
                key={option.value}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === index}
                className="dropdown__option"
                onMouseMove={() => setIndex(i)}
                onClick={() => pick(option)}
              >
                {option.icon && <ItemIcon icon={option.icon} />}
                <span className="dropdown__label">{option.title}</span>
                {option.value === current?.value && (
                  <Check className="dropdown__check" size={14} strokeWidth={2.25} aria-hidden="true" />
                )}
              </div>
            ))}
            {shown.length === 0 && <div className="dropdown__none">No matching options</div>}
          </div>
        </div>
      )}
    </div>
  );
}
