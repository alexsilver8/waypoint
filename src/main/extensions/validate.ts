/**
 * Validation for everything that comes from third-party extensions: their manifest in
 * package.json, and the views and results their commands return at runtime. Extension
 * output is never trusted to be well-formed — bad items are dropped instead of crashing
 * the launcher.
 */
import { isAbsolute, relative, resolve } from 'node:path';
import { MAX_MARKDOWN } from '../../shared/markdown-limits';
import type {
  Action,
  ActionResult,
  BuiltinIconName,
  CommandManifest,
  DetailView,
  ExtensionManifest,
  FormField,
  FormView,
  Icon,
  ItemDetail,
  Json,
  ListItem,
  ListSection,
  ListView,
  Platform,
  Shortcut,
  Tint,
  View,
} from '../../shared/types';

export class ValidationError extends Error {}

const NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const IMAGE_PATTERN = /\.(png|jpe?g|gif|webp|svg|ico|icns)$/i;
const PLATFORMS: Platform[] = ['darwin', 'win32', 'linux'];
const TINTS: Tint[] = ['red', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'pink', 'gray'];
/** Every built-in glyph; a `Record` so a name added to the type can't be forgotten here. */
const BUILTIN_ICON_NAMES: Record<BuiltinIconName, true> = {
  alert: true,
  app: true,
  battery: true,
  calculator: true,
  clipboard: true,
  close: true,
  copy: true,
  cpu: true,
  eject: true,
  extension: true,
  file: true,
  folder: true,
  'git-commit': true,
  globe: true,
  'hard-drive': true,
  info: true,
  link: true,
  lock: true,
  'log-out': true,
  memory: true,
  monitor: true,
  moon: true,
  music: true,
  network: true,
  note: true,
  pause: true,
  play: true,
  plug: true,
  power: true,
  refresh: true,
  restart: true,
  search: true,
  server: true,
  settings: true,
  'skip-back': true,
  'skip-forward': true,
  sparkles: true,
  terminal: true,
  text: true,
  trash: true,
  wifi: true,
  'wifi-off': true,
  'window-left-half': true,
  'window-right-half': true,
  'window-top-half': true,
  'window-bottom-half': true,
  'window-top-left': true,
  'window-top-right': true,
  'window-bottom-left': true,
  'window-bottom-right': true,
  'window-first-third': true,
  'window-center-third': true,
  'window-last-third': true,
  'window-first-two-thirds': true,
  'window-last-two-thirds': true,
  'window-maximize': true,
  'window-almost-maximize': true,
  'window-center': true,
  'window-next-display': true,
  'window-previous-display': true,
  'window-restore': true,
};
const BUILTIN_ICONS = Object.keys(BUILTIN_ICON_NAMES) as BuiltinIconName[];
const MAX_ITEMS = 2000;
const MAX_TEXT = 1000;
const MAX_DETAIL = 20_000;
/** Actions of a detail view or a form; a list item's are counted with its list. */
const MAX_VIEW_ACTIONS = 50;
const MAX_FIELDS = 50;
const MAX_OPTIONS = 500;
/** A one-line field holds up to a long URL; a text area as much as a page. */
const MAX_FIELD_TEXT = 10_000;
const MAX_TEXTAREA = 100_000;
/** Text an action may copy or paste: plenty for any snippet, but not unbounded. */
const MAX_CLIPBOARD_TEXT = 1_000_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown, max = MAX_TEXT): string | undefined {
  if (typeof value !== 'string') return undefined;
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function stringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const list = value.filter((v): v is string => typeof v === 'string').map((v) => v.slice(0, 100));
  return list.length > 0 ? list.slice(0, 50) : undefined;
}

/**
 * Accepts `"🎉"`, `"assets/icon.png"` (relative to `baseDir`), or the object forms of
 * `Icon`. Returns `undefined` for anything else.
 */
const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/**
 * An emoji or a few characters of text. Counted as people see them, so an emoji built from
 * several code points (a family, a skin tone) still counts as one.
 */
function isShortText(value: string): boolean {
  if (value.length === 0 || value.length > 40) return false;
  // Three code units can't be more than three characters; only longer text needs counting.
  return value.length <= 3 || [...graphemes.segment(value)].length <= 3;
}

