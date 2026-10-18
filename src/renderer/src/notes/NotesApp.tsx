import { DOMSerializer, type Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { Editor } from '@tiptap/react';
import {
  Bold,
  Code,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  Link,
  List,
  ListChecks,
  ListOrdered,
  Minus,
  Pilcrow,
  SquareCode,
  Strikethrough,
  TextQuote,
} from 'lucide-react';
import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  browseSections,
  clampZoom,
  DEFAULT_NOTES_STATE,
  type ExportFormat,
  type Note,
  type NotesWindowState,
  noteDeeplink,
  noteLength,
  noteTitle,
  toPlainText,
} from '../../../shared/notes';
import type { Shortcut } from '../../../shared/types';
import { shortcutKeys } from '../keys';
import { type NoteAction, type NoteActionGroup, noteActions } from './actions';
import { BrowseNotes } from './BrowseNotes';
import { FindBar } from './FindBar';
import { historyTarget, type Move, nextHistory } from './history';
import { BrowseIcon, CloseCircleIcon, CommandIcon, PlusIcon } from './icons';
import { NoteActions } from './NoteActions';
import { NoteEditor } from './NoteEditor';
import { RecentlyDeleted } from './RecentlyDeleted';
import { matchesShortcut, pinnedNoteNumber } from './shortcuts';

const api = window.notes;
const { platform } = api;
const mac = platform === 'darwin';
const SAVE_DELAY_MS = 400;
/** Popovers open this far down the window, as Raycast's do. */
const POPOVER_TOP = 100;
const POPOVER_MARGIN = 8;
const TOAST_MS = 1800;
const REVEAL_LABEL = mac ? 'Show in Finder' : platform === 'win32' ? 'Show in File Explorer' : 'Show in Folder';
const ACTIONS_SHORTCUT: Shortcut = { key: 'k', modifiers: ['mod'] };
const PIN_SHORTCUT: Shortcut = { key: 'p', modifiers: ['mod', 'shift'] };
const DELETE_SHORTCUT: Shortcut = mac
  ? { key: 'x', modifiers: ['ctrl'] }
  : { key: 'Backspace', modifiers: ['mod', 'shift'] };
const keys = (shortcut: Shortcut) => shortcutKeys(shortcut, platform).join(mac ? '' : '+');

type Popover = 'browse' | 'actions' | 'deleted';

function byRecent(a: Note, b: Note) {
  return b.updatedAt - a.updatedAt;
}

