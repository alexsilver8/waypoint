import type { KeyboardEvent, Ref } from 'react';
import type { DetailView as DetailViewData, Platform } from '../../../shared/types';
import { isModKey } from '../keys';
import { Markdown } from '../markdown';

interface KeyLike {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

/** How far one press of an arrow key scrolls the page. */
const LINE = 40;

/**
 * Where a key moves a page of text `height` pixels tall: by some pixels, or to its top or
 * bottom. `undefined` for keys that don't scroll.
 */
export function pageScroll(event: KeyLike, height: number, platform: Platform): number | 'top' | 'bottom' | undefined {
  const mod = isModKey(event, platform);
  const plain = !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey;
  const page = Math.max(LINE, Math.round(height * 0.85));
  switch (event.key) {
    case 'ArrowDown':
      if (mod && !event.shiftKey && !event.altKey) return 'bottom';
      return plain ? LINE : undefined;
    case 'ArrowUp':
      if (mod && !event.shiftKey && !event.altKey) return 'top';
      return plain ? -LINE : undefined;
    case 'PageDown':
      return plain ? page : undefined;
    case 'PageUp':
      return plain ? -page : undefined;
    case ' ':
      if (plain) return page;
      return event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey ? -page : undefined;
    case 'Home':
      return plain ? 'top' : undefined;
    case 'End':
      return plain ? 'bottom' : undefined;
    default:
      return undefined;
  }
}

/** Scrolls `element` for a key; says whether the key was one that scrolls. */
export function scrollPage(element: HTMLElement | null, event: KeyLike, platform: Platform): boolean {
  if (!element) return false;
  const move = pageScroll(event, element.clientHeight, platform);
  if (move === undefined) return false;
  if (move === 'top') element.scrollTop = 0;
  else if (move === 'bottom') element.scrollTop = element.scrollHeight;
  else element.scrollTop += move;
  return true;
}

interface DetailViewProps {
  view: DetailViewData;
  /** The part that scrolls, for the keys that scroll it. */
  scrollRef: Ref<HTMLDivElement>;
  onOpenLink(url: string): void;
  /** The launcher's keys, for when the page has the keyboard: after its text is picked out to copy. */
  onKeyDown(event: KeyboardEvent<HTMLElement>): void;
}

/** A page of Markdown filling the sheet, with its metadata in a column beside it. */
export function DetailView({ view, scrollRef, onOpenLink, onKeyDown }: DetailViewProps) {
  const metadata = view.metadata ?? [];
  return (
    <div className="page">
      {/* biome-ignore lint/a11y/noStaticElementInteractions: takes the keyboard when its text is picked out with the pointer */}
      <div ref={scrollRef} className="page__scroll" tabIndex={-1} onKeyDown={onKeyDown}>
        <article className="page__article" aria-label={view.title ?? 'Details'} aria-busy={view.loading || undefined}>
          {view.markdown ? (
            <Markdown source={view.markdown} onOpenLink={onOpenLink} />
          ) : (
            view.loading && <p className="page__loading">Loading…</p>
          )}
        </article>
      </div>
      {metadata.length > 0 && (
        <aside className="page__meta" aria-label="Information">
          <dl>
            {metadata.map((entry, index) => (
              // Labels needn't be unique, so the position is the key.
              <div key={index} className="page__meta-row">
                <dt>{entry.label}</dt>
                <dd>{entry.value}</dd>
              </div>
            ))}
          </dl>
        </aside>
      )}
    </div>
  );
}
