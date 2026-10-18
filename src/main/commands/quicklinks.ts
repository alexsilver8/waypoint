import { basename, extname } from 'node:path';
import {
  PLACEHOLDER_NAMES,
  type PlaceholderValues,
  placeholderList,
  valuesWithClipboard,
} from '../../shared/placeholders';
import {
  argumentName,
  expandLink,
  isWebAddress,
  linkProblem,
  needsArgument,
  type Quicklink,
  quicklinkFields,
  shortLink,
  startsWithPlaceholder,
  takesArgument,
} from '../../shared/quicklinks';
import type {
  ActionResult,
  CommandRef,
  FormField,
  FormView,
  Icon,
  ItemDetail,
  Json,
  ListItem,
  Platform,
  RootItem,
  Shortcut,
  View,
} from '../../shared/types';
import { EntryError, type QuicklinkStore } from '../entry-store';
import { isSaveId, saveFromForm, saveId } from './entry-forms';
import type { BuiltinExtension } from './types';

/** An installed app, offered under Open With. */
export interface AppOption {
  name: string;
  path: string;
  iconPath?: string;
}

export interface QuicklinksOptions {
  store: QuicklinkStore;
  platform: Platform;
  /** Opens a quicklink, placeholders filled in, with the app it names if any. */
  open(link: string, openWith: string | undefined): Promise<void>;
  readClipboard(): Promise<string>;
  /** The installed apps in order of their names, for Open With. */
  apps(): readonly AppOption[];
  /** Opens Settings at Quicklinks, editing the one with this id. */
  editInSettings(id: string): void;
}

/**
 * Opens one quicklink. Its argument is the quicklink's id, then a line break and the text for
 * `{argument}` when some was typed. Not listed in the root search: the quicklinks' own rows run it.
 */
const OPEN: CommandRef = { extension: 'quicklinks', command: 'open' };
/** Edits one quicklink in a form; its argument is the quicklink's id. Not listed either. */
const EDIT: CommandRef = { extension: 'quicklinks', command: 'edit' };
const EDIT_SHORTCUT: Shortcut = { key: 'e', modifiers: ['mod'] };
const DELETE_SHORTCUT: Shortcut = { key: 'Backspace', modifiers: ['mod'] };
const LINK_ICON: Icon = { builtin: 'link', tint: 'blue' };
const DEFAULT_APP_ICON: Icon = { builtin: 'app', tint: 'gray' };

export function quicklinkIcon(quicklink: Quicklink): Icon {
  return quicklink.icon ? { emoji: quicklink.icon } : LINK_ICON;
}

/** "Firefox" for `/usr/share/applications/firefox.desktop` or `C:\…\Firefox.lnk`; names stay as they are. */
export function appLabel(openWith: string): string {
  if (!/[\\/]/.test(openWith)) return openWith;
  const name = basename(openWith.replace(/[\\/]+$/, '').replaceAll('\\', '/'));
  return name.slice(0, name.length - extname(name).length) || name;
}

type DropdownOption = Extract<FormField, { type: 'dropdown' }>['options'][number];

/** The hint under Link: what a link can be, and the placeholders it can hold. */
const LINK_INFO = [
  'A web address, a file or folder, or an app’s own link (spotify:).',
  'Put {argument} where what you type after its name goes;',
  `${placeholderList(PLACEHOLDER_NAMES.filter((name) => name !== 'argument'))} are filled in when it opens.`,
].join(' ');

/**
 * Open With's choices: the usual app, then every installed one. An app named by hand in the file,
 * or one that's no longer installed, is kept as a choice so saving doesn't lose it.
 */
function openWithOptions(openWith: string, apps: readonly AppOption[]): DropdownOption[] {
  const options: DropdownOption[] = [{ value: '', title: 'Default', icon: DEFAULT_APP_ICON }];
  if (openWith && !apps.some((app) => app.path === openWith)) {
    options.push({ value: openWith, title: appLabel(openWith) });
  }
  const seen = new Set(options.map((option) => option.value));
  for (const app of apps) {
    if (seen.has(app.path)) continue;
    seen.add(app.path);
    options.push({ value: app.path, title: app.name, icon: { path: app.iconPath ?? app.path } });
  }
  return options;
}

export interface QuicklinkFormOptions {
  /** The quicklink to change; a new one when left out. */
  quicklink?: Quicklink;
  /** For a new one, text to start from, like a web address typed in the root search. */
  text?: string;
  apps: readonly AppOption[];
}

/**
 * The form that makes a quicklink, or changes one, with the same fields as in Settings. It
 * submits with `save`, or `save:<id>` for the one it changes.
 */
