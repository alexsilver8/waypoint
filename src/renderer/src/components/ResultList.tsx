import { ArrowRight } from 'lucide-react';
import { type CSSProperties, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Platform } from '../../../shared/types';
import { acceleratorKeys } from '../accelerator';
import type { DisplayItem, DisplaySection } from '../model';
import { Highlight } from './Highlight';
import { ItemIcon, tintOf } from './ItemIcon';
import { Keycaps } from './Keycaps';

/** ⌘1 to ⌘9 open the first nine rows in view. */
export const QUICK_KEY_COUNT = 9;

/**
 * Lists longer than this only draw the rows in view (plus a margin), so thousands of emoji or
 * clipboard entries open as fast as ten. Heights match styles.css.
 */
export const VIRTUAL_AFTER = 150;
const HEADING_HEIGHT = 28;
const ROW_HEIGHT = 44;
const CALC_HEIGHT = 92;
const OVERSCAN = 420;
/** Room kept between the selected row and the list's edge, like `scroll-padding` in styles.css. */
const SCROLL_GAP = 8;

interface ResultListProps {
  sections: DisplaySection[];
  selectedId: string | undefined;
  /**
   * Changes when the rows are new results (another search, another list), rather than the same
   * ones drawn again as a list fills in. Only new results move the list to the selected row.
   */
  resultsKey: string;
  /** Whether the selected row was picked, with the arrows or the pointer, rather than being first. */
  picked: boolean;
  /** The key that runs the selected row, drawn at its end ("↵", or "Enter" off the Mac). */
  enterKey: string;
  /** How a command's own shortcut is drawn. */
  platform: Platform;
  emptyText: string | undefined;
  /** The modifier to draw beside the rows in view while it's held, e.g. "⌘". */
  quickKeyModifier: string | null;
  /** The row ⌘1 stands for (the first one in view); ⌘2 is the next, and so on. */
  quickKeyStart: number;
  /** Reports the first row in view as the list scrolls or changes. */
  onFirstInViewChange(index: number): void;
  onSelect(item: DisplayItem): void;
  onActivate(item: DisplayItem): void;
}

export const optionId = (index: number) => `option-${index}`;

/** The first row at least half in view, counting from 0. */
function firstRowInView(list: HTMLElement, scroller: HTMLElement): number {
  const top = scroller.getBoundingClientRect().top;
  // Rows are in list order, and long lists only draw the ones near the view.
  for (const node of list.querySelectorAll<HTMLElement>('[role="option"]')) {
    const box = node.getBoundingClientRect();
    if (box.top + box.height / 2 >= top) return Number(node.getAttribute('aria-posinset')) - 1;
  }
  return 0;
}

interface RowProps {
  item: DisplayItem;
  quickKey: string[] | null;
  /** Drawn on the selected row only, where ↵ runs it; hidden while the quick keys show. */
  enterKey: string | null;
  platform: Platform;
}

function Row({ item, quickKey, enterKey, platform }: RowProps) {
  if (item.calculator) {
    // A card: the sum on the left, the answer large on the right.
    return (
      <span className="calc">
        <span className="calc__side">
          <span className="calc__expression">{item.calculator.expression}</span>
          <span className="calc__label" aria-hidden="true">
            Expression
          </span>
        </span>
        <ArrowRight className="calc__arrow" size={22} strokeWidth={2} aria-hidden="true" />
        <span className="visually-hidden">equals</span>
        <span className="calc__side calc__side--result">
          <span className="calc__result">{item.calculator.result}</span>
          <span className="calc__label" aria-hidden="true">
            Answer
          </span>
        </span>
      </span>
    );
  }
  return (
    <>
      <ItemIcon icon={item.icon} />
      <span className="row__text">
        <span className="row__title">
          <Highlight text={item.title} positions={item.titlePositions} />
        </span>
        {item.subtitle && <span className="row__subtitle">{item.subtitle}</span>}
      </span>
      {quickKey ? (
        <Keycaps keys={quickKey} />
      ) : (
        <>
          {item.hotkey && (
            <span className="row__hotkey" title="Runs it from anywhere">
              <Keycaps keys={acceleratorKeys(item.hotkey, platform)} />
            </span>
          )}
          {item.accessory && <span className="row__accessory">{item.accessory}</span>}
        </>
      )}
      {enterKey && !quickKey && <Keycaps keys={[enterKey]} />}
    </>
  );
}