export function sanitizeIcon(value: unknown, baseDir?: string): Icon | undefined {
  if (typeof value === 'string') {
    if (IMAGE_PATTERN.test(value)) {
      if (isAbsolute(value)) return { path: value };
      return baseDir ? { path: resolve(baseDir, value) } : undefined;
    }
    return isShortText(value) && !/[\\/]/.test(value) ? { emoji: value } : undefined;
  }
  if (!isRecord(value)) return undefined;
  if (typeof value.builtin === 'string' && (BUILTIN_ICONS as string[]).includes(value.builtin)) {
    const tint =
      typeof value.tint === 'string' && (TINTS as string[]).includes(value.tint) ? (value.tint as Tint) : undefined;
    return tint ? { builtin: value.builtin as BuiltinIconName, tint } : { builtin: value.builtin as BuiltinIconName };
  }
  if (typeof value.emoji === 'string' && isShortText(value.emoji)) return { emoji: value.emoji };
  if (typeof value.path === 'string') {
    // The object form may point at any file; non-images show their OS icon.
    if (isAbsolute(value.path)) return { path: value.path };
    return IMAGE_PATTERN.test(value.path) && baseDir ? { path: resolve(baseDir, value.path) } : undefined;
  }
  return undefined;
}

function sanitizeShortcut(value: unknown): Shortcut | undefined {
  if (!isRecord(value) || typeof value.key !== 'string' || value.key.length === 0) return undefined;
  const allowed = ['mod', 'shift', 'alt', 'ctrl'] as const;
  const modifiers = Array.isArray(value.modifiers)
    ? value.modifiers.filter((m): m is (typeof allowed)[number] => (allowed as readonly unknown[]).includes(m))
    : undefined;
  return modifiers && modifiers.length > 0 ? { key: value.key, modifiers } : { key: value.key };
}

function isJson(value: unknown, depth = 0): value is Json {
  if (depth > 20) return false;
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every((v) => isJson(v, depth + 1));
  if (isRecord(value)) return Object.values(value).every((v) => isJson(v, depth + 1));
  return false;
}

export function sanitizeAction(value: unknown): Action | undefined {
  if (!isRecord(value)) return undefined;
  const title = text(value.title, 100);
  const shortcut = sanitizeShortcut(value.shortcut);
  const base = {
    ...(title ? { title } : {}),
    ...(shortcut ? { shortcut } : {}),
    ...(value.panelOnly === true ? { panelOnly: true } : {}),
  };

  switch (value.type) {
    case 'open-url': {
      const url = text(value.url, 8192);
      return url ? { ...base, type: 'open-url', url } : undefined;
    }
    case 'open-path':
    case 'reveal-path': {
      const path = text(value.path, 4096);
      return path && isAbsolute(path) ? { ...base, type: value.type, path } : undefined;
    }
    case 'copy':
    case 'paste': {
      const copied = typeof value.text === 'string' ? value.text.slice(0, MAX_CLIPBOARD_TEXT) : undefined;
      return copied !== undefined ? { ...base, type: value.type, text: copied } : undefined;
    }
    case 'open-command': {
      const ref = value.ref;
      if (!isRecord(ref) || typeof ref.extension !== 'string' || typeof ref.command !== 'string') return undefined;
      const argument = text(value.argument);
      return {
        ...base,
        type: 'open-command',
        ref: { extension: ref.extension, command: ref.command },
        ...(argument !== undefined ? { argument } : {}),
      };
    }
    case 'callback': {
      const id = text(value.id, 200);
      if (!id || !title) return undefined;
      if (value.payload !== undefined && !isJson(value.payload)) return undefined;
      return {
        ...base,
        type: 'callback',
        title,
        id,
        ...(value.payload !== undefined ? { payload: value.payload as Json } : {}),
        ...(value.style === 'destructive' ? { style: 'destructive' as const } : {}),
      };
    }
    default:
      return undefined;
  }
}

function sanitizeMetadata(value: unknown, max: number): Array<{ label: string; value: string }> | undefined {
  if (!Array.isArray(value)) return undefined;
  const metadata = value
    .filter(isRecord)
    .map((entry) => ({ label: text(entry.label, 60), value: text(entry.value, 200) }))
    .filter((entry): entry is { label: string; value: string } => Boolean(entry.label && entry.value))
    .slice(0, max);
  return metadata.length > 0 ? metadata : undefined;
}

