import { basename, extname } from 'node:path';
import { type PlaceholderValues, valuesWithClipboard } from '../../shared/placeholders';
import {
  argumentName,
  expandLink,
  needsArgument,
  type Quicklink,
  shortLink,
  takesArgument,
} from '../../shared/quicklinks';
import type {
  ActionResult,
  CommandRef,
  Icon,
  ItemDetail,
  ListItem,
  Platform,
  RootItem,
  Shortcut,
  View,
} from '../../shared/types';
import type { QuicklinkStore } from '../entry-store';
import type { BuiltinExtension } from './types';

export interface QuicklinksOptions {
  store: QuicklinkStore;
  platform: Platform;
  /** Opens a quicklink, placeholders filled in, with the app it names if any. */
  open(link: string, openWith: string | undefined): Promise<void>;
  readClipboard(): Promise<string>;
  /** Opens Settings at Quicklinks, editing the one with this id, or a new one. */
  edit(id?: string): void;
}

/**
 * Opens one quicklink. Its argument is the quicklink's id, then a line break and the text for
 * `{argument}` when some was typed. Not listed in the root search: the quicklinks' own rows run it.
 */
const OPEN: CommandRef = { extension: 'quicklinks', command: 'open' };
/** Edits one quicklink; its argument is the quicklink's id. Not listed either. */
const EDIT: CommandRef = { extension: 'quicklinks', command: 'edit' };
const EDIT_SHORTCUT: Shortcut = { key: 'e', modifiers: ['mod'] };
const DELETE_SHORTCUT: Shortcut = { key: 'Backspace', modifiers: ['mod'] };
const LINK_ICON: Icon = { builtin: 'link', tint: 'blue' };

export function quicklinkIcon(quicklink: Quicklink): Icon {
  return quicklink.icon ? { emoji: quicklink.icon } : LINK_ICON;
}

/** "Firefox" for `/usr/share/applications/firefox.desktop` or `C:\…\Firefox.lnk`; names stay as they are. */
export function appLabel(openWith: string): string {
  if (!/[\\/]/.test(openWith)) return openWith;
  const name = basename(openWith.replace(/[\\/]+$/, '').replaceAll('\\', '/'));
  return name.slice(0, name.length - extname(name).length) || name;
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
  const { store, platform, open, readClipboard, edit } = options;
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
    await open(expandLink(quicklink.link, { ...values, argument: text }), quicklink.openWith);
    return { hide: true };
  };

  const gone: ActionResult = { toast: 'That quicklink doesn’t exist any more.', toastStyle: 'failure' };

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
        { name: 'create', title: 'Create Quicklink', mode: 'no-view', keywords: ['new quicklink', 'add link'] },
        { name: 'open', title: 'Open Quicklink', mode: 'no-view' },
        { name: 'edit', title: 'Edit Quicklink', mode: 'no-view' },
      ],
    },
    unlisted: ['open', 'edit'],
    commands: {
      search: {
        view,
        async onAction(id, payload) {
          if (id === 'create') {
            edit();
            return { hide: true };
          }
          const quicklink = typeof payload === 'string' ? store.get(payload) : undefined;
          if (!quicklink) return { ...gone, replace: await view() };
          if (id === 'open') return openQuicklink(quicklink, '', true);
          if (id === 'copy') return { copy: expandLink(quicklink.link, await valuesFor([quicklink.link])) };
          if (id === 'edit') {
            edit(quicklink.id);
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
        run() {
          edit();
          return { hide: true };
        },
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
        run(ctx) {
          edit(ctx.argument || undefined);
          return { hide: true };
        },
      },
    },
  };
}
