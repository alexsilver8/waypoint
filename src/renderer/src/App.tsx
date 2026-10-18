import { ChevronLeft } from 'lucide-react';
import { type KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Action, ActionContext, ActionResult, CommandRef, RootItem, View } from '../../shared/types';
import { ActionPanel } from './components/ActionPanel';
import { DetailPane } from './components/DetailPane';
import { Footer, type Toast } from './components/Footer';
import { Keycaps } from './components/Keycaps';
import { optionId, QUICK_KEY_COUNT, ResultList } from './components/ResultList';
import { ScopeDock } from './components/ScopeDock';
import { useWindowDrag } from './drag';
import { isModKey, matchesShortcut } from './keys';
import { type DisplayItem, type DisplaySection, filterView } from './model';
import { buildRootSections, countRootMatches, ROOT_FILTERS, type RootFilter } from './root-search';

const palette = window.palette;
const { platform } = palette;
const TOAST_MS = 2500;
const SEARCH_DEBOUNCE_MS = 120;
/** How often a list that's still loading is asked for again. */
const LOADING_REFRESH_MS = 1000;

/** One level of navigation: the root search, or a command's view pushed on top of it. */
interface Frame {
  /** Unique per pushed view, so late responses can tell whether their view is still showing. */
  id: number;
  ref?: CommandRef;
  view?: View;
  query: string;
  /** The query `view` was rendered for, for commands that filter by themselves. */
  viewQuery?: string;
  selectedId?: string;
  /** Root only: which kind of thing the search shows. */
  filter?: RootFilter;
}

const ROOT: Frame = { id: 0, query: '' };

const PLACEHOLDERS: Record<RootFilter, string> = {
  all: 'Search apps, commands and notes…',
  application: 'Search apps…',
  command: 'Search commands…',
  extensions: 'Search extensions and their commands…',
  note: 'Search notes…',
  clipboard: 'Search copied text…',
};

/** What a tab says when it has nothing to list yet. */
const EMPTY_TABS: Record<RootFilter, string> = {
  all: 'Loading apps and commands…',
  application: 'No apps found.',
  command: 'No commands.',
  extensions: 'No extensions yet. Run Open Extensions Folder to add one.',
  note: 'No notes yet. Run Create Note to write one.',
  clipboard: 'Nothing copied yet, or clipboard history is turned off in Settings.',
};

const MOD_KEY = platform === 'darwin' ? 'Meta' : 'Control';
const MOD_LABEL = platform === 'darwin' ? '⌘' : 'Ctrl';
let nextFrameId = 1;

function cleanError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
}

/** The nth row of a view as it would show for `query`. */
function nthItem(view: View, query: string, index: number): DisplayItem | undefined {
  return filterView(view, query).flatMap((section) => section.items)[index];
}