function sanitizeActions(value: unknown, max = Number.POSITIVE_INFINITY): Action[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(sanitizeAction)
    .filter((a): a is Action => a !== undefined)
    .slice(0, max);
}

export function sanitizeDetail(value: unknown): ItemDetail | undefined {
  if (!isRecord(value)) return undefined;
  const body = typeof value.body === 'string' ? value.body.slice(0, MAX_DETAIL) : undefined;
  const markdown = typeof value.markdown === 'string' ? value.markdown.slice(0, MAX_DETAIL) : undefined;
  if (body === undefined && markdown === undefined) return undefined;
  const detail: ItemDetail = {};
  if (body !== undefined) detail.body = body;
  if (markdown !== undefined) detail.markdown = markdown;
  const title = text(value.title, 200);
  if (title) detail.title = title;
  const metadata = sanitizeMetadata(value.metadata, 12);
  if (metadata) detail.metadata = metadata;
  return detail;
}

function sanitizeItem(value: unknown, baseDir: string | undefined, seen: Set<string>): ListItem | undefined {
  if (!isRecord(value)) return undefined;
  const title = text(value.title);
  if (title === undefined) return undefined;
  let id = text(value.id, 200) ?? title;
  for (let n = 2; seen.has(id); n++) id = `${text(value.id, 200) ?? title}#${n}`;
  seen.add(id);

  const item: ListItem = { id, title, actions: sanitizeActions(value.actions) };
  const subtitle = text(value.subtitle);
  const accessory = text(value.accessory, 100);
  const keywords = stringList(value.keywords);
  const icon = sanitizeIcon(value.icon, baseDir);
  if (subtitle) item.subtitle = subtitle;
  if (accessory) item.accessory = accessory;
  if (keywords) item.keywords = keywords;
  if (icon) item.icon = icon;
  const detail = sanitizeDetail(value.detail);
  if (detail) item.detail = detail;
  return item;
}

/** Validates a view returned by a command: a list, a detail view or a form. */
export function sanitizeView(value: unknown, baseDir?: string): View {
  if (isRecord(value)) {
    if (value.type === 'list') return sanitizeListView(value, baseDir);
    if (value.type === 'detail') return sanitizeDetailView(value);
    if (value.type === 'form') return sanitizeFormView(value, baseDir);
  }
  throw new ValidationError('A view must be an object with type "list", "detail" or "form".');
}

/** `items` is accepted as shorthand for one section. */
function sanitizeListView(value: Record<string, unknown>, baseDir: string | undefined): ListView {
  const rawSections: unknown[] = Array.isArray(value.sections)
    ? value.sections
    : Array.isArray(value.items)
      ? [{ items: value.items }]
      : [];
  const seen = new Set<string>();
  let budget = MAX_ITEMS;
  const sections: ListSection[] = [];
  for (const raw of rawSections) {
    if (!isRecord(raw) || !Array.isArray(raw.items)) continue;
    const items = raw.items
      .slice(0, Math.max(0, budget))
      .map((item) => sanitizeItem(item, baseDir, seen))
      .filter((item): item is ListItem => item !== undefined);
    budget -= items.length;
    const title = text(raw.title, 100);
    sections.push(title ? { title, items } : { items });
  }

  const view: ListView = { type: 'list', sections };
  const title = text(value.title, 100);
  const searchPlaceholder = text(value.searchPlaceholder, 100);
  const emptyText = text(value.emptyText, 200);
  if (title) view.title = title;
  if (searchPlaceholder) view.searchPlaceholder = searchPlaceholder;
  if (emptyText) view.emptyText = emptyText;
  if (value.filtering === false) view.filtering = false;
  if (value.loading === true) view.loading = true;
  return view;
}

/** Text that isn't a string shows as an empty page, so a view that's still loading needn't have any yet. */
function sanitizeDetailView(value: Record<string, unknown>): DetailView {
  const markdown = typeof value.markdown === 'string' ? value.markdown.slice(0, MAX_MARKDOWN) : '';
  const view: DetailView = { type: 'detail', markdown };
  const title = text(value.title, 100);
  const metadata = sanitizeMetadata(value.metadata, 24);
  const actions = sanitizeActions(value.actions, MAX_VIEW_ACTIONS);
  if (title) view.title = title;
  if (metadata) view.metadata = metadata;
  if (actions.length > 0) view.actions = actions;
  if (value.loading === true) view.loading = true;
  return view;
}

