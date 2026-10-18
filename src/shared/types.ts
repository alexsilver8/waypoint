/**
 * Core data model shared by the main process, the extension host and the renderer.
 *
 * Everything here crosses a process boundary (IPC or the extension-host channel),
 * so it must stay plain, JSON-serialisable data — no functions, no class instances.
 */

export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

export type Platform = 'darwin' | 'win32' | 'linux';

export type Tint = 'red' | 'orange' | 'yellow' | 'green' | 'teal' | 'blue' | 'purple' | 'pink' | 'gray';

/** Built-in glyphs the launcher knows how to draw. */
export type BuiltinIconName =
  | 'alert'
  | 'app'
  | 'battery'
  | 'calculator'
  | 'clipboard'
  | 'close'
  | 'copy'
  | 'cpu'
  | 'eject'
  | 'extension'
  | 'file'
  | 'folder'
  | 'git-commit'
  | 'globe'
  | 'hard-drive'
  | 'info'
  | 'link'
  | 'lock'
  | 'log-out'
  | 'memory'
  | 'monitor'
  | 'moon'
  | 'music'
  | 'network'
  | 'note'
  | 'pause'
  | 'play'
  | 'plug'
  | 'power'
  | 'refresh'
  | 'restart'
  | 'search'
  | 'server'
  | 'settings'
  | 'skip-back'
  | 'skip-forward'
  | 'sparkles'
  | 'terminal'
  | 'text'
  | 'trash'
  | 'wifi'
  | 'wifi-off'
  | WindowIconName;

/** Glyphs of a screen with the part a window would fill, for window layouts. */
export type WindowIconName =
  | 'window-left-half'
  | 'window-right-half'
  | 'window-top-half'
  | 'window-bottom-half'
  | 'window-top-left'
  | 'window-top-right'
  | 'window-bottom-left'
  | 'window-bottom-right'
  | 'window-first-third'
  | 'window-center-third'
  | 'window-last-third'
  | 'window-first-two-thirds'
  | 'window-last-two-thirds'
  | 'window-maximize'
  | 'window-almost-maximize'
  | 'window-center'
  | 'window-next-display'
  | 'window-previous-display'
  | 'window-restore';

export type Icon =
  /** A built-in glyph on a coloured tile. */
  | { builtin: BuiltinIconName; tint?: Tint }
  /** A single emoji or short text. */
  | { emoji: string }
  /** An absolute path: image files are shown as-is, anything else shows its OS icon. */
  | { path: string };

/** Keyboard shortcut for an action. `mod` is ⌘ on macOS and Ctrl elsewhere. */
export interface Shortcut {
  key: string;
  modifiers?: Array<'mod' | 'shift' | 'alt' | 'ctrl'>;
}

/**
 * Where an extension comes from: compiled into the app (`builtin`), shipped with it but written
 * against the extension API like any other (`bundled`), or added by you (`user`).
 */
export type ExtensionSource = 'builtin' | 'bundled' | 'user';

/** Identifies a command: `extension` is the extension's name, `command` the command's name. */
export interface CommandRef {
  extension: string;
  command: string;
}

interface ActionBase {
  /** Label shown in the action panel. A sensible default is used when omitted. */
  title?: string;
  shortcut?: Shortcut;
}

/**
 * Something the user can do with an item. The first action of an item is the primary
 * one (↵), the second is the secondary one (⌘↵ / Ctrl+↵), and all of them are listed in
 * the action panel (⌘K / Ctrl+K).
 */
export type Action =
  | (ActionBase & { type: 'open-command'; ref: CommandRef; argument?: string })
  | (ActionBase & { type: 'open-url'; url: string })
  | (ActionBase & { type: 'open-path'; path: string })
  | (ActionBase & { type: 'reveal-path'; path: string })
  | (ActionBase & { type: 'copy'; text: string })
  /** Pastes the text into the app that was in front before the launcher opened. */
  | (ActionBase & { type: 'paste'; text: string })
  /** Calls back into the command that produced the item (`onAction(id, payload)`). */
  | (ActionBase & { type: 'callback'; title: string; id: string; payload?: Json; style?: 'destructive' });

