import { ChevronLeft } from 'lucide-react';
import { type KeyboardEvent, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { commandItemId } from '../../shared/command-hotkeys';
import type { CommandRequest } from '../../shared/ipc';
import type { Action, ActionContext, ActionResult, CommandRef, RootItem, View } from '../../shared/types';
import { ActionPanel } from './components/ActionPanel';
import { DetailPane } from './components/DetailPane';
import { DetailView, scrollPage } from './components/DetailView';
import { Footer, type Toast } from './components/Footer';
import { type FormHandle, FormView } from './components/FormView';
import { Keycaps } from './components/Keycaps';
import { optionId, QUICK_KEY_COUNT, ResultList } from './components/ResultList';
import { ScopeDock } from './components/ScopeDock';
import { useWindowDrag } from './drag';
import { type FormState, formValues, isSubmitAction, missingFields } from './form';
import { isModKey, matchesShortcut, shortcutKeys } from './keys';
import { type DisplayItem, type DisplaySection, filterView, pageItem } from './model';
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
  /** A form's values, once something was typed or picked. */
  form?: FormState;
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
const ENTER_LABEL = platform === 'darwin' ? '↵' : 'Enter';

/** In a form, ⌘↵ submits (↵ is the fields'), and the other actions have only their own shortcuts. */
function formActionKeys(action: Action, index: number): string[] | undefined {
  if (index === 0) return [MOD_LABEL, ENTER_LABEL];
  return action.shortcut ? shortcutKeys(action.shortcut, platform) : undefined;
}

let nextFrameId = 1;

function cleanError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
}