/**
 * A form's fields, with the ones that can't be shown dropped: an unknown type, a missing or
 * repeated id, a dropdown with nothing to pick. A default value of the wrong kind is left out.
 */
function sanitizeFormField(value: unknown, baseDir: string | undefined, ids: Set<string>): FormField | undefined {
  if (!isRecord(value)) return undefined;
  if (value.type === 'separator') return { type: 'separator' };
  if (value.type === 'description') {
    const body = text(value.text, 2000);
    if (!body) return undefined;
    const title = text(value.title, 100);
    return title ? { type: 'description', title, text: body } : { type: 'description', text: body };
  }

  // The id is the key of the field's value; `__proto__` couldn't be one.
  const id = typeof value.id === 'string' && value.id.length <= 100 ? value.id : undefined;
  if (!id || id === '__proto__' || ids.has(id)) return undefined;
  const base = { id, title: text(value.title, 100) ?? '' };
  const info = text(value.info, 300);
  const withInfo = <T extends object>(field: T): T => (info ? { ...field, info } : field);

  switch (value.type) {
    case 'text':
    case 'password':
    case 'textarea': {
      const field: Extract<FormField, { type: 'text' | 'password' | 'textarea' }> = { ...base, type: value.type };
      const placeholder = text(value.placeholder, 200);
      const max = value.type === 'textarea' ? MAX_TEXTAREA : MAX_FIELD_TEXT;
      if (placeholder) field.placeholder = placeholder;
      if (typeof value.defaultValue === 'string') field.defaultValue = value.defaultValue.slice(0, max);
      if (value.required === true) field.required = true;
      ids.add(id);
      return withInfo(field);
    }
    case 'checkbox': {
      const field: Extract<FormField, { type: 'checkbox' }> = { ...base, type: 'checkbox' };
      const label = text(value.label, 200);
      if (label) field.label = label;
      if (typeof value.defaultValue === 'boolean') field.defaultValue = value.defaultValue;
      ids.add(id);
      return withInfo(field);
    }
    case 'dropdown': {
      if (!Array.isArray(value.options)) return undefined;
      const values = new Set<string>();
      const options: Extract<FormField, { type: 'dropdown' }>['options'] = [];
      for (const raw of value.options) {
        if (options.length >= MAX_OPTIONS) break;
        if (!isRecord(raw) || typeof raw.value !== 'string' || raw.value.length > MAX_TEXT) continue;
        if (values.has(raw.value)) continue;
        const title = text(raw.title, 200) || raw.value;
        if (!title) continue;
        const icon = sanitizeIcon(raw.icon, baseDir);
        values.add(raw.value);
        options.push(icon ? { value: raw.value, title, icon } : { value: raw.value, title });
      }
      if (options.length === 0) return undefined;
      const field: Extract<FormField, { type: 'dropdown' }> = { ...base, type: 'dropdown', options };
      if (typeof value.defaultValue === 'string' && values.has(value.defaultValue)) {
        field.defaultValue = value.defaultValue;
      }
      ids.add(id);
      return withInfo(field);
    }
    default:
      return undefined;
  }
}

function sanitizeFormView(value: Record<string, unknown>, baseDir: string | undefined): FormView {
  const submit = isRecord(value.submit) ? value.submit : undefined;
  const submitId = text(submit?.id, 200);
  if (!submitId) throw new ValidationError('A form needs a submit action: `submit: { id }`.');
  const submitTitle = text(submit?.title, 100);

  const ids = new Set<string>();
  const fields = (Array.isArray(value.fields) ? value.fields.slice(0, MAX_FIELDS) : [])
    .map((field) => sanitizeFormField(field, baseDir, ids))
    .filter((field): field is FormField => field !== undefined);
  const view: FormView = {
    type: 'form',
    fields,
    submit: submitTitle ? { id: submitId, title: submitTitle } : { id: submitId },
  };
  const title = text(value.title, 100);
  const actions = sanitizeActions(value.actions, MAX_VIEW_ACTIONS);
  if (title) view.title = title;
  if (actions.length > 0) view.actions = actions;
  return view;
}