/** A closer look at an item, shown in the preview pane beside the list. */
export interface ItemDetail {
  title?: string;
  /**
   * Plain text. Lines starting with "# " are drawn as headings, "- " as bullets and
   * "- [ ] " / "- [x] " as checkboxes; everything else as written.
   */
  body?: string;
  /** Markdown, drawn like a detail view's, in place of `body`. One of the two is needed. */
  markdown?: string;
  /** Short facts under the body, e.g. "Edited" → "2 min ago". */
  metadata?: Array<{ label: string; value: string }>;
}

export interface ListItem {
  /** Stable within its view; used for selection and React keys. */
  id: string;
  title: string;
  subtitle?: string;
  icon?: Icon;
  /** Extra terms the fuzzy search matches against. */
  keywords?: string[];
  /** Short right-aligned text, e.g. "Command" or "2 min ago". */
  accessory?: string;
  actions: Action[];
  /** When any item in a list has one, the launcher shows a preview pane. */
  detail?: ItemDetail;
}

export interface ListSection {
  title?: string;
  items: ListItem[];
}

export interface ListView {
  type: 'list';
  /** Shown next to the search field while the view is open. */
  title?: string;
  searchPlaceholder?: string;
  sections: ListSection[];
  /**
   * `true` (default): the launcher fuzzy-filters the items as the user types.
   * `false`: the command filters itself — its `view()` is called again with the new query.
   */
  filtering?: boolean;
  /** Shown when there is nothing to list. */
  emptyText?: string;
  /**
   * The list is still filling in, e.g. while a scan runs. The launcher shows that it's busy and,
   * while it's open, calls `view()` again about once a second with the same query, until a list
   * comes back without `loading`.
   */
  loading?: boolean;
}

/** A page of Markdown: a README, an article, the result of a command. */
export interface DetailView {
  type: 'detail';
  /** Shown next to the search field while the view is open. */
  title?: string;
  /** CommonMark with GitHub's tables, task lists and strikethrough. Raw HTML is shown as text. */
  markdown: string;
  /** Short facts shown beside the text, e.g. "Version" → "1.2.0". */
  metadata?: Array<{ label: string; value: string }>;
  /** ↵ runs the first, ⌘↵ the second, and ⌘K lists them all, as for a list item. */
  actions?: Action[];
  /**
   * Still loading: the launcher shows that it's busy and calls `view()` again about once a
   * second, until a view comes back without `loading`.
   */
  loading?: boolean;
}

interface FormFieldBase {
  /** Key of the field's value in the submitted values; unique within the form. */
  id: string;
  /** Label shown beside the field. */
  title: string;
  /** A hint shown under the field. */
  info?: string;
}

export type FormField =
  | (FormFieldBase & {
      type: 'text' | 'password' | 'textarea';
      placeholder?: string;
      defaultValue?: string;
      /** The form can't be submitted while this is empty. */
      required?: boolean;
    })
  | (FormFieldBase & { type: 'checkbox'; label?: string; defaultValue?: boolean })
  | (FormFieldBase & {
      type: 'dropdown';
      options: Array<{ value: string; title: string; icon?: Icon }>;
      /** The first option when omitted. */
      defaultValue?: string;
    })
  /** Text between fields, not a field: it has no value. */
  | { type: 'description'; title?: string; text: string }
  | { type: 'separator' };

/** What a form submits: each field's `id` to its value (a string, or a boolean for checkboxes). */
export type FormValues = Record<string, string | boolean>;

/**
 * A form to fill in. Submitting it (⌘↵, or its submit button) calls the command's
 * `onAction(submit.id, values, ctx)` with the form's `FormValues` as the payload. Put what the
 * form is about in the id (`save:<id>`) when one command has several forms. Whatever
 * `onAction` returns is applied as usual: `pop: true` to go back, a failure toast to stay.
 */
export interface FormView {
  type: 'form';
  /** Shown next to the search field while the view is open. */
  title?: string;
  fields: FormField[];
  submit: {
    /** Passed to `onAction` as its `id`. */
    id: string;
    /** Defaults to "Submit". */
    title?: string;
  };
  /** More actions for the action panel (⌘K), after the submit action. */
  actions?: Action[];
}