export function quicklinkForm({ quicklink, text = '', apps }: QuicklinkFormOptions): FormView {
  const typed = quicklink ? '' : text.trim();
  // What was typed is the link when it could be one, and otherwise the name.
  const typedLink = typed && linkProblem(typed) === undefined ? typed : '';
  const openWith = quicklink?.openWith ?? '';
  return {
    type: 'form',
    title: quicklink ? 'Edit Quicklink' : 'Create Quicklink',
    submit: { id: saveId(quicklink?.id), title: quicklink ? 'Save Quicklink' : 'Create Quicklink' },
    fields: [
      {
        type: 'text',
        id: 'name',
        title: 'Name',
        placeholder: 'GitHub Search',
        defaultValue: quicklink?.name ?? (typedLink ? '' : typed),
        required: true,
        info: 'What you type in the launcher to find it.',
      },
      {
        type: 'text',
        id: 'link',
        title: 'Link',
        placeholder: 'https://github.com/search?q={argument}',
        defaultValue: quicklink?.link ?? typedLink,
        required: true,
        info: LINK_INFO,
      },
      {
        type: 'dropdown',
        id: 'openWith',
        title: 'Open With',
        options: openWithOptions(openWith, apps),
        defaultValue: openWith,
      },
      {
        type: 'text',
        id: 'icon',
        title: 'Icon',
        placeholder: '🔗',
        defaultValue: quicklink?.icon ?? '',
        info: 'An emoji. Leave it empty for a link.',
      },
    ],
  };
}

/** Your quicklinks, for the root search. Those with `{argument}` take what's typed after their name. */
export function quicklinkRootItems(store: QuicklinkStore, score: (id: string) => number): RootItem[] {
  return store.list().map((quicklink) => {
    const id = `quicklink:${quicklink.id}`;
    const item: RootItem = {
      id,
      kind: 'command',
      title: quicklink.name,
      subtitle: shortLink(quicklink.link),
      icon: quicklinkIcon(quicklink),
      accessory: 'Quicklink',
      frecency: score(id),
      actions: [
        { type: 'open-command', ref: OPEN, argument: quicklink.id, title: 'Open Quicklink' },
        { type: 'open-command', ref: EDIT, argument: quicklink.id, title: 'Edit Quicklink', shortcut: EDIT_SHORTCUT },
      ],
    };
    if (takesArgument(quicklink.link)) item.takesText = { ref: OPEN, prefix: `${quicklink.id}\n` };
    return item;
  });
}