/** The nth row of a view as it would show for `query`. */
function nthItem(view: View, query: string, index: number): DisplayItem | undefined {
  if (view.type !== 'list') return undefined;
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
  /** The open form, which has the keyboard in place of the search field. */
  const formHandle = useRef<FormHandle>(null);
  /** The text of an open detail view, which the arrow and page keys scroll. */
  const page = useRef<HTMLDivElement>(null);
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
      // A form keeps the keyboard in its fields, unless it has none.
      if (formHandle.current?.focus()) return;
      input.current?.focus();
      if (select) input.current?.select();
    });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), TOAST_MS);
    return () => clearTimeout(timer);
  }, [toast]);

  // Clicks anywhere but a text field leave the keyboard with the search field (or the form's
  // field), where every shortcut lives. Buttons and rows still get their click.
  useEffect(() => {
    const keepFocus = (event: MouseEvent) => {
      if (!(event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement)) {
        event.preventDefault();
      }
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
    return frame.view.type === 'list' ? filterView(frame.view, frame.query) : [];
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

  // A detail view or a form fills the sheet in place of a list; its actions are those of one item.
  const pageView = !isRoot && frame.view?.type !== 'list' ? frame.view : undefined;
  // Without a title of its own, a page is called after its command.
  const commandId =
    pageView && !pageView.title && frame.ref ? `command:${frame.ref.extension}/${frame.ref.command}` : '';
  const commandTitle = useMemo(
    () => (commandId ? rootItems.find((item) => item.id === commandId)?.title : undefined),
    [commandId, rootItems],
  );
  const pageTitle = pageView?.title ?? commandTitle ?? '';
  const pageEntry = useMemo(() => pageView && pageItem(pageView, pageTitle), [pageView, pageTitle]);
  const formView = pageView?.type === 'form' ? pageView : undefined;
  const values = useMemo(() => formView && formValues(formView, frame.form?.values), [formView, frame.form]);
  // A form that closes takes the keyboard with it, whenever it closes: the search field has it back.
  useLayoutEffect(() => {
    if (!formView && (document.activeElement === document.body || !document.activeElement)) input.current?.focus();
  }, [formView]);

  const items = useMemo(() => sections.flatMap((section) => section.items), [sections]);
  const showDetail = useMemo(() => items.some((item) => item.detail), [items]);
  const selectedIndex = Math.max(
    0,
    items.findIndex((item) => item.id === frame.selectedId),
  );
  const selected: DisplayItem | undefined = pageEntry ?? items[selectedIndex];

  /**
   * Asks a self-filtering command for its view of `query`, and shows it if that view is
   * still open and no newer request was made. Returns the view when it was applied. The
   * selection goes back to the first row, as for new results, unless `keepSelection`.
   */
  const refreshView = useCallback(
    (frameId: number, ref: CommandRef, query: string, keepSelection = false): Promise<View | undefined> => {
      // ↵ and the debounce timer may ask for the same thing; share one request.
      const key = `${frameId}\u0000${query}`;
      if (inflight.current?.key === key) return inflight.current.promise;

      const request = ++searchRequest.current;
      // Any step since (a search, going back or on) makes a newer request. The view needn't be on
      // top yet: going back by an action's result asks for the one below as the one above closes.
      const isCurrent = () => request === searchRequest.current && stackRef.current.some((f) => f.id === frameId);
      setLoading(true);
      const promise = (async () => {
        try {
          const view = await palette.searchView(ref, query);
          if (!isCurrent()) return undefined;
          const patch = { view, viewQuery: query, ...(keepSelection ? {} : { selectedId: undefined }) };
          setStack((current) => current.map((f) => (f.id === frameId ? { ...f, ...patch } : f)));
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
    [showToast],
  );

  // Commands that filter by themselves get asked again as the query changes.
  const selfFiltering = !isRoot && frame.view?.type === 'list' && frame.view.filtering === false;
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
  const listLoading = !isRoot && frame.view?.type !== 'form' && frame.view?.loading === true;
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

  /**
   * Back in a list that builds itself from the search, from something its own extension opened:
   * what was done there may have changed it, like a file moved to the Trash from a folder in Disk
   * Usage or a to-do added in a form, so it's asked for again, for `query` if its search changes.
   */
  const refreshBelow = useCallback(
    (current: Frame[], query?: string) => {
      const [below, top] = current.slice(-2);
      if (
        below?.ref &&
        below.view?.type === 'list' &&
        below.view.filtering === false &&
        below.ref.extension === top?.ref?.extension
      ) {
        void refreshView(below.id, below.ref, query ?? below.query, true);
      }
    },
    [refreshView],
  );

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
            // A form put in its place starts from its own defaults.
            { ...top, query, ...(result.replace ? { view: result.replace, viewQuery: query, form: undefined } : {}) },
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
      // Gone back by the result, as with ⌫.
      const current = stackRef.current;
      if (result.pop && !result.replace && current[current.length - 1]?.id === from.id) refreshBelow(current, search);
      if (result.toast) showToast(result.toast, result.toastStyle ?? 'success');
    },
    [showToast, refreshBelow],
  );

  const run = useCallback(
    async (item: DisplayItem | undefined, action: Action | undefined, from: Frame = frame) => {
      // One action at a time: a double ↵ must not push twice or delete twice.
      if (!item || !action || busy.current) return;
      let perform = action;
      if (isSubmitAction(action) && action.type === 'callback' && from.view?.type === 'form') {
        // A form is sent with its values, once every required field is filled in.
        const submitted = formValues(from.view, from.form?.values);
        const missing = missingFields(from.view, submitted);
        if (missing.length > 0) {
          setPanelOpen(false);
          updateTop({ form: { values: submitted, showMissing: true } });
          requestAnimationFrame(() => formHandle.current?.focusField(missing[0] as string));
          return;
        }
        perform = { ...action, payload: submitted };
      }
      busy.current = true;
      setPanelOpen(false);
      const context: ActionContext = { query: from.query };
      if (from.ref) context.ref = from.ref;
      if (item.rootItemId) context.rootItemId = item.rootItemId;
      setLoading(true);
      try {
        applyResult(await palette.runAction(perform, context), perform, from);
      } catch (error) {
        showToast(cleanError(error), 'failure');
      } finally {
        busy.current = false;
        setLoading(false);
        focusInput();
      }
    },
    [frame, applyResult, showToast, focusInput, updateTop],
  );

  /** Links in Markdown open the way an open-url action does, from the main process. */
  const openLink = useCallback(
    (url: string) => void run(selected ?? { id: 'link', title: url, actions: [] }, { type: 'open-url', url }),
    [run, selected],
  );

  /**
   * A command opened from outside (its own shortcut, `waypoint --command`): it opens from the root
   * search as if picked there. Pressed again while its view is in front, it closes the launcher.
   */
  const fromOutside = useRef<(request: CommandRequest) => void>(undefined);
  fromOutside.current = ({ ref, toggle, result }) => {
    const top = stackRef.current[stackRef.current.length - 1];
    if (toggle && !result && top?.ref?.extension === ref.extension && top.ref.command === ref.command) {
      palette.hide();
      return;
    }
    const action: Action = { type: 'open-command', ref };
    searchRequest.current++;
    setPanelOpen(false);
    setStack([ROOT]);
    if (result) applyResult(result, action, ROOT);
    else
      void run({ id: commandItemId(ref), title: '', actions: [action], rootItemId: commandItemId(ref) }, action, ROOT);
  };
  useEffect(() => palette.onRunCommand((request) => fromOutside.current?.(request)), []);

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
    refreshBelow(current);
    focusInput();
  }, [focusInput, refreshBelow]);

  /** Leaves every view a command opened, however deep, for the root search as `root` has it. */
  const showRoot = (root: Frame) => {
    searchRequest.current++;
    setLoading(false);
    setPanelOpen(false);
    setStack([root]);
    focusInput();
  };

  /** Picks what the root search shows; from a command's view, goes back to the search first. */
  const pickScope = (next: RootFilter) => {
    if (isRoot) {
      updateTop({ filter: next, selectedId: undefined });
      focusInput();
    } else {
      showRoot({ ...ROOT, filter: next });
    }
  };

  const move = (delta: number) => {
    const next = items[Math.min(items.length - 1, Math.max(0, selectedIndex + delta))];
    if (next) updateTop({ selectedId: next.id });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    // Keys that pick or confirm an input-method candidate aren't ours.
    if (event.nativeEvent.isComposing) return;
    // A form without fields leaves the keyboard here; its keys are still a form's.
    if (formView) return onFormKeyDown(event);
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
    } else if (pageView?.type === 'detail' && scrollPage(page.current, event, platform)) {
      // The arrows, Page Up and Down, Home and End scroll the text of a detail view.
      event.preventDefault();
    } else if (pageView && (quickKey > 0 || key === 'Tab')) {
      // Nothing to pick by number in a page, and the keyboard stays here.
      event.preventDefault();
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
      // Home first, from wherever you are: the root search as it opens, nothing typed and All
      // showing. Esc there closes the launcher. ⌫ and the back button go back one step instead.
      if (!isRoot) showRoot(ROOT);
      else if (frame.query || filter !== 'all') updateTop({ query: '', filter: 'all', selectedId: undefined });
      else palette.hide();
    } else if (key === 'Backspace' && plain && !isRoot && frame.query === '') {
      event.preventDefault();
      pop();
    }
  };

  /**
   * Keys pressed in a form's fields, which keep everything that types, moves the caret or deletes:
   * the launcher only takes ⌘↵ to submit, ⌘K, ⌘, and Esc, and the actions' shortcuts that use ⌘ or
   * Ctrl.
   */
  const onFormKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const mod = isModKey(event, platform);
    const plain = !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey;
    const shortcutAction = selected?.actions.find(
      (action) =>
        action.shortcut?.modifiers?.some((m) => m === 'mod' || m === 'ctrl') &&
        matchesShortcut(event, action.shortcut, platform),
    );
    if (event.key === 'Enter' && mod && !event.shiftKey && !event.altKey) {
      event.preventDefault();
      if (!event.repeat) void run(selected, selected?.actions[0]);
    } else if (shortcutAction) {
      event.preventDefault();
      void run(selected, shortcutAction);
    } else if (mod && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      setPanelOpen((open) => !open);
    } else if (mod && event.key === ',') {
      event.preventDefault();
      openSettings();
    } else if (event.key === 'Escape' && plain) {
      event.preventDefault();
      showRoot(ROOT);
    }
  };

  // A held ⌘ shows Settings' ⌘, as it shows the rows' quick keys, but not over the action panel, where ⌘, does nothing.
  const showSettingsShortcut = modHeld && !panelOpen;
  const scopeLabel = ROOT_FILTERS.find((f) => f.id === filter)?.label;
  const scopeMatches = counts?.[filter] ?? 0;
  const listView = frame.view?.type === 'list' ? frame.view : undefined;
  const placeholder = isRoot ? PLACEHOLDERS[filter] : (listView?.searchPlaceholder ?? 'Search…');
  const emptyText = isRoot
    ? frame.query
      ? `Nothing matches “${frame.query}”.`
      : EMPTY_TABS[filter]
    : loading
      ? undefined
      : (listView?.emptyText ?? (frame.query ? `Nothing matches “${frame.query}”.` : 'Nothing here yet.'));

  return (
    <div ref={launcher} className="launcher">
      <ScopeDock
        value={filter}
        counts={counts}
        inactive={!isRoot}
        showShortcut={showSettingsShortcut}
        platform={platform}
        onChange={pickScope}
        onSettings={openSettings}
      />

      <div className="launcher__main">
        <header className="search" data-loading={loading || listLoading || undefined} data-page={pageView?.type}>
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
            {...(pageView
              ? // Nothing to type in a detail view or a form: the field only takes their keys, out of sight.
                { readOnly: true, tabIndex: -1, 'aria-label': `${pageTitle || 'Details'}, ${MOD_LABEL} K for actions` }
              : {
                  role: 'combobox',
                  'aria-label': placeholder,
                  'aria-expanded': true,
                  'aria-controls': 'results',
                  'aria-activedescendant': selected ? optionId(selectedIndex) : undefined,
                  'aria-autocomplete': 'list' as const,
                })}
            spellCheck={false}
            autoComplete="off"
            autoFocus
          />
          {pageView
            ? pageTitle && <span className="search__crumb">{pageTitle}</span>
            : !isRoot && frame.view?.title && <span className="search__crumb">{frame.view.title}</span>}
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
            {pageView?.type === 'detail' && <DetailView view={pageView} scrollRef={page} onOpenLink={openLink} />}
            {formView && values && (
              <FormView
                ref={formHandle}
                view={formView}
                values={values}
                missing={frame.form?.showMissing ? missingFields(formView, values) : []}
                onChange={(id, value) =>
                  updateTop({ form: { showMissing: false, ...frame.form, values: { ...values, [id]: value } } })
                }
                onSubmit={() => void run(selected, selected?.actions[0])}
                onKeyDown={onFormKeyDown}
              />
            )}
            <div className="content__list" hidden={Boolean(pageView)}>
              <ResultList
                sections={sections}
                selectedId={selected?.id}
                resultsKey={`${frame.id}\u0000${filter}\u0000${frame.query}\u0000${frame.viewQuery ?? ''}`}
                picked={frame.selectedId !== undefined}
                enterKey={platform === 'darwin' ? '↵' : 'Enter'}
                platform={platform}
                emptyText={emptyText}
                quickKeyModifier={modHeld ? MOD_LABEL : null}
                quickKeyStart={firstInView}
                onFirstInViewChange={setFirstInView}
                onSelect={(item) => updateTop({ selectedId: item.id })}
                onActivate={(item) => void run(item, item.actions[0])}
              />
            </div>
            {showDetail && <DetailPane item={selected} onOpenLink={openLink} />}
          </main>

          <Footer
            platform={platform}
            context={isRoot ? 'Waypoint' : frame.view?.title || pageTitle || 'Waypoint'}
            onOpenSettings={isRoot ? openSettings : undefined}
            toast={toast}
            primary={selected?.actions[0]}
            primaryKeys={formView ? [MOD_LABEL, ENTER_LABEL] : undefined}
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
          keysFor={formView ? formActionKeys : undefined}
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