/** Validates what a command's `run()` or `onAction()` returned. `undefined` means "nothing special". */
export function sanitizeActionResult(value: unknown, baseDir?: string): ActionResult | undefined {
  if (value === undefined || value === null) return undefined;
  if (!isRecord(value)) throw new ValidationError('A command must return an object or nothing.');
  const result: ActionResult = {};
  if (value.hide === true) result.hide = true;
  if (value.pop === true) result.pop = true;
  if (value.clearSearch === true) result.clearSearch = true;
  if (typeof value.search === 'string') result.search = value.search.slice(0, 500);
  const toast = text(value.toast, 200);
  if (toast) result.toast = toast;
  if (value.toastStyle === 'success' || value.toastStyle === 'failure') result.toastStyle = value.toastStyle;
  if (value.push !== undefined) result.push = sanitizeView(value.push, baseDir);
  if (value.replace !== undefined) result.replace = sanitizeView(value.replace, baseDir);
  if (typeof value.copy === 'string') result.copy = value.copy.slice(0, MAX_CLIPBOARD_TEXT);
  if (typeof value.paste === 'string') result.paste = value.paste.slice(0, MAX_CLIPBOARD_TEXT);
  return result;
}

function parseCommand(value: unknown, index: number, dir: string): CommandManifest {
  if (!isRecord(value)) throw new ValidationError(`commands[${index}] must be an object.`);
  const name = value.name;
  if (typeof name !== 'string' || !NAME_PATTERN.test(name)) {
    throw new ValidationError(`commands[${index}].name must use lowercase letters, digits and dashes.`);
  }
  const title = text(value.title, 100);
  if (!title) throw new ValidationError(`Command "${name}" needs a title.`);
  if (value.mode !== 'view' && value.mode !== 'no-view') {
    throw new ValidationError(`Command "${name}" needs a mode of "view" or "no-view".`);
  }
  const command: CommandManifest = { name, title, mode: value.mode };
  const subtitle = text(value.subtitle, 100);
  const icon = sanitizeIcon(value.icon, dir);
  const keywords = stringList(value.keywords);
  if (subtitle) command.subtitle = subtitle;
  if (icon) command.icon = icon;
  if (keywords) command.keywords = keywords;
  if (value.fallback === true) command.fallback = true;
  if (Array.isArray(value.platforms)) {
    command.platforms = value.platforms.filter((p): p is Platform => (PLATFORMS as unknown[]).includes(p));
  }
  return command;
}

export interface ParsedExtension {
  manifest: ExtensionManifest;
  /** Absolute path of the module to import. */
  entry: string;
}

/**
 * Reads an extension's package.json. The launcher-specific fields live under
 * `waypoint`; see docs/extensions.md.
 */
export function parseExtensionPackage(pkg: unknown, dir: string): ParsedExtension {
  if (!isRecord(pkg)) throw new ValidationError('package.json must be an object.');
  const rawName = typeof pkg.name === 'string' ? pkg.name.replace(/^@[^/]+\//, '') : '';
  if (!NAME_PATTERN.test(rawName)) {
    throw new ValidationError('package.json "name" must use lowercase letters, digits and dashes.');
  }
  // "openPalette" is the key from before the rename.
  const config = pkg.waypoint ?? pkg.openPalette;
  if (!isRecord(config)) throw new ValidationError('package.json needs a "waypoint" section.');
  const title = text(config.title, 100);
  if (!title) throw new ValidationError('"waypoint.title" is required.');
  if (!Array.isArray(config.commands) || config.commands.length === 0) {
    throw new ValidationError('"waypoint.commands" must list at least one command.');
  }
  const commands = config.commands.map((command, index) => parseCommand(command, index, dir));
  const names = new Set<string>();
  for (const command of commands) {
    if (names.has(command.name)) throw new ValidationError(`Duplicate command name "${command.name}".`);
    names.add(command.name);
  }

  const main = typeof pkg.main === 'string' ? pkg.main : 'index.js';
  const entry = resolve(dir, main);
  const fromDir = relative(dir, entry);
  if (fromDir.startsWith('..') || isAbsolute(fromDir)) {
    throw new ValidationError('"main" must point inside the extension folder.');
  }

  const manifest: ExtensionManifest = { name: rawName, title, commands };
  const description = text(config.description ?? pkg.description, 300);
  const icon = sanitizeIcon(config.icon, dir);
  if (description) manifest.description = description;
  if (icon) manifest.icon = icon;
  return { manifest, entry };
}