/** Search Quicklinks, Create Quicklink, and the unlisted commands the quicklinks' rows run. */
export function quicklinksExtension(options: QuicklinksOptions): BuiltinExtension {
  const { store, platform, open, readClipboard, apps, editInSettings } = options;
  const enter = platform === 'darwin' ? '↵' : 'Enter';
  const valuesFor = (links: readonly string[]) => valuesWithClipboard(links, readClipboard);

  const detail = (quicklink: Quicklink, values: PlaceholderValues): ItemDetail => {
    const metadata: ItemDetail['metadata'] = [];
    const preview = expandLink(quicklink.link, values, true);
    if (preview !== quicklink.link) metadata.push({ label: 'Link', value: quicklink.link });
    if (takesArgument(quicklink.link)) {
      metadata.push({ label: 'Takes', value: `A ${argumentName(quicklink.link)}, typed after its name` });
    }
    if (quicklink.openWith) metadata.push({ label: 'Opens with', value: appLabel(quicklink.openWith) });
    return { body: preview, ...(metadata.length > 0 ? { metadata } : {}) };
  };

  const view = async (): Promise<View> => {
    const quicklinks = store.list();
    const values = await valuesFor(quicklinks.map((quicklink) => quicklink.link));
    const items: ListItem[] = quicklinks.map((quicklink) => ({
      id: quicklink.id,
      title: quicklink.name,
      subtitle: shortLink(quicklink.link),
      icon: quicklinkIcon(quicklink),
      keywords: [quicklink.link],
      ...(quicklink.openWith ? { accessory: appLabel(quicklink.openWith) } : {}),
      detail: detail(quicklink, values),
      actions: [
        { type: 'callback', id: 'open', payload: quicklink.id, title: 'Open Quicklink' },
        { type: 'callback', id: 'copy', payload: quicklink.id, title: 'Copy Link' },
        { type: 'callback', id: 'edit', payload: quicklink.id, title: 'Edit Quicklink', shortcut: EDIT_SHORTCUT },
        { type: 'callback', id: 'settings', payload: quicklink.id, title: 'Edit in Settings' },
        {
          type: 'callback',
          id: 'delete',
          payload: quicklink.id,
          title: 'Delete Quicklink',
          style: 'destructive',
          shortcut: DELETE_SHORTCUT,
        },
        { type: 'callback', id: 'create', title: 'Create Quicklink' },
      ],
    }));
    return {
      type: 'list',
      title: 'Quicklinks',
      searchPlaceholder: 'Search quicklinks…',
      sections: [{ title: `${items.length} quicklink${items.length === 1 ? '' : 's'}`, items }],
      emptyText: 'No quicklinks yet. Run Create Quicklink to add one.',
    };
  };

  /**
   * Opens a quicklink with the text typed for it. One that needs text and has none goes back to
   * the search with its name typed, so what's typed next is the text.
   */
  const openQuicklink = async (quicklink: Quicklink, text: string, fromList: boolean): Promise<ActionResult> => {
    if (!text && needsArgument(quicklink.link)) {
      return {
        ...(fromList ? { pop: true } : {}),
        search: `${quicklink.name} `,
        toast: `Type the ${argumentName(quicklink.link)}, then press ${enter}`,
      };
    }
    const values = await valuesFor([quicklink.link]);
    const link = expandLink(quicklink.link, { ...values, argument: text });
    // What's filled in only decides where a web address goes, never that a file or an app opens.
    if (startsWithPlaceholder(quicklink.link) && !isWebAddress(link)) {
      return { toast: `“${quicklink.name}” only opens web addresses, and that isn’t one`, toastStyle: 'failure' };
    }
    await open(link, quicklink.openWith);
    return { hide: true };
  };

  const gone: ActionResult = { toast: 'That quicklink doesn’t exist any more.', toastStyle: 'failure' };
  const form = (quicklink?: Quicklink, text?: string) =>
    quicklinkForm({ ...(quicklink ? { quicklink } : {}), ...(text ? { text } : {}), apps: apps() });
  const toastFor = (created: boolean) => (created ? 'Quicklink created' : 'Quicklink saved');

  /**
   * A form opened from the root search (Create Quicklink, or ⌘E on a quicklink there) goes back
   * to it once saved, which shows the change. A new one empties the search, ready to try it.
   */
  const saveFromRoot = (id: string, values: Json | undefined): ActionResult | undefined => {
    if (!isSaveId(id)) return undefined;
    const saved = saveFromForm(store, id, quicklinkFields(values));
    if (saved.failure) return saved.failure;
    return { pop: true, ...(saved.created ? { clearSearch: true } : {}), toast: toastFor(saved.created) };
  };

  return {
    manifest: {
      name: 'quicklinks',
      title: 'Quicklinks',
      icon: LINK_ICON,
      commands: [
        {
          name: 'search',
          title: 'Search Quicklinks',
          mode: 'view',
          icon: { builtin: 'search', tint: 'blue' },
          keywords: ['links', 'bookmarks', 'open link'],
        },
        { name: 'create', title: 'Create Quicklink', mode: 'view', keywords: ['new quicklink', 'add link'] },
        { name: 'open', title: 'Open Quicklink', mode: 'no-view' },
        { name: 'edit', title: 'Edit Quicklink', mode: 'view' },
      ],
    },
    unlisted: ['open', 'edit'],
    commands: {
      search: {
        view,
        async onAction(id, payload) {
          if (id === 'create') return { push: form() };
          if (isSaveId(id)) {
            // Back to the list, with the change in it.
            const saved = saveFromForm(store, id, quicklinkFields(payload));
            if (saved.failure) return saved.failure;
            return { pop: true, replace: await view(), toast: toastFor(saved.created) };
          }
          const quicklink = typeof payload === 'string' ? store.get(payload) : undefined;
          if (!quicklink) return { ...gone, replace: await view() };
          if (id === 'open') return openQuicklink(quicklink, '', true);
          if (id === 'copy') return { copy: expandLink(quicklink.link, await valuesFor([quicklink.link])) };
          if (id === 'edit') return { push: form(quicklink) };
          if (id === 'settings') {
            editInSettings(quicklink.id);
            return { hide: true };
          }
          if (id === 'delete') {
            store.remove(quicklink.id);
            return { replace: await view(), toast: 'Quicklink deleted' };
          }
          return undefined;
        },
      },
      create: {
        // Opened with an argument, like a web address typed in the root search, it starts from that.
        view: (ctx) => form(undefined, ctx.argument),
        onAction: saveFromRoot,
      },
      open: {
        run(ctx) {
          const argument = ctx.argument ?? '';
          const lineBreak = argument.indexOf('\n');
          const id = lineBreak === -1 ? argument : argument.slice(0, lineBreak);
          const text = lineBreak === -1 ? '' : argument.slice(lineBreak + 1).trim();
          const quicklink = store.get(id);
          return quicklink ? openQuicklink(quicklink, text, false) : gone;
        },
      },
      edit: {
        view(ctx) {
          if (!ctx.argument) return form();
          const quicklink = store.get(ctx.argument);
          if (!quicklink) throw new EntryError('That quicklink doesn’t exist any more.');
          return form(quicklink);
        },
        onAction: saveFromRoot,
      },
    },
  };
}