export function App() {
  const [rootItems, setRootItems] = useState<RootItem[]>([]);
  const [stack, setStack] = useState<Frame[]>([ROOT]);
  const [loading, setLoading] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  /** While ⌘ (Ctrl) is held, the rows in view show their quick keys. */
  const [modHeld, setModHeld] = useState(false);
  /** The first row in view: ⌘1 opens it, ⌘2 the one after, and so on. */
  const [firstInView, setFirstInView] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const launcher = useRef<HTMLDivElement>(null);
  const searchRequest = useRef(0);
  const busy = useRef(false);
  /** Whether the window is on screen, for lists that are still loading to wait while it isn't. */
  const onScreen = useRef(true);
  const panelOpenRef = useRef(false);
  const inflight = useRef<{ key: string; promise: Promise<View | undefined> } | null>(null);
  const stackRef = useRef(stack);
  stackRef.current = stack;

  useWindowDrag(launcher, palette);

  const frame = stack[stack.length - 1] ?? ROOT;
  const isRoot = stack.length === 1;

  const updateTop = useCallback((patch: Partial<Frame>) => {
    setStack((current) => [...current.slice(0, -1), { ...(current[current.length - 1] ?? ROOT), ...patch }]);
  }, []);

  const showToast = useCallback((text: string, style: Toast['style']) => {
    setToast({ id: Date.now(), text, style });
  }, []);

  const focusInput = useCallback((select = false) => {
    requestAnimationFrame(() => {
      input.current?.focus();
      if (select) input.current?.select();
    });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), TOAST_MS);
    return () => clearTimeout(timer);
  }, [toast]);

  // Clicks anywhere but a text field leave the keyboard with the search field, where every
  // shortcut lives. Buttons and rows still get their click.
  useEffect(() => {
    const keepFocus = (event: MouseEvent) => {
      if (!(event.target instanceof HTMLInputElement)) event.preventDefault();
    };
    document.addEventListener('mousedown', keepFocus);
    return () => document.removeEventListener('mousedown', keepFocus);
  }, []);

  // Root items: on start, whenever apps or extensions change, and each time the window opens
  // (so usage-based ranking is fresh).
  useEffect(() => {
    const load = () => {
      palette.getRootItems().then(setRootItems, (error: unknown) => showToast(cleanError(error), 'failure'));
    };
    load();
    const offChanged = palette.onRootItemsChanged(load);
    const offToast = palette.onToast((message) => showToast(message.text, message.style));
    const offHidden = palette.onHidden(() => {
      onScreen.current = false;
    });
    const offShown = palette.onShown(({ reset }) => {
      onScreen.current = true;
      load();
      setPanelOpen(false);
      if (reset) {
        searchRequest.current++;
        setStack([ROOT]);
      }
      focusInput(true);
    });
    return () => {
      offChanged();
      offToast();
      offHidden();
      offShown();
    };
  }, [focusInput, showToast]);

  const filter: RootFilter = isRoot ? (frame.filter ?? 'all') : 'all';
  const sections: DisplaySection[] = useMemo(() => {
    if (isRoot || !frame.view) return buildRootSections(rootItems, frame.query, filter);
    return filterView(frame.view, frame.query);
  }, [isRoot, rootItems, frame.view, frame.query, filter]);
  const counts = useMemo(
    () => (isRoot && frame.query.trim() ? countRootMatches(rootItems, frame.query) : null),
    [isRoot, rootItems, frame.query],
  );

  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === MOD_KEY) setModHeld(event.type === 'keydown');
    };
    const release = () => setModHeld(false);
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);
    window.addEventListener('blur', release);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
      window.removeEventListener('blur', release);
    };
  }, []);

  const items = useMemo(() => sections.flatMap((section) => section.items), [sections]);
  const showDetail = useMemo(() => items.some((item) => item.detail), [items]);
  const selectedIndex = Math.max(
    0,
    items.findIndex((item) => item.id === frame.selectedId),
  );
  const selected: DisplayItem | undefined = items[selectedIndex];

  /**
   * Asks a self-filtering command for its view of `query`, and shows it if that view is
   * still on top and no newer request was made. Returns the view when it was applied. The
   * selection goes back to the first row, as for new results, unless `keepSelection`.
   */
  const refreshView = useCallback(
    (frameId: number, ref: CommandRef, query: string, keepSelection = false): Promise<View | undefined> => {
      // ↵ and the debounce timer may ask for the same thing; share one request.
      const key = `${frameId}\u0000${query}`;
      if (inflight.current?.key === key) return inflight.current.promise;

      const request = ++searchRequest.current;
      const isCurrent = () =>
        request === searchRequest.current && stackRef.current[stackRef.current.length - 1]?.id === frameId;
      setLoading(true);
      const promise = (async () => {
        try {
          const view = await palette.searchView(ref, query);
          if (!isCurrent()) return undefined;
          updateTop({ view, viewQuery: query, ...(keepSelection ? {} : { selectedId: undefined }) });
          return view;
        } catch (error) {
          if (isCurrent()) showToast(cleanError(error), 'failure');
          return undefined;
        } finally {
          if (request === searchRequest.current) setLoading(false);
          if (inflight.current?.key === key) inflight.current = null;
        }
      })();
      inflight.current = { key, promise };
      return promise;
    },
    [updateTop, showToast],
  );

  // Commands that filter by themselves get asked again as the query changes.
  const selfFiltering = !isRoot && frame.view?.filtering === false;
  const stale = selfFiltering && frame.query !== frame.viewQuery;
  const { id: frameId, ref: frameRef, query: frameQuery } = frame;
  useEffect(() => {
    if (!stale || !frameRef) return;
    const timer = setTimeout(() => void refreshView(frameId, frameRef, frameQuery), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [stale, frameId, frameRef, frameQuery, refreshView]);

  // A list that's still loading is asked for again every second until it's done. A row picked
  // with the arrows or the pointer stays picked as the rows move; otherwise the first row is.
  // Nothing changes under an open action panel or while an action runs.
  const listLoading = !isRoot && frame.view?.loading === true;
  const refreshing = listLoading && !stale && !panelOpen;
  panelOpenRef.current = panelOpen;
  useEffect(() => {
    if (!refreshing || !frameRef) return;
    let asking = false;
    const timer = setInterval(async () => {
      if (asking || busy.current || inflight.current || !onScreen.current) return;
      asking = true;
      const request = searchRequest.current;
      try {
        const view = await palette.searchView(frameRef, frameQuery);
        const top = stackRef.current[stackRef.current.length - 1];
        // Not if anything happened meanwhile: a new search, an action, or the action panel opening
        // on the row that's selected.
        const current =
          request === searchRequest.current &&
          top?.id === frameId &&
          top.query === frameQuery &&
          !busy.current &&
          !panelOpenRef.current;
        if (current) updateTop({ view, viewQuery: frameQuery });
      } catch (error) {
        clearInterval(timer);
        showToast(cleanError(error), 'failure');
      } finally {
        asking = false;
      }
    }, LOADING_REFRESH_MS);
    return () => clearInterval(timer);
  }, [refreshing, frameId, frameRef, frameQuery, updateTop, showToast]);

  const applyResult = useCallback(
    (result: ActionResult, action: Action, from: Frame) => {
      if (result.hide) {
        // The main process already hid the window; open fresh next time.
        searchRequest.current++;
        setStack([ROOT]);
        setPanelOpen(false);
        return;
      }
      const search = result.clearSearch ? '' : result.search;
      if (result.push || result.replace || search !== undefined || result.pop) searchRequest.current++;
      setStack((current) => {
        // Gone back from the list it came from while it ran: what it changes there doesn't belong
        // in the list showing now.
        if (current[current.length - 1]?.id !== from.id) return current;
        let next = current;
        if (result.pop && next.length > 1) next = next.slice(0, -1);
        const top = next[next.length - 1] ?? ROOT;
        if (result.replace || search !== undefined) {
          const query = search ?? top.query;
          next = [
            ...next.slice(0, -1),
            { ...top, query, ...(result.replace ? { view: result.replace, viewQuery: query } : {}) },
          ];
        }
        if (result.push) {
          const opened = action.type === 'open-command';
          const query = opened ? (action.argument ?? '') : '';
          const ref = opened ? action.ref : from.ref;
          next = [...next, { id: nextFrameId++, ref, view: result.push, query, viewQuery: query }];
        }
        return next;
      });
      if (result.toast) showToast(result.toast, result.toastStyle ?? 'success');
    },
    [showToast],
  );

  const run = useCallback(
    async (item: DisplayItem | undefined, action: Action | undefined, from: Frame = frame) => {
      // One action at a time: a double ↵ must not push twice or delete twice.
      if (!item || !action || busy.current) return;
      busy.current = true;
      setPanelOpen(false);
      const context: ActionContext = { query: from.query };
      if (from.ref) context.ref = from.ref;
      if (item.rootItemId) context.rootItemId = item.rootItemId;
      setLoading(true);
      try {
        applyResult(await palette.runAction(action, context), action, from);
      } catch (error) {
        showToast(cleanError(error), 'failure');
      } finally {
        busy.current = false;
        setLoading(false);
        focusInput();
      }
    },
    [frame, applyResult, showToast, focusInput],
  );

  /** The same as running Open Settings: ⌘, and clicking Waypoint in the footer. */
  const openSettings = () =>
    void run(
      { id: 'settings', title: 'Settings', actions: [] },
      { type: 'open-command', ref: { extension: 'waypoint', command: 'settings' } },
    );

  /**
   * Runs an action of a row: the selected one for ↵ / ⌘↵, or the one at `index` for ⌘1–9. If a
   * self-filtering list hasn't caught up with the typing yet, waits for it first, so the row
   * that runs is the one for what was typed.
   */
  const activate = async (pick: (item: DisplayItem) => Action | undefined, index?: number) => {
    if (stale && frameRef) {
      if (busy.current) return;
      const from = frame;
      const view = await refreshView(from.id, frameRef, from.query);
      if (!view) return;
      const target = nthItem(view, from.query, index ?? 0);
      void run(target, target && pick(target), { ...from, view, viewQuery: from.query });
      return;
    }
    const target = index === undefined ? selected : items[index];
    void run(target, target && pick(target));
  };

  const pop = useCallback(() => {
    const current = stackRef.current;
    searchRequest.current++;
    setLoading(false);
    setPanelOpen(false);
    setStack((stack) => (stack.length > 1 ? stack.slice(0, -1) : stack));
    // Back in a list that builds itself from the search, from something its own extension opened:
    // what was done there may have changed it, like a file moved to the Trash from a folder in
    // Disk Usage, so it's asked for again.
    const [below, top] = current.slice(-2);
    if (below?.ref && below.view?.filtering === false && below.ref.extension === top?.ref?.extension) {
      void refreshView(below.id, below.ref, below.query, true);
    }
    focusInput();
  }, [focusInput, refreshView]);

  /** Picks what the root search shows; from a command's view, goes back to the search first. */
  const pickScope = (next: RootFilter) => {
    if (isRoot) {
      updateTop({ filter: next, selectedId: undefined });
    } else {
      searchRequest.current++;
      setLoading(false);
      setPanelOpen(false);
      setStack([{ ...ROOT, filter: next }]);
    }
    focusInput();
  };

  const move = (delta: number) => {
    const next = items[Math.min(items.length - 1, Math.max(0, selectedIndex + delta))];
    if (next) updateTop({ selectedId: next.id });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    // Keys that pick or confirm an input-method candidate aren't ours.
    if (event.nativeEvent.isComposing) return;
    // A held ↵ repeats: that mustn't run the next view's first item too, like Restart Now.
    if (event.key === 'Enter' && event.repeat) {
      event.preventDefault();
      return;
    }
    const mod = isModKey(event, platform);
    const key = event.key;
    const plain = !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey;

    // The selected item's own shortcuts win over the launcher's.
    const keys = {
      key: event.key,
      metaKey: event.metaKey,
      ctrlKey: event.ctrlKey,
      shiftKey: event.shiftKey,
      altKey: event.altKey,
    };
    const byShortcut = (item: DisplayItem) =>
      item.actions.find((a) => a.shortcut && matchesShortcut(keys, a.shortcut, platform));
    const shortcutAction = selected && byShortcut(selected);
    // By physical key, so it works on layouts where the digits need Shift (AZERTY).
    const digit = /^(?:Digit|Numpad)([1-9])$/.exec(event.code)?.[1];
    const quickKey = mod && !event.shiftKey && !event.altKey && digit ? Number(digit) : 0;
    if (shortcutAction) {
      event.preventDefault();
      // Like ↵, waits for a list that builds itself from the search to catch up first.
      void activate(byShortcut);
    } else if (quickKey > 0 && quickKey <= QUICK_KEY_COUNT) {
      event.preventDefault();
      // Counted from the first row in view, like the numbers drawn beside the rows.
      void activate((item) => item.actions[0], firstInView + quickKey - 1);
    } else if (key === 'Tab' && isRoot && !mod && !event.altKey) {
      event.preventDefault();
      const index = ROOT_FILTERS.findIndex((f) => f.id === filter);
      const step = event.shiftKey ? -1 : 1;
      const next = ROOT_FILTERS[(index + step + ROOT_FILTERS.length) % ROOT_FILTERS.length];
      if (next) updateTop({ filter: next.id, selectedId: undefined });
    } else if (key === 'ArrowDown' || (event.ctrlKey && key === 'n')) {
      event.preventDefault();
      move(1);
    } else if (key === 'ArrowUp' || (event.ctrlKey && key === 'p')) {
      event.preventDefault();
      move(-1);
    } else if (key === 'Enter' && (plain || (mod && !event.shiftKey && !event.altKey))) {
      event.preventDefault();
      void activate((item) => item.actions[mod ? 1 : 0]);
    } else if (mod && key.toLowerCase() === 'k') {
      event.preventDefault();
      if (selected && selected.actions.length > 0) setPanelOpen((open) => !open);
    } else if (mod && key === ',') {
      event.preventDefault();
      openSettings();
    } else if (key === 'Escape' && plain) {
      event.preventDefault();
      if (!isRoot) pop();
      else if (frame.query) updateTop({ query: '', selectedId: undefined });
      else if (filter !== 'all') updateTop({ filter: 'all', selectedId: undefined });
      else palette.hide();
    } else if (key === 'Backspace' && plain && !isRoot && frame.query === '') {
      event.preventDefault();
      pop();
    }
  };

  const scopeLabel = ROOT_FILTERS.find((f) => f.id === filter)?.label;
  const scopeMatches = counts?.[filter] ?? 0;
  const placeholder = isRoot ? PLACEHOLDERS[filter] : (frame.view?.searchPlaceholder ?? 'Search…');
  const emptyText = isRoot
    ? frame.query
      ? `Nothing matches “${frame.query}”.`
      : EMPTY_TABS[filter]
    : loading
      ? undefined
      : (frame.view?.emptyText ?? (frame.query ? `Nothing matches “${frame.query}”.` : 'Nothing here yet.'));

  return (
    <div ref={launcher} className="launcher">
      <ScopeDock
        value={filter}
        counts={counts}
        inactive={!isRoot}
        platform={platform}
        onChange={pickScope}
        onSettings={openSettings}
      />

      <div className="launcher__main">
        <header className="search" data-loading={loading || listLoading || undefined}>
          {isRoot && (
            <svg className="search__icon" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M11 4a7 7 0 1 0 0 14a7 7 0 1 0 0-14z M20 20l-4.2-4.2" />
            </svg>
          )}
          {!isRoot && (
            <button type="button" className="search__back" onClick={pop} aria-label="Back">
              <ChevronLeft size={16} strokeWidth={2.25} />
            </button>
          )}
          {isRoot && filter !== 'all' && <span className="search__scope">{scopeLabel}</span>}
          <input
            ref={input}
            className="search__input"
            value={frame.query}
            placeholder={placeholder}
            onChange={(event) => updateTop({ query: event.target.value, selectedId: undefined })}
            onKeyDown={onKeyDown}
            role="combobox"
            aria-label={placeholder}
            aria-expanded="true"
            aria-controls="results"
            aria-activedescendant={selected ? optionId(selectedIndex) : undefined}
            aria-autocomplete="list"
            spellCheck={false}
            autoComplete="off"
            autoFocus
          />
          {!isRoot && frame.view?.title && <span className="search__crumb">{frame.view.title}</span>}
          {isRoot && !frame.query && (
            <span className="search__hint">
              <Keycaps keys={[platform === 'darwin' ? '⇥' : 'Tab']} />
              Scope
            </span>
          )}
          {isRoot && scopeMatches > 0 && (
            <span className="search__hint">
              {scopeMatches} {scopeMatches === 1 ? 'result' : 'results'}
            </span>
          )}
        </header>

        <section className="sheet">
          <main className="content" data-detail={showDetail || undefined}>
            <div className="content__list">
              <ResultList
                sections={sections}
                selectedId={selected?.id}
                resultsKey={`${frame.id}\u0000${filter}\u0000${frame.query}\u0000${frame.viewQuery ?? ''}`}
                picked={frame.selectedId !== undefined}
                enterKey={platform === 'darwin' ? '↵' : 'Enter'}
                emptyText={emptyText}
                quickKeyModifier={modHeld ? MOD_LABEL : null}
                quickKeyStart={firstInView}
                onFirstInViewChange={setFirstInView}
                onSelect={(item) => updateTop({ selectedId: item.id })}
                onActivate={(item) => void run(item, item.actions[0])}
              />
            </div>
            {showDetail && <DetailPane item={selected} />}
          </main>

          <Footer
            platform={platform}
            context={isRoot ? 'Waypoint' : (frame.view?.title ?? 'Waypoint')}
            onOpenSettings={isRoot ? openSettings : undefined}
            toast={toast}
            primary={selected?.actions[0]}
            hasActions={Boolean(selected && selected.actions.length > 0)}
            onPrimary={() => void run(selected, selected?.actions[0])}
            onToggleActions={() => setPanelOpen((open) => !open)}
          />
        </section>
      </div>

      {panelOpen && selected && (
        <ActionPanel
          item={selected}
          platform={platform}
          onRun={(action) => void run(selected, action)}
          onClose={() => {
            setPanelOpen(false);
            focusInput();
          }}
        />
      )}
    </div>
  );
}