type Entry =
  | { kind: 'heading'; key: string; title: string; top: number }
  | { kind: 'row'; item: DisplayItem; index: number; top: number; height: number };

/** Where every heading and row sits, for drawing just the ones in view. */
function layOut(sections: DisplaySection[]): { entries: Entry[]; height: number; count: number } {
  const entries: Entry[] = [];
  let top = 0;
  let index = 0;
  sections.forEach((section, sectionIndex) => {
    if (section.title) {
      entries.push({ kind: 'heading', key: `heading-${sectionIndex}`, title: section.title, top });
      top += HEADING_HEIGHT;
    }
    for (const item of section.items) {
      const height = item.calculator ? CALC_HEIGHT : ROW_HEIGHT;
      entries.push({ kind: 'row', item, index, top, height });
      top += height;
      index += 1;
    }
  });
  return { entries, height: top, count: index };
}

export function ResultList({
  sections: allSections,
  selectedId,
  resultsKey,
  picked,
  enterKey,
  platform,
  emptyText,
  quickKeyModifier,
  quickKeyStart,
  onFirstInViewChange,
  onSelect,
  onActivate,
}: ResultListProps) {
  // A heading over nothing says nothing.
  const sections = useMemo(() => allSections.filter((section) => section.items.length > 0), [allSections]);
  const layout = useMemo(() => layOut(sections), [sections]);
  const virtual = layout.count > VIRTUAL_AFTER;

  const root = useRef<HTMLDivElement>(null);
  const rows = useRef(new Map<string, HTMLElement>());
  /** Where the list starts within its scrolling pane. */
  const offsetIn = (scroller: HTMLElement) =>
    (root.current?.getBoundingClientRect().top ?? 0) - scroller.getBoundingClientRect().top + scroller.scrollTop;
  const [viewport, setViewport] = useState({ top: 0, height: 600 });

  // Long lists follow the scroll position of the pane they're in.
  useLayoutEffect(() => {
    const scroller = root.current?.parentElement;
    if (!virtual || !scroller) return;
    const update = () => {
      setViewport({ top: scroller.scrollTop - offsetIn(scroller), height: scroller.clientHeight });
    };
    update();
    scroller.addEventListener('scroll', update, { passive: true });
    const resize = new ResizeObserver(update);
    resize.observe(scroller);
    return () => {
      scroller.removeEventListener('scroll', update);
      resize.disconnect();
    };
  }, [virtual]);

  // Keep the selected row in view as it moves. When the same results are drawn again (a list
  // that's still loading), a picked row is followed only if it was in view, and the first row
  // not at all, so a list scrolled by hand stays where it was put.
  const drawn = useRef<{ selectedId?: string; resultsKey?: string; layout?: typeof layout }>({});
  useLayoutEffect(() => {
    const before = drawn.current;
    drawn.current = { selectedId, resultsKey, layout };
    if (!selectedId) return;
    const scroller = root.current?.parentElement;
    if (scroller && before.layout && before.resultsKey === resultsKey) {
      if (!picked) return;
      if (before.selectedId === selectedId) {
        const was = before.layout.entries.find((e) => e.kind === 'row' && e.item.id === selectedId);
        if (was?.kind !== 'row') return;
        const top = was.top + offsetIn(scroller);
        if (top + was.height <= scroller.scrollTop || top >= scroller.scrollTop + scroller.clientHeight) return;
      }
    }
    if (!virtual) {
      const first = layout.entries.find((e) => e.kind === 'row');
      // Back at the first row, the list goes to the very top so its heading shows again.
      if (scroller && first?.kind === 'row' && first.item.id === selectedId) scroller.scrollTop = 0;
      else rows.current.get(selectedId)?.scrollIntoView({ block: 'nearest' });
      return;
    }
    const entry = layout.entries.find((e) => e.kind === 'row' && e.item.id === selectedId);
    if (!scroller || entry?.kind !== 'row') return;
    const top = entry.top + offsetIn(scroller);
    const bottom = top + entry.height;
    if (top < scroller.scrollTop + SCROLL_GAP) {
      scroller.scrollTop = entry.index === 0 ? 0 : top - SCROLL_GAP;
    } else if (bottom > scroller.scrollTop + scroller.clientHeight - SCROLL_GAP) {
      scroller.scrollTop = bottom - scroller.clientHeight + SCROLL_GAP;
    }
  }, [selectedId, resultsKey, picked, virtual, layout]);

  // ⌘1 opens the first row in view, so the numbers follow the scroll. Checked after every draw
  // (long lists redraw as they scroll, and the rows change as you type) and on scroll (short
  // lists don't redraw for it).
  const hasRows = sections.length > 0;
  useLayoutEffect(() => {
    const scroller = root.current?.parentElement;
    if (!hasRows || !scroller) return;
    const update = () => {
      if (root.current) onFirstInViewChange(firstRowInView(root.current, scroller));
    };
    scroller.addEventListener('scroll', update, { passive: true });
    return () => scroller.removeEventListener('scroll', update);
  }, [hasRows, onFirstInViewChange]);
  useLayoutEffect(() => {
    const scroller = root.current?.parentElement;
    onFirstInViewChange(root.current && scroller ? firstRowInView(root.current, scroller) : 0);
  });

  // Rows drawn last time are forgotten once they're gone.
  useEffect(() => {
    for (const [id, node] of rows.current) if (!node.isConnected) rows.current.delete(id);
  });

  if (sections.length === 0) {
    return <div className="empty">{emptyText}</div>;
  }

  const option = (item: DisplayItem, index: number, style?: CSSProperties) => {
    const selected = item.id === selectedId;
    return (
      <div
        key={item.id}
        id={optionId(index)}
        ref={(node) => {
          if (node) rows.current.set(item.id, node);
        }}
        role="option"
        aria-selected={selected}
        aria-posinset={index + 1}
        aria-setsize={layout.count}
        className={item.calculator ? 'row row--calc' : 'row'}
        data-tint={tintOf(item.icon)}
        style={style}
        onMouseMove={() => {
          if (!selected) onSelect(item);
        }}
        onClick={() => onActivate(item)}
      >
        <Row
          item={item}
          platform={platform}
          enterKey={selected && !quickKeyModifier ? enterKey : null}
          quickKey={
            quickKeyModifier && index >= quickKeyStart && index < quickKeyStart + QUICK_KEY_COUNT
              ? [quickKeyModifier, String(index - quickKeyStart + 1)]
              : null
          }
        />
      </div>
    );
  };

  if (virtual) {
    const from = viewport.top - OVERSCAN;
    const to = viewport.top + viewport.height + OVERSCAN;
    const shown = layout.entries.filter(
      (entry) =>
        (entry.top + (entry.kind === 'row' ? entry.height : HEADING_HEIGHT) >= from && entry.top <= to) ||
        // The selected row stays drawn, so the search field can point at it.
        (entry.kind === 'row' && entry.item.id === selectedId),
    );
    return (
      <div
        ref={root}
        className="results results--virtual"
        id="results"
        role="listbox"
        aria-label="Results"
        style={{ height: layout.height }}
      >
        {shown.map((entry) =>
          entry.kind === 'heading' ? (
            <h2 key={entry.key} className="results__heading" style={{ top: entry.top }}>
              {entry.title}
            </h2>
          ) : (
            option(entry.item, entry.index, { top: entry.top })
          ),
        )}
      </div>
    );
  }

  let index = -1;
  return (
    <div ref={root} className="results" id="results" role="listbox" aria-label="Results">
      {sections.map((section, sectionIndex) => (
        // biome-ignore lint/a11y/useSemanticElements: groups the options of an ARIA listbox
        <div key={sectionIndex} className="results__section" role="group" aria-label={section.title}>
          {section.title && <h2 className="results__heading">{section.title}</h2>}
          {section.items.map((item) => {
            index += 1;
            return option(item, index);
          })}
        </div>
      ))}
    </div>
  );
}
