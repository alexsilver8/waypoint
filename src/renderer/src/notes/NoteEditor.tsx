import { EditorState } from '@tiptap/pm/state';
import { type Editor, EditorContent, useEditor, useEditorState } from '@tiptap/react';
import {
  Bold,
  Check,
  ChevronDown,
  Code,
  ExternalLink,
  Heading,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  Link,
  List,
  ListChecks,
  ListOrdered,
  Pilcrow,
  SquareCode,
  Strikethrough,
  TextCursor,
  TextQuote,
  Unlink,
} from 'lucide-react';
import {
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type RefObject,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { isOpenableLink, normalizeLink } from '../../../shared/notes';
import { Keycaps } from '../components/Keycaps';
import { applyNoteStyle, noteExtensions, showsFaithfully } from './markdown';

const api = window.notes;
const { platform } = api;
const mac = platform === 'darwin';
const MOD = mac ? '⌘' : 'Ctrl';
const ALT = mac ? '⌥' : 'Alt';
const SHIFT = mac ? '⇧' : 'Shift';

/** ← and → move between the toolbar's buttons, as in any toolbar. */
function moveAlongToolbar(event: ReactKeyboardEvent<HTMLElement>) {
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
  const target = event.target as HTMLElement;
  if (!target.classList.contains('toolbar__button') || target.closest('[role="menu"], [role="dialog"]')) return;
  const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('.toolbar__button')].filter(
    (button) => !button.disabled && !button.closest('[role="menu"], [role="dialog"]'),
  );
  const index = buttons.indexOf(target as HTMLButtonElement);
  const next = buttons[(index + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length];
  event.preventDefault();
  next?.focus();
}

/** Keep the editor's focus and selection when a toolbar control is clicked. */
function keepEditorFocus(event: ReactMouseEvent) {
  if (!(event.target instanceof HTMLInputElement)) event.preventDefault();
}

type Align = 'start' | 'center' | 'end';

/**
 * Places a menu just above its anchor, kept inside the window. It's positioned against the
 * window rather than the format bar, so a bar squeezed into a narrow window can scroll
 * without cutting its menus off.
 */
function usePopoverPlacement(
  anchor: RefObject<HTMLElement | null>,
  popover: RefObject<HTMLElement | null>,
  align: Align,
  open: boolean,
): CSSProperties {
  // Measured and placed before the first paint. Not hidden meanwhile: a hidden field can't take focus.
  const [style, setStyle] = useState<CSSProperties>({});
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const box = anchor.current?.getBoundingClientRect();
      const width = popover.current?.offsetWidth ?? 0;
      if (!box) return;
      const ideal =
        align === 'end' ? box.right - width : align === 'center' ? box.left + (box.width - width) / 2 : box.left;
      const left = Math.max(8, Math.min(ideal, window.innerWidth - width - 8));
      setStyle({ left, bottom: window.innerHeight - box.top + 10 });
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [anchor, popover, align, open]);
  return style;
}

interface MenuItem {
  label: string;
  icon: ReactNode;
  checked: boolean;
  keys: string[];
  run(): void;
}

