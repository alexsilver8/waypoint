import { compact, present } from './internal';
import type {
  Action,
  CommandImplementation,
  DetailView,
  Extension,
  ExtensionContext,
  FormField,
  FormView,
  ListItem,
  ListSection,
  ListView,
} from './types';

/**
 * What the builders skip in a list: `false`, `0`, `''`, `null` and `undefined`, so an entry can
 * be left out with `condition && entry`.
 */
export type Falsy = false | 0 | '' | null | undefined;

/**
 * Your extension's module export, typed: `export default defineExtension({ commands: { … } })`.
 * It returns the object as it is; the types are the point, so `ctx` and what each function
 * returns are checked, in TypeScript and in JavaScript with `// @ts-check`.
 */
export function defineExtension(extension: Extension): Extension {
  return extension;
}

/** One command's functions, typed, for commands written apart from `defineExtension`. */
export function defineCommand(
  command: CommandImplementation<ExtensionContext>,
): CommandImplementation<ExtensionContext> {
  return command;
}

/** A list section, whose items may include `false`, `null` or `undefined` to skip. */
export interface SectionOptions extends Omit<ListSection, 'items'> {
  items: ReadonlyArray<ListItem | Falsy>;
}

/**
 * Everything a list view has but its `type`. Give `sections`, or `items` for one untitled
 * section; either may include `false`, `null` or `undefined` to skip.
 */
export type ListOptions = Omit<ListView, 'type' | 'sections'> &
  (
    | { sections?: ReadonlyArray<SectionOptions | Falsy>; items?: never }
    | { items?: ReadonlyArray<ListItem | Falsy>; sections?: never }
  );

/**
 * A list view: `list({ title: 'Bookmarks', items: bookmarks.map(toItem) })`. Skipped entries
 * are left out, and `items` becomes one untitled section.
 */
export function list(options: ListOptions = {}): ListView {
  const { items, sections, ...rest } = options;
  const all: ReadonlyArray<SectionOptions | Falsy> = items !== undefined ? [{ items }] : (sections ?? []);
  return compact({
    type: 'list',
    ...rest,
    sections: present(all).map((section) => compact({ ...section, items: present(section.items) })),
  });
}

/** A list item. Its `id` defaults to its title; `actions` and `keywords` may skip entries. */
export interface ItemOptions extends Omit<ListItem, 'id' | 'actions' | 'keywords'> {
  /** Unique within the view. The title when left out. */
  id?: string;
  actions?: ReadonlyArray<Action | Falsy>;
  keywords?: ReadonlyArray<string | Falsy>;
}

/**
 * A list item: `item({ title: uuid, icon: Icon.emoji('🎲'), actions: [Action.copy(uuid)] })`.
 * The `id` defaults to the title, and skipped actions and keywords are left out.
 */
export function item(options: ItemOptions): ListItem {
  const { id, actions, keywords, ...rest } = options;
  const words = present(keywords);
  return compact({
    id: id ?? options.title,
    ...rest,
    keywords: words.length > 0 ? words : undefined,
    actions: present(actions),
  });
}

/** Everything a detail view has but its `type`; `actions` and `metadata` may skip entries. */
export interface DetailOptions extends Omit<DetailView, 'type' | 'actions' | 'metadata'> {
  actions?: ReadonlyArray<Action | Falsy>;
  metadata?: ReadonlyArray<NonNullable<DetailView['metadata']>[number] | Falsy>;
}

/**
 * A detail view, a page of Markdown: `detail(readme, { title: 'README' })`, or
 * `detail({ markdown, metadata, actions })`.
 */
export function detail(markdown: string, options?: Omit<DetailOptions, 'markdown'>): DetailView;
export function detail(options: DetailOptions): DetailView;
export function detail(input: string | DetailOptions, more?: Omit<DetailOptions, 'markdown'>): DetailView {
  const options: DetailOptions = typeof input === 'string' ? { ...more, markdown: input } : input;
  const { actions, metadata, ...rest } = options;
  return compact({
    type: 'detail',
    ...rest,
    metadata: metadata === undefined ? undefined : present(metadata),
    actions: actions === undefined ? undefined : present(actions),
  });
}

/**
 * Everything a form has but its `type`. `submit` may be just the submit action's id, and
 * `fields` and `actions` may skip entries.
 */
export interface FormOptions extends Omit<FormView, 'type' | 'fields' | 'submit' | 'actions'> {
  fields: ReadonlyArray<FormField | Falsy>;
  /** Passed to `onAction` as its id when the form is submitted: an id, or `{ id, title }`. */
  submit: FormView['submit'] | string;
  actions?: ReadonlyArray<Action | Falsy>;
}

/**
 * A form: `form({ title: 'New Bookmark', fields: [field.text('url', 'URL')], submit: 'save' })`.
 * Submitting it calls `onAction('save', values, ctx)`; see `field` for the fields.
 */
export function form(options: FormOptions): FormView {
  const { fields, submit, actions, ...rest } = options;
  return compact({
    type: 'form',
    ...rest,
    fields: present(fields),
    submit: typeof submit === 'string' ? { id: submit } : compact({ ...submit }),
    actions: actions === undefined ? undefined : present(actions),
  });
}

/**
 * Label–value pairs for a preview or a detail view, from an object:
 * `metadata({ Port: 3000, User: port.user })`. Numbers become text, and empty values
 * (`undefined`, `null`, `false`, `''`) are left out. Keys keep their order, except that
 * JavaScript puts keys that are whole numbers, like `'2024'`, first.
 */
export function metadata(
  entries: Record<string, string | number | false | null | undefined>,
): Array<{ label: string; value: string }> {
  return Object.entries(entries).flatMap(([label, value]) =>
    value === undefined || value === null || value === false || value === '' ? [] : [{ label, value: String(value) }],
  );
}