export type View = ListView | DetailView | FormView;

/** What should happen in the launcher after a command ran or an action was performed. */
export interface ActionResult {
  /** Hide the launcher window. */
  hide?: boolean;
  /** Short message shown in the footer. */
  toast?: string;
  toastStyle?: 'success' | 'failure';
  /** Open a new view on top of the current one. */
  push?: View;
  /** Replace the current view, e.g. after deleting an item. */
  replace?: View;
  /** Go back to the previous view. */
  pop?: boolean;
  /** Empty the search field, e.g. after its text was used to create something. */
  clearSearch?: boolean;
  /** Put this text in the search field, e.g. to start a message the user finishes typing. */
  search?: string;
  /** Copy this text to the clipboard and close the launcher. */
  copy?: string;
  /** Paste this text into the app that was in front before the launcher, and close the launcher. */
  paste?: string;
}

export interface CommandManifest {
  /** Unique within the extension: lowercase letters, digits and dashes. */
  name: string;
  title: string;
  subtitle?: string;
  icon?: Icon;
  keywords?: string[];
  /** `view` commands show a list, a detail view or a form; `no-view` commands just do something. */
  mode: 'view' | 'no-view';
  /**
   * Fallback commands are offered under "Use “…” with" when the search text matches
   * nothing well. They receive the search text as `ctx.argument`.
   */
  fallback?: boolean;
  /** Restrict the command to some operating systems. */
  platforms?: Platform[];
}

export interface ExtensionManifest {
  /** Unique across all installed extensions: lowercase letters, digits and dashes. */
  name: string;
  title: string;
  description?: string;
  icon?: Icon;
  commands: CommandManifest[];
}

/** A request, held by Waypoint itself, to keep the computer and its display awake. */
export interface WakeLock {
  /** When it started, in ms since the epoch. */
  since: number;
  /** When it ends by itself, in ms since the epoch; `null` holds until it's let go, or Waypoint quits. */
  until: number | null;
}

/** Passed to every command call. */
export interface CommandContext {
  /** Current text of the search field inside the command's view ("" when it opens). */
  query: string;
  /** Text handed over from the root search, for fallback commands. */
  argument?: string;
  platform: Platform;
}

type MaybePromise<T> = T | Promise<T>;
/** Commands may return nothing at all; `void` lets plain functions without a return type fit. */
// biome-ignore lint/suspicious/noConfusingVoidType: deliberately allows functions that return nothing
type OptionalResult = ActionResult | undefined | void;

/** What a command module implements. Built-ins and third-party extensions share this shape. */
export interface CommandImplementation<Ctx extends CommandContext = CommandContext> {
  /** Required for `view` commands. */
  view?(ctx: Ctx): MaybePromise<View>;
  /** Required for `no-view` commands. Hides the launcher unless the result says otherwise. */
  run?(ctx: Ctx): MaybePromise<OptionalResult>;
  /** Handles `callback` actions emitted by this command's items. */
  onAction?(id: string, payload: Json | undefined, ctx: Ctx): MaybePromise<OptionalResult>;
}

/** An entry of the root search: a command or an installed application. */
/** The kinds of things the root search finds, which are also its filter tabs. */
export type RootKind = 'command' | 'application' | 'note' | 'clipboard';

export interface RootItem extends ListItem {
  kind: RootKind;
  /** Usage-based score; higher means used more often and more recently. */
  frecency: number;
  /** Offered under "Use “…” with" and opened with the search text as argument. */
  fallback?: CommandRef;
  /** For commands: the extension they come from, to group them in the Extensions tab. */
  extension?: { name: string; title: string; source: ExtensionSource };
  /** For commands: the global shortcut that runs it, as an Electron accelerator. */
  hotkey?: string;
}

/** Where an action was triggered from, so the main process can route and record it. */
export interface ActionContext {
  /** The command whose view the action came from (needed for `callback` actions). */
  ref?: CommandRef;
  /** The root item the action belongs to, used to rank frequently used items higher. */
  rootItemId?: string;
  /** Current search text. */
  query?: string;
}