/** A format bar button that opens a short menu above it. */
function Menu({
  label,
  icon,
  active,
  disabled,
  kind,
  align = 'start',
  items,
  onDismiss,
}: {
  label: string;
  icon: ReactNode;
  active: boolean;
  disabled: boolean;
  kind: 'radio' | 'checkbox';
  align?: Align;
  items: MenuItem[];
  onDismiss(): void;
}) {
  const [open, setOpen] = useState(false);
  const [focused, setFocused] = useState<number | null>(null);
  const wrapper = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const placement = usePopoverPlacement(wrapper, list, align, open);

  useEffect(() => {
    if (!open) return;
    const onMouseDown = (event: MouseEvent) => {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        // Esc closes the menu, not the window.
        event.stopPropagation();
        // Back where you were: the menu's button if you came from the keyboard, else the note.
        const fromMenu = list.current?.contains(document.activeElement);
        setOpen(false);
        if (fromMenu) trigger.current?.focus();
        else onDismiss();
      }
    };
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, onDismiss]);

  useEffect(() => {
    if (open && focused !== null) (list.current?.children[focused] as HTMLElement | undefined)?.focus();
  }, [open, focused]);

  // Opened from the keyboard, the menu takes focus; opened with the mouse, typing stays in the note.
  const show = (withKeyboard: boolean) => {
    setOpen(true);
    setFocused(
      withKeyboard
        ? Math.max(
            0,
            items.findIndex((item) => item.checked),
          )
        : null,
    );
  };

  const onMenuKeyDown = (event: ReactKeyboardEvent) => {
    const index = focused ?? -1;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setFocused((index + step + items.length) % items.length);
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      setFocused(event.key === 'Home' ? 0 : items.length - 1);
    } else if (event.key === 'Tab') {
      setOpen(false);
    }
  };

  return (
    <div className="toolbar__menu" ref={wrapper}>
      <button
        ref={trigger}
        type="button"
        className="toolbar__button toolbar__button--menu"
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        data-active={active || undefined}
        disabled={disabled}
        onClick={(event) => (open ? setOpen(false) : show(event.detail === 0))}
        onKeyDown={(event) => {
          if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
            event.preventDefault();
            show(true);
          }
        }}
      >
        {icon}
        <ChevronDown className="toolbar__chevron" size={11} strokeWidth={2.5} aria-hidden="true" />
      </button>
      {open && (
        <div
          ref={list}
          className="toolbar__popover toolbar__list"
          style={placement}
          role="menu"
          aria-label={label}
          onKeyDown={onMenuKeyDown}
        >
          {items.map((item) => {
            const select = () => {
              setOpen(false);
              item.run();
            };
            const content = (
              <>
                <span className="toolbar__item-icon" aria-hidden="true">
                  {item.icon}
                </span>
                <span className="toolbar__item-label">{item.label}</span>
                {item.checked && <Check className="toolbar__item-check" size={14} aria-hidden="true" />}
                <Keycaps keys={item.keys} />
              </>
            );
            return kind === 'radio' ? (
              <button
                key={item.label}
                type="button"
                role="menuitemradio"
                aria-checked={item.checked}
                tabIndex={-1}
                className="toolbar__item"
                onClick={select}
              >
                {content}
              </button>
            ) : (
              <button
                key={item.label}
                type="button"
                role="menuitemcheckbox"
                aria-checked={item.checked}
                tabIndex={-1}
                className="toolbar__item"
                onClick={select}
              >
                {content}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

const LINK_FIELD_WIDTH = 340;

/**
 * Edits the address of the link under the cursor, or links the selection. It opens just
 * below what it links, like Raycast's, whether you pressed ⌘L or used the format bar.
 */
function LinkField({ editor, onClose }: { editor: Editor; onClose(refocus: boolean): void }) {
  const current = editor.getAttributes('link').href as string | undefined;
  const [value, setValue] = useState(current ?? '');
  const [invalid, setInvalid] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const wrapper = useRef<HTMLDivElement>(null);
  const [placement] = useState<CSSProperties>(() => {
    const { from, to } = editor.state.selection;
    const start = editor.view.coordsAtPos(from);
    const end = editor.view.coordsAtPos(to);
    const width = Math.min(LINK_FIELD_WIDTH, window.innerWidth - 16);
    const left = Math.max(8, Math.min(start.left - 12, window.innerWidth - width - 8));
    // Below the line, unless that runs off the window.
    return end.bottom + 56 < window.innerHeight
      ? { left, top: end.bottom + 6, width }
      : { left, bottom: window.innerHeight - start.top + 6, width };
  });

  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);

  useEffect(() => {
    const onMouseDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      // The format bar's Link button toggles the field itself.
      if (!wrapper.current?.contains(target) && !target.closest('[data-link-toggle]')) onClose(false);
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [onClose]);

  const remove = () => {
    editor.chain().focus().extendMarkRange('link').unsetLink().run();
    onClose(false);
  };

  const apply = () => {
    const href = normalizeLink(value);
    if (href === null) {
      setInvalid(true);
      return;
    }
    if (!href) {
      remove();
      return;
    }
    const chain = editor.chain().focus();
    if (editor.state.selection.empty && !editor.isActive('link')) {
      // Nothing selected: the address becomes the link's text, and typing after it isn't linked.
      chain
        .insertContent({ type: 'text', text: value.trim(), marks: [{ type: 'link', attrs: { href } }] })
        .unsetMark('link')
        .run();
    } else {
      chain.extendMarkRange('link').setLink({ href }).run();
    }
    onClose(false);
  };

  return (
    <div ref={wrapper} className="toolbar__popover link-field" style={placement} role="dialog" aria-label="Link">
      <Link className="link-field__icon" size={14} aria-hidden="true" />
      <input
        ref={input}
        className="link-field__input"
        value={value}
        onChange={(event) => {
          setValue(event.target.value);
          setInvalid(false);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            apply();
          } else if (event.key === 'Escape') {
            event.preventDefault();
            onClose(true);
          }
        }}
        placeholder="Paste or type a link"
        aria-label="Link address"
        aria-invalid={invalid || undefined}
        title={invalid ? 'Links can be web pages (https://) or email addresses.' : undefined}
        spellCheck={false}
      />
      {current && isOpenableLink(current) && (
        <button
          type="button"
          className="toolbar__button"
          title={`Open link (${MOD}-click a link)`}
          aria-label="Open link"
          onClick={() => api.openLink(current)}
        >
          <ExternalLink size={15} />
        </button>
      )}
      {current && (
        <button type="button" className="toolbar__button" title="Remove link" aria-label="Remove link" onClick={remove}>
          <Unlink size={15} />
        </button>
      )}
    </div>
  );
}

/** The format bar at the bottom of the window (⌥⌘,), with the note's length beside it. */
function FormatBar({
  editor,
  linkOpen,
  setLinkOpen,
  length,
  onToggleCount,
}: {
  editor: Editor;
  linkOpen: boolean;
  setLinkOpen(open: boolean): void;
  length: string;
  onToggleCount(): void;
}) {
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      editable: e.isEditable,
      heading: ([1, 2, 3] as const).find((level) => e.isActive('heading', { level })) ?? 0,
      bold: e.isActive('bold'),
      italic: e.isActive('italic'),
      strike: e.isActive('strike'),
      code: e.isActive('code'),
      link: e.isActive('link'),
      codeBlock: e.isActive('codeBlock'),
      blockquote: e.isActive('blockquote'),
      list: e.isActive('taskList')
        ? 'task'
        : e.isActive('orderedList')
          ? 'ordered'
          : e.isActive('bulletList')
            ? 'bullet'
            : '',
    }),
  });
  const disabled = !state.editable;
  const chain = () => editor.chain().focus();
  const refocus = () => editor.commands.focus();

  const headings: MenuItem[] = [
    {
      label: 'Text',
      icon: <Pilcrow size={15} />,
      checked: state.heading === 0 && !state.codeBlock,
      keys: [MOD, ALT, '0'],
      run: () => chain().setParagraph().run(),
    },
    ...([1, 2, 3] as const).map((level) => ({
      label: `Heading ${level}`,
      icon: [<Heading1 key={1} size={15} />, <Heading2 key={2} size={15} />, <Heading3 key={3} size={15} />][level - 1],
      checked: state.heading === level,
      keys: [MOD, ALT, String(level)],
      run: () => chain().toggleHeading({ level }).run(),
    })),
  ];

  const styles: MenuItem[] = [
    {
      label: 'Bold',
      icon: <Bold size={15} />,
      checked: state.bold,
      keys: [MOD, 'B'],
      run: () => chain().toggleBold().run(),
    },
    {
      label: 'Italic',
      icon: <Italic size={15} />,
      checked: state.italic,
      keys: [MOD, 'I'],
      run: () => chain().toggleItalic().run(),
    },
    {
      label: 'Strikethrough',
      icon: <Strikethrough size={15} />,
      checked: state.strike,
      keys: [MOD, SHIFT, 'S'],
      run: () => chain().toggleStrike().run(),
    },
  ];

  const lists: MenuItem[] = [
    {
      label: 'Bulleted list',
      icon: <List size={15} />,
      checked: state.list === 'bullet',
      keys: [MOD, SHIFT, '8'],
      run: () => chain().toggleBulletList().run(),
    },
    {
      label: 'Numbered list',
      icon: <ListOrdered size={15} />,
      checked: state.list === 'ordered',
      keys: [MOD, SHIFT, '7'],
      run: () => chain().toggleOrderedList().run(),
    },
    {
      label: 'Checklist',
      icon: <ListChecks size={15} />,
      checked: state.list === 'task',
      keys: [MOD, SHIFT, '9'],
      run: () => chain().toggleTaskList().run(),
    },
  ];

  const toggle = (label: string, keys: string[], icon: ReactNode, active: boolean, run: () => void) => (
    <button
      type="button"
      className="toolbar__button"
      aria-label={label}
      title={`${label} (${keys.join(mac ? '' : '+')})`}
      aria-pressed={active}
      disabled={disabled}
      onClick={run}
    >
      {icon}
    </button>
  );

  return (
    <div className="format-bar">
      <div
        className="toolbar"
        role="toolbar"
        aria-label="Formatting"
        onMouseDown={keepEditorFocus}
        onKeyDown={moveAlongToolbar}
      >
        <Menu
          label="Heading"
          icon={<Heading size={16} />}
          active={state.heading > 0}
          disabled={disabled}
          kind="radio"
          items={headings}
          onDismiss={refocus}
        />
        <Menu
          label="Text style"
          icon={<TextCursor size={16} />}
          active={state.bold || state.italic || state.strike}
          disabled={disabled}
          kind="checkbox"
          items={styles}
          onDismiss={refocus}
        />
        <span className="toolbar__menu" data-link-toggle="">
          {toggle('Link', [MOD, 'L'], <Link size={16} />, state.link || linkOpen, () => {
            setLinkOpen(!linkOpen);
            // Closing the field from its button: back to the note, not nowhere.
            if (linkOpen) refocus();
          })}
        </span>
        {toggle('Inline code', [MOD, 'E'], <Code size={16} />, state.code, () => chain().toggleCode().run())}
        <span className="toolbar__divider" aria-hidden="true" />
        {toggle('Code block', [MOD, ALT, 'C'], <SquareCode size={16} />, state.codeBlock, () =>
          chain().toggleCodeBlock().run(),
        )}
        {toggle('Quote', [MOD, SHIFT, 'B'], <TextQuote size={16} />, state.blockquote, () =>
          chain().toggleBlockquote().run(),
        )}
        <span className="toolbar__divider" aria-hidden="true" />
        <Menu
          label="List"
          icon={<List size={16} />}
          active={state.list !== ''}
          disabled={disabled}
          kind="radio"
          align="end"
          items={lists}
          onDismiss={refocus}
        />
      </div>
      <button
        type="button"
        className="format-bar__count"
        onMouseDown={keepEditorFocus}
        onClick={onToggleCount}
        title="Switch between characters and words"
      >
        {length}
      </button>
    </div>
  );
}

export interface NoteEditorProps {
  /** The note being edited; null while there's none, which leaves the editor read-only. */
  noteId: string | null;
  /** The note as Markdown. Replaces what's shown whenever it isn't what the editor last wrote. */
  text: string;
  /** Bump to put the cursor at the end of the note. */
  focusRequest: number;
  /** Bump to open the link field, as ⌘L does. */
  linkRequest: number;
  onChange(markdown: string): void;
  /** Show the format bar at the bottom of the window. */
  formatBar: boolean;
  /** The note's length, like "12 characters", shown at the end of the format bar. */
  length: string;
  onToggleCount(): void;
  /** The editor once it's ready, for the window's actions: find, copy, format. */
  onEditor(editor: Editor | null): void;
  /** Whether the note is shown as Markdown because the editor can't show all of it. */
  onSourceChange(source: boolean): void;
  /** The window height the note would like: everything around it plus all of its text. */
  onHeightChange(height: number): void;
  /** The note's text size, which changes its height. */
  zoom: number;
}

/**
 * Rich editing over plain Markdown: you see headings, lists and checkboxes, and the file
 * on disk stays Markdown any app can read.
 */
export function NoteEditor({
  noteId,
  text,
  focusRequest,
  linkRequest,
  onChange,
  formatBar,
  length,
  onToggleCount,
  onEditor,
  onSourceChange,
  onHeightChange,
  zoom,
}: NoteEditorProps) {
  const [linkOpen, setLinkOpen] = useState(false);
  /** The note has Markdown the editor can't show, so it's edited as plain text instead. */
  const [source, setSource] = useState(false);
  const sourceRef = useRef(false);
  const sourceArea = useRef<HTMLTextAreaElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onHeightRef = useRef(onHeightChange);
  onHeightRef.current = onHeightChange;
  /** What the editor holds, as Markdown, so a re-render with the same text leaves it alone. */
  const shownText = useRef<string | null>(null);
  const shownNote = useRef<string | null>(null);

  const extensions = useMemo(() => noteExtensions({ onLinkShortcut: () => setLinkOpen(true) }), []);
  const editor = useEditor({
    extensions,
    editable: false,
    editorProps: {
      attributes: {
        class: 'notes__editor',
        role: 'textbox',
        'aria-multiline': 'true',
        'aria-label': 'Note',
      },
      // ⌘-click (Ctrl-click) opens a link; a plain click just puts the cursor in it.
      handleClick: (_view, _pos, event) => {
        if (!(mac ? event.metaKey : event.ctrlKey)) return false;
        const href = (event.target as HTMLElement).closest('a')?.getAttribute('href');
        if (!href || !isOpenableLink(href)) return false;
        event.preventDefault();
        api.openLink(href);
        return true;
      },
    },
    onCreate: ({ editor: created }) => {
      if (created.markdown) applyNoteStyle(created.markdown);
    },
    onUpdate: ({ editor: changed }) => {
      const markdown = changed.getMarkdown();
      shownText.current = markdown;
      onChangeRef.current(markdown);
    },
  });

  useEffect(() => {
    onEditor(editor);
    return () => onEditor(null);
  }, [editor, onEditor]);

  useEffect(() => onSourceChange(source), [source, onSourceChange]);

  // Show another note, or edits made to this one elsewhere.
  useEffect(() => {
    if (!editor) return;
    const switched = shownNote.current !== noteId;
    if (switched || text !== shownText.current) {
      shownNote.current = noteId;
      shownText.current = text;
      const faithful = !editor.markdown || showsFaithfully(editor.markdown, text);
      sourceRef.current = !faithful;
      setSource(!faithful);
      // Loading a note isn't an edit: nothing gets autolinked, and the note gets its own undo
      // history, so undo never brings back another note or an older copy of this one.
      editor
        .chain()
        .setMeta('preventAutolink', true)
        .setContent(faithful ? text : '', { contentType: 'markdown', emitUpdate: false })
        .run();
      const { doc, plugins } = editor.state;
      editor.view.updateState(EditorState.create({ doc, plugins }));
      editor.view.dispatch(editor.state.tr);
      if (switched) setLinkOpen(false);
    }
    const editable = noteId !== null && !sourceRef.current;
    if (editor.isEditable !== editable) editor.setEditable(editable, false);
  }, [editor, noteId, text]);

  useEffect(() => {
    if (focusRequest === 0 || !noteId) return;
    if (sourceRef.current) {
      const area = sourceArea.current;
      area?.focus();
      area?.setSelectionRange(area.value.length, area.value.length);
    } else {
      editor?.commands.focus('end');
    }
  }, [editor, focusRequest, noteId]);

  useEffect(() => {
    if (linkRequest > 0 && editor?.isEditable) setLinkOpen(true);
  }, [editor, linkRequest]);

  // How tall the window would need to be to show the whole note: what's around the note,
  // plus the note's own height, measured to its last line so the window's height can't feed back in.
  // A new text size (zoom) means measuring again.
  useLayoutEffect(() => {
    const box = scroller.current;
    if (!editor || !box) return;
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const around = window.innerHeight - box.clientHeight;
        if (sourceRef.current) {
          onHeightRef.current(around + box.clientHeight);
          return;
        }
        const dom = editor.view.dom as HTMLElement;
        const last = dom.lastElementChild as HTMLElement | null;
        const style = getComputedStyle(dom);
        const top = dom.getBoundingClientRect().top;
        const bottom = last
          ? last.getBoundingClientRect().bottom - top + Number.parseFloat(getComputedStyle(last).marginBottom)
          : Number.parseFloat(style.paddingTop);
        onHeightRef.current(Math.ceil(around + bottom + Number.parseFloat(style.paddingBottom)));
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    observer.observe(editor.view.dom);
    editor.on('update', measure);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      editor.off('update', measure);
    };
  }, [editor, zoom]);

  return (
    <>
      <main className="notes__body">
        {source && (
          <textarea
            ref={sourceArea}
            className="notes__editor notes__source"
            value={text}
            onChange={(event) => {
              shownText.current = event.target.value;
              onChangeRef.current(event.target.value);
            }}
            aria-label="Note"
            disabled={!noteId}
          />
        )}
        <EditorContent editor={editor} className="notes__scroller" hidden={source} ref={scroller} />
      </main>
      {editor && linkOpen && (
        <LinkField
          editor={editor}
          onClose={(refocus) => {
            setLinkOpen(false);
            if (refocus) editor.commands.focus();
          }}
        />
      )}
      {formatBar && (
        <footer className="notes__footer">
          {source ? (
            <p className="notes__notice" role="status">
              Shown as Markdown: this note has things the editor can’t show yet, like a table or front matter.
            </p>
          ) : (
            editor && (
              <FormatBar
                editor={editor}
                linkOpen={linkOpen}
                setLinkOpen={setLinkOpen}
                length={length}
                onToggleCount={onToggleCount}
              />
            )
          )}
        </footer>
      )}
      {!formatBar && source && (
        <p className="notes__notice notes__notice--floating" role="status">
          Shown as Markdown: this note has things the editor can’t show yet, like a table or front matter.
        </p>
      )}
    </>
  );
}