const HTML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
const escapeHtml = (text: string) => text.replace(/[&<>"]/g, (char) => HTML_ESCAPES[char] ?? char);

/** A note, or part of one, as HTML. */
function toHtml(editor: Editor, doc: ProseMirrorNode): string {
  const container = document.createElement('div');
  container.append(DOMSerializer.fromSchema(editor.schema).serializeFragment(doc.content));
  return container.innerHTML;
}

/** The whole note as the editor understands it, even while it's shown as Markdown. */
function noteDocument(editor: Editor, markdown: string, source: boolean): ProseMirrorNode {
  if (!source || !editor.markdown) return editor.state.doc;
  return editor.schema.nodeFromJSON(editor.markdown.parse(markdown));
}

function htmlDocument(title: string, body: string): string {
  return `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<title>${escapeHtml(title)}</title>\n</head>\n<body>\n${body}\n</body>\n</html>\n`;
}

/**
 * The Notes window, laid out like Raycast Notes: one note at a time under a centred title,
 * with Actions (⌘K), Browse Notes (⌘P) and New Note (⌘N) at the top right.
 */
export function NotesApp() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [ui, setUi] = useState<NotesWindowState>(DEFAULT_NOTES_STATE);
  const [popover, setPopover] = useState<Popover | null>(null);
  /** The action list to open the action panel on, like Copy Note As... for ⇧⌘C. */
  const [actionsSubmenu, setActionsSubmenu] = useState<string | null>(null);
  const [finding, setFinding] = useState(false);
  const [findRequest, setFindRequest] = useState(0);
  const [linkRequest, setLinkRequest] = useState(0);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [source, setSource] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const pending = useRef<{ id: string; text: string; timer: ReturnType<typeof setTimeout> } | null>(null);
  const ready = useRef(false);
  const openRequest = useRef<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  /** The heights the window should fit: the note's, and an open popover's. */
  const heights = useRef({ content: 0, overlay: 0 });
  const sentHeights = useRef('');
  // Latest values for callbacks that outlive a render (IPC listeners, timers, shortcuts).
  const latest = useRef({ notes, currentId, draft, ui, popover, finding, editor, source });
  latest.current = { notes, currentId, draft, ui, popover, finding, editor, source };

  const updateUi = useCallback((patch: Partial<NotesWindowState>) => {
    const next = { ...latest.current.ui, ...patch };
    latest.current.ui = next;
    setUi(next);
    api.setState(patch);
  }, []);

  const showToast = useCallback((text: string) => {
    setToast(text);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), TOAST_MS);
  }, []);

  const fit = useCallback(() => {
    const key = `${heights.current.content}:${heights.current.overlay}`;
    if (key === sentHeights.current) return;
    sentHeights.current = key;
    api.fit(heights.current);
  }, []);

  const upsert = useCallback((note: Note) => {
    setNotes((list) => [note, ...list.filter((n) => n.id !== note.id)].sort(byRecent));
  }, []);

  /** Writes the pending edit right away and returns the saved note. */
  const saveNow = useCallback(async (): Promise<Note | undefined> => {
    const edit = pending.current;
    if (!edit) return undefined;
    clearTimeout(edit.timer);
    pending.current = null;
    try {
      const saved = await api.update(edit.id, edit.text);
      upsert(saved);
      return saved;
    } catch (error) {
      console.error('Could not save the note', error);
      return undefined;
    }
  }, [upsert]);

  const scheduleSave = (id: string, text: string) => {
    const previous = pending.current;
    if (previous) clearTimeout(previous.timer);
    // An edit to the note you just left, typed as the window switched notes, is saved now.
    if (previous && previous.id !== id) {
      api.update(previous.id, previous.text).then(upsert, (error) => console.error('Could not save the note', error));
    }
    pending.current = { id, text, timer: setTimeout(() => void saveNow(), SAVE_DELAY_MS) };
  };

  // Focus after React has rendered the change: the editor may only just have become editable.
  const [focusRequest, setFocusRequest] = useState(0);
  const focusEditor = useCallback(() => setFocusRequest((n) => n + 1), []);

  /** Back to the note where the cursor was, after a popover or the find field. */
  const refocusEditor = useCallback(() => {
    const { editor: current, source: asMarkdown } = latest.current;
    if (asMarkdown) document.querySelector<HTMLTextAreaElement>('.notes__source')?.focus();
    // Right away, not on the next frame as Tiptap's focus command does: an action may open
    // a field of its own (Find, another popover) that must keep the keyboard.
    else if (current && !current.isDestroyed) current.view.focus();
  }, []);

  /**
   * Switches to a note: saves the one you're leaving, throws it away if you never wrote in it,
   * remembers when you had it open, and keeps Go Back and Go Forward up to date.
   */
  const select = useCallback(
    async (id: string, list?: Note[], move: Move = 'push') => {
      const saved = await saveNow();
      const { currentId: leaving, draft: leavingText } = latest.current;
      const switching = leaving !== null && leaving !== id;
      const discarded = switching && !leavingText.trim() ? await api.discardIfEmpty(leaving) : false;
      const next = saved?.id === id ? saved : (list ?? latest.current.notes).find((note) => note.id === id);
      let notesNow = list ?? latest.current.notes;
      if (saved) notesNow = [saved, ...notesNow.filter((note) => note.id !== saved.id)].sort(byRecent);
      if (discarded) notesNow = notesNow.filter((note) => note.id !== leaving);
      setNotes(notesNow);
      setCurrentId(next ? id : null);
      setDraft(next?.text ?? '');
      latest.current = { ...latest.current, notes: notesNow, currentId: next ? id : null, draft: next?.text ?? '' };
      if (next) {
        api.setCurrent(id);
        if (switching) {
          const left = discarded ? null : leaving;
          const state = latest.current.ui;
          updateUi({
            ...nextHistory(state, move, left, id),
            ...(left ? { opened: { ...state.opened, [left]: Date.now() } } : {}),
            ...(discarded ? { pinned: state.pinned.filter((pinned) => pinned !== leaving) } : {}),
          });
        }
      }
      // An open popover keeps the keyboard, as Browse Notes does when you delete the note you're on.
      if (!latest.current.popover) focusEditor();
    },
    [saveNow, focusEditor, updateUi],
  );

  const createNote = useCallback(
    async (text = '') => {
      await saveNow();
      const { currentId: id, draft: current } = latest.current;
      // Already on a blank note: use it rather than piling up empty ones.
      if (!text && id && !current.trim()) {
        focusEditor();
        return;
      }
      const note = await api.create(text);
      await select(note.id, [note, ...latest.current.notes]);
    },
    [saveNow, select, focusEditor],
  );

  /** Moves a note to Recently Deleted. Deleting the note you're on opens the one before it. */
  const deleteNote = useCallback(
    async (target?: string) => {
      const { currentId: current } = latest.current;
      const id = target ?? current;
      if (!id) return;
      if (pending.current?.id === id) await saveNow();
      await api.delete(id);
      // A keystroke that landed while it was being deleted mustn't bring it back.
      const late = pending.current;
      if (late?.id === id) {
        clearTimeout(late.timer);
        pending.current = null;
      }
      const state = latest.current.ui;
      const forget = (ids: string[]) => ids.filter((entry) => entry !== id);
      const { [id]: _deleted, ...opened } = state.opened;
      updateUi({ pinned: forget(state.pinned), back: forget(state.back), forward: forget(state.forward), opened });
      const remaining = latest.current.notes.filter((note) => note.id !== id);
      showToast('Moved to Recently Deleted');
      if (id !== current) {
        setNotes(remaining);
        latest.current = { ...latest.current, notes: remaining };
        return;
      }
      setCurrentId(null);
      setDraft('');
      latest.current = { ...latest.current, notes: remaining, currentId: null, draft: '' };
      const exists = (entry: string) => remaining.some((note) => note.id === entry);
      const previous = historyTarget(latest.current.ui.back, exists, null);
      const recent = browseSections(remaining, { pinned: [], opened, currentId: null }).notes[0]?.id;
      const next = previous ?? recent;
      if (next) await select(next, remaining, previous ? 'back' : 'none');
      else {
        setNotes([]);
        await createNote();
      }
    },
    [saveNow, select, createNote, updateUi, showToast],
  );

  const deleteAll = useCallback(async () => {
    await saveNow();
    if (!(await api.deleteAll())) return;
    updateUi({ pinned: [], back: [], forward: [], opened: {} });
    setNotes([]);
    setCurrentId(null);
    setDraft('');
    latest.current = { ...latest.current, notes: [], currentId: null, draft: '' };
    await createNote();
  }, [saveNow, updateUi, createNote]);

  const restore = useCallback(
    async (id: string) => {
      const note = await api.restore(id);
      await select(note.id, [note, ...latest.current.notes.filter((existing) => existing.id !== note.id)]);
      showToast('Restored Note');
    },
    [select, showToast],
  );

  const go = useCallback(
    (direction: 'back' | 'forward') => {
      const { ui: state, notes: list, currentId: current } = latest.current;
      const exists = (id: string) => list.some((note) => note.id === id);
      const target = historyTarget(direction === 'back' ? state.back : state.forward, exists, current);
      if (target) void select(target, undefined, direction);
    },
    [select],
  );

  const togglePin = useCallback(
    (target?: string) => {
      const { currentId: current, ui: state } = latest.current;
      const id = target ?? current;
      if (!id) return;
      const wasPinned = state.pinned.includes(id);
      updateUi({ pinned: wasPinned ? state.pinned.filter((pinned) => pinned !== id) : [...state.pinned, id] });
      showToast(wasPinned ? 'Unpinned Note' : 'Pinned Note');
    },
    [updateUi, showToast],
  );

  const closePopover = useCallback(
    (refocus = true) => {
      setPopover(null);
      latest.current = { ...latest.current, popover: null };
      setActionsSubmenu(null);
      heights.current = { ...heights.current, overlay: 0 };
      fit();
      if (refocus) refocusEditor();
    },
    [fit, refocusEditor],
  );

  const togglePopover = useCallback(
    (which: Popover, submenu: string | null = null) => {
      if (latest.current.popover === which && !submenu) closePopover();
      else {
        setActionsSubmenu(submenu);
        setPopover(which);
        latest.current = { ...latest.current, popover: which };
      }
    },
    [closePopover],
  );

  const openFind = useCallback(() => {
    if (latest.current.source || !latest.current.editor) return;
    setFinding(true);
    setFindRequest((n) => n + 1);
  }, []);

  const closeFind = useCallback(() => {
    setFinding(false);
    refocusEditor();
  }, [refocusEditor]);

  const copyAs = useCallback(
    (format: ExportFormat) => {
      const { editor: current, draft: text, source: asMarkdown } = latest.current;
      const selection = current && !asMarkdown && !current.state.selection.empty ? current.state.selection : null;
      const part = selection && current ? current.state.doc.cut(selection.from, selection.to) : null;
      const markdown = part && current?.markdown ? current.markdown.serialize(part.toJSON()) : text;
      if (format === 'md') api.copy({ text: markdown });
      else if (format === 'txt') api.copy({ text: toPlainText(markdown) });
      else {
        const html = current ? toHtml(current, part ?? noteDocument(current, text, asMarkdown)) : escapeHtml(text);
        api.copy({ text: html, html });
      }
      showToast('Copied to Clipboard');
    },
    [showToast],
  );

  const exportAs = useCallback(
    async (format: ExportFormat) => {
      await saveNow();
      const { editor: current, draft: text, source: asMarkdown } = latest.current;
      const title = noteTitle(text);
      const body = current
        ? toHtml(current, noteDocument(current, text, asMarkdown))
        : `<pre>${escapeHtml(text)}</pre>`;
      const content = format === 'md' ? text : format === 'txt' ? `${toPlainText(text)}\n` : htmlDocument(title, body);
      if (await api.export({ name: title, format, content })) showToast('Exported Note');
    },
    [saveNow, showToast],
  );

  const formatItems = useCallback((): NoteAction[] => {
    const { editor: current, source: asMarkdown } = latest.current;
    if (!current || asMarkdown || !current.isEditable) return [];
    const chain = () => current.chain().focus();
    const shortcut = (key: string, ...more: Array<'shift' | 'alt'>): Shortcut => ({ key, modifiers: ['mod', ...more] });
    const headings = [Heading1, Heading2, Heading3];
    return [
      {
        key: 'text',
        title: 'Text',
        icon: Pilcrow,
        shortcut: shortcut('0', 'alt'),
        run: () => chain().setParagraph().run(),
      },
      ...([1, 2, 3] as const).map((level) => ({
        key: `heading-${level}`,
        title: `Heading ${level}`,
        icon: headings[level - 1] ?? Heading1,
        shortcut: shortcut(String(level), 'alt'),
        run: () => chain().toggleHeading({ level }).run(),
      })),
      { key: 'bold', title: 'Bold', icon: Bold, shortcut: shortcut('b'), run: () => chain().toggleBold().run() },
      {
        key: 'italic',
        title: 'Italic',
        icon: Italic,
        shortcut: shortcut('i'),
        run: () => chain().toggleItalic().run(),
      },
      {
        key: 'strike',
        title: 'Strikethrough',
        icon: Strikethrough,
        shortcut: shortcut('s', 'shift'),
        run: () => chain().toggleStrike().run(),
      },
      { key: 'code', title: 'Inline Code', icon: Code, shortcut: shortcut('e'), run: () => chain().toggleCode().run() },
      { key: 'link', title: 'Link', icon: Link, shortcut: shortcut('l'), run: () => setLinkRequest((n) => n + 1) },
      {
        key: 'code-block',
        title: 'Code Block',
        icon: SquareCode,
        shortcut: shortcut('c', 'alt'),
        run: () => chain().toggleCodeBlock().run(),
      },
      {
        key: 'quote',
        title: 'Quote',
        icon: TextQuote,
        shortcut: shortcut('b', 'shift'),
        run: () => chain().toggleBlockquote().run(),
      },
      {
        key: 'bullets',
        title: 'Bulleted List',
        icon: List,
        shortcut: shortcut('8', 'shift'),
        run: () => chain().toggleBulletList().run(),
      },
      {
        key: 'numbers',
        title: 'Numbered List',
        icon: ListOrdered,
        shortcut: shortcut('7', 'shift'),
        run: () => chain().toggleOrderedList().run(),
      },
      {
        key: 'checklist',
        title: 'Checklist',
        icon: ListChecks,
        shortcut: shortcut('9', 'shift'),
        run: () => chain().toggleTaskList().run(),
      },
      { key: 'divider', title: 'Divider', icon: Minus, run: () => chain().setHorizontalRule().run() },
    ];
  }, []);

  // Initial load: the note main asked for, else the last one open, else the newest, else a new one.
  useEffect(() => {
    let cancelled = false;
    const offOpen = api.onOpen((id) => {
      if (!ready.current) {
        openRequest.current = id;
        return;
      }
      closePopover(false);
      void api.list().then((list) => select(id, list));
    });
    const offChanged = api.onChanged(() => {
      void api.list().then((list) => {
        const { currentId: id } = latest.current;
        const fresh = list.find((note) => note.id === id);
        // Take edits made elsewhere, unless you're in the middle of typing.
        if (fresh && !pending.current && fresh.text !== latest.current.draft) setDraft(fresh.text);
        setNotes(list);
        latest.current = { ...latest.current, notes: list };
        if (id && !fresh && list[0]) void select(list[0].id, list, 'none');
      });
    });
    void (async () => {
      const [state, list] = await Promise.all([api.getState(), api.list()]);
      if (cancelled) return;
      const { currentId: lastOpen, ...saved } = state;
      latest.current.ui = saved;
      setUi(saved);
      ready.current = true;
      const wanted = [openRequest.current, lastOpen, list[0]?.id].find(
        (id) => id && list.some((note) => note.id === id),
      );
      if (wanted) await select(wanted, list, 'none');
      else {
        setNotes(list);
        await createNote();
      }
    })();
    return () => {
      cancelled = true;
      offOpen();
      offChanged();
    };
  }, [select, createNote, closePopover]);

  // Keep "Opened 2 minutes ago" honest, and never lose the last keystrokes when the window closes.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    const flush = () => {
      const edit = pending.current;
      if (edit) {
        clearTimeout(edit.timer);
        api.flush(edit.id, edit.text);
        pending.current = null;
      }
    };
    window.addEventListener('beforeunload', flush);
    window.addEventListener('blur', flush);
    return () => {
      clearInterval(timer);
      window.removeEventListener('beforeunload', flush);
      window.removeEventListener('blur', flush);
    };
  }, []);

  const title = noteTitle(draft);
  useEffect(() => {
    document.title = title;
  }, [title]);

  const liveNotes = useMemo(
    () => notes.map((note) => (note.id === currentId ? { ...note, text: draft } : note)),
    [notes, currentId, draft],
  );
  const exists = (id: string) => notes.some((note) => note.id === id);

  const groups: NoteActionGroup[] = noteActions({
    platform,
    empty: !draft.trim(),
    pinned: currentId !== null && ui.pinned.includes(currentId),
    canGoBack: historyTarget(ui.back, exists, currentId) !== undefined,
    canGoForward: historyTarget(ui.forward, exists, currentId) !== undefined,
    hasSelection: editor !== null && !source && !editor.state.selection.empty,
    formatBar: ui.formatBar,
    autoResize: ui.autoResize,
    alwaysOnTop: ui.alwaysOnTop,
    count: ui.count,
    zoom: ui.zoom,
    revealLabel: REVEAL_LABEL,
    newNote: () => void createNote(),
    duplicate: () => void createNote(latest.current.draft),
    togglePin: () => togglePin(),
    browse: () => togglePopover('browse'),
    goBack: () => go('back'),
    goForward: () => go('forward'),
    find: openFind,
    copyAs,
    copyDeeplink: () => {
      const { currentId: id } = latest.current;
      if (!id) return;
      api.copy({ text: noteDeeplink(id) });
      showToast('Copied Deeplink');
    },
    exportAs: (format) => void exportAs(format),
    formatItems,
    toggleFormatBar: () => updateUi({ formatBar: !latest.current.ui.formatBar }),
    toggleAutoResize: () => updateUi({ autoResize: !latest.current.ui.autoResize }),
    toggleAlwaysOnTop: () => updateUi({ alwaysOnTop: !latest.current.ui.alwaysOnTop }),
    toggleCount: () => updateUi({ count: latest.current.ui.count === 'words' ? 'characters' : 'words' }),
    zoomBy: (step) => updateUi({ zoom: clampZoom(latest.current.ui.zoom + step) }),
    resetZoom: () => updateUi({ zoom: 1 }),
    reveal: () => {
      const { currentId: id } = latest.current;
      if (id) void saveNow().then(() => api.reveal(id));
    },
    recentlyDeleted: () => togglePopover('deleted'),
    deleteNote: () => void deleteNote(),
    deleteAll: () => void deleteAll(),
  });
  const groupsRef = useRef(groups);
  groupsRef.current = groups;

  /** Runs an action from the panel or its shortcut. One with a list of its own opens the panel on it. */
  const runAction = useCallback(
    (action: NoteAction) => {
      if (action.disabled) return;
      if (action.submenu) {
        togglePopover('actions', action.key);
        return;
      }
      if (latest.current.popover) closePopover();
      action.run?.();
    },
    [togglePopover, closePopover],
  );

  // Every action's shortcut works anywhere in the window, panel open or not, after the
  // editor has had its say (it formats with ⌘B, ⌘E and the like).
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing) return;
      // The editor marks every Esc as handled, though it does nothing with it.
      const editorEscape = event.key === 'Escape' && (event.target as Element | null)?.closest?.('.ProseMirror');
      if (event.defaultPrevented && !editorEscape) return;
      const number = pinnedNoteNumber(event, platform);
      if (number !== undefined) {
        const { ui: state, notes: list } = latest.current;
        const id = state.pinned.filter((pinned) => list.some((note) => note.id === pinned))[number - 1];
        if (!id) return;
        event.preventDefault();
        if (latest.current.popover) closePopover(false);
        void select(id);
        return;
      }
      if (matchesShortcut(event, ACTIONS_SHORTCUT, platform)) {
        event.preventDefault();
        togglePopover('actions');
        return;
      }
      for (const group of groupsRef.current) {
        for (const action of group.items) {
          const shortcuts = [action.shortcut, ...(action.alsoShortcuts ?? [])];
          if (shortcuts.some((shortcut) => shortcut && matchesShortcut(event, shortcut, platform))) {
            event.preventDefault();
            runAction(action);
            return;
          }
        }
      }
      if (event.key === 'Escape' && !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey) {
        event.preventDefault();
        if (latest.current.popover) closePopover();
        else if (latest.current.finding) closeFind();
        else api.hide();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [select, togglePopover, closePopover, closeFind, runAction]);

  const onPopoverHeight = useCallback(
    (height: number) => {
      heights.current = { ...heights.current, overlay: POPOVER_TOP + height + POPOVER_MARGIN };
      fit();
    },
    [fit],
  );

  const length = noteLength(draft, ui.count);

  return (
    <div className="notes" data-popover={popover ?? undefined} style={{ '--note-zoom': ui.zoom } as CSSProperties}>
      <header className="notes__header">
        <h1 className="notes__title">{title}</h1>
        <div className="notes__toolbar" role="toolbar" aria-label="Note">
          <button
            type="button"
            className="notes__tool"
            aria-label="Actions"
            title={`Actions (${keys(ACTIONS_SHORTCUT)})`}
            aria-expanded={popover === 'actions'}
            onClick={() => togglePopover('actions')}
          >
            <CommandIcon />
          </button>
          <button
            type="button"
            className="notes__tool"
            aria-label="Browse Notes"
            title={`Browse Notes (${keys({ key: 'p', modifiers: ['mod'] })})`}
            aria-expanded={popover === 'browse'}
            onClick={() => togglePopover('browse')}
          >
            <BrowseIcon size={18} />
          </button>
          <button
            type="button"
            className="notes__tool"
            aria-label="New Note"
            title={`New Note (${keys({ key: 'n', modifiers: ['mod'] })})`}
            onClick={() => {
              if (latest.current.popover) closePopover(false);
              void createNote();
            }}
          >
            <PlusIcon />
          </button>
        </div>
      </header>

      {finding && editor && <FindBar editor={editor} focusRequest={findRequest} onClose={closeFind} />}

      <NoteEditor
        noteId={currentId}
        text={draft}
        focusRequest={focusRequest}
        linkRequest={linkRequest}
        formatBar={ui.formatBar}
        zoom={ui.zoom}
        length={length}
        onToggleCount={() => updateUi({ count: latest.current.ui.count === 'words' ? 'characters' : 'words' })}
        onEditor={setEditor}
        onSourceChange={setSource}
        onHeightChange={(height) => {
          heights.current = { ...heights.current, content: height };
          fit();
        }}
        onChange={(text, id) => {
          if (!id) return;
          // Saved to the note it was typed in, even if the window has just switched notes.
          if (id === latest.current.currentId) {
            setDraft(text);
            latest.current = { ...latest.current, draft: text };
          }
          if (latest.current.notes.some((note) => note.id === id)) scheduleSave(id, text);
        }}
      />

      {popover && <div className="notes__scrim" onMouseDown={() => closePopover()} aria-hidden="true" />}
      {popover === 'browse' && (
        <BrowseNotes
          notes={liveNotes}
          currentId={currentId}
          state={ui}
          platform={platform}
          now={now}
          pinShortcut={PIN_SHORTCUT}
          deleteShortcut={DELETE_SHORTCUT}
          onOpen={(id) => {
            closePopover(false);
            if (id !== currentId) void select(id);
            else focusEditor();
          }}
          onTogglePin={(id) => togglePin(id)}
          onDelete={(id) => void deleteNote(id)}
          onCreate={(text) => {
            closePopover(false);
            void createNote(text ? `${text}\n` : '');
          }}
          onClose={() => closePopover()}
          onHeight={onPopoverHeight}
        />
      )}
      {popover === 'actions' && (
        <NoteActions
          key={actionsSubmenu ?? 'actions'}
          groups={groups}
          initialSubmenu={actionsSubmenu}
          platform={platform}
          onRun={runAction}
          onClose={() => closePopover()}
          onHeight={onPopoverHeight}
        />
      )}
      {popover === 'deleted' && (
        <RecentlyDeleted
          count={ui.count}
          now={now}
          onRestore={(id) => {
            closePopover(false);
            void restore(id);
          }}
          onClose={() => closePopover()}
          onHeight={onPopoverHeight}
        />
      )}
      {popover && (
        <button
          type="button"
          className="notes__dismiss"
          aria-label="Close"
          title="Close (esc)"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => closePopover()}
        >
          <CloseCircleIcon />
        </button>
      )}
      {toast && (
        <div className="notes__toast" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}
