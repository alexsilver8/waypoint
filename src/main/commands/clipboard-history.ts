import { formatBytes } from '../../shared/bytes';
import { timeAgo } from '../../shared/time';
import type { Action, CommandRef, Icon, ItemDetail, ListItem, RootItem, View } from '../../shared/types';
import type { ClipboardEntry, ClipboardHistory } from '../clipboard/history';
import { imageTitle } from '../clipboard/images';
import type { BuiltinActionResult } from '../ipc';
import type { BuiltinExtension } from './types';

function preview(text: string): string {
  const firstLine = text.trim().split(/\r?\n/, 1)[0] ?? '';
  const collapsed = firstLine.replace(/\s+/g, ' ');
  return collapsed.length > 120 ? `${collapsed.slice(0, 119)}…` : collapsed;
}

function describe(text: string): string {
  const lines = text.split(/\r?\n/).length;
  const chars = text.length.toLocaleString('en-US');
  return lines > 1 ? `${lines} lines, ${chars} characters` : `${chars} characters`;
}

function isUrl(text: string): boolean {
  return /^https?:\/\/\S+$/i.test(text.trim());
}

const PREVIEW_LENGTH = 4000;

/** Copy or paste one image entry; the argument is its id. Not listed: the entries' own rows run them. */
const COPY_IMAGE: CommandRef = { extension: 'clipboard', command: 'copy-image' };
const PASTE_IMAGE: CommandRef = { extension: 'clipboard', command: 'paste-image' };

/**
 * Markdown showing the image file at `path` through the icon protocol, like any image in a detail.
 * Its angle brackets let the path have spaces, and forward slashes keep Windows' backslashes from
 * being read as escapes.
 */
export function markdownImage(alt: string, path: string): string {
  return `![${alt}](<${path.replaceAll('\\', '/')}>)`;
}

function textDetail(entry: ClipboardEntry): ItemDetail {
  const lines = entry.text.split(/\r?\n/).length;
  return {
    body: entry.text.length > PREVIEW_LENGTH ? `${entry.text.slice(0, PREVIEW_LENGTH)}…` : entry.text,
    metadata: [
      { label: 'Copied', value: timeAgo(entry.copiedAt) },
      { label: 'Characters', value: entry.text.length.toLocaleString('en-US') },
      ...(lines > 1 ? [{ label: 'Lines', value: lines.toLocaleString('en-US') }] : []),
    ],
  };
}

/** What a row shows of an entry, the same in the root search and in Clipboard History. */
function entryRow(
  history: ClipboardHistory,
  entry: ClipboardEntry,
  tint: 'orange' | 'gray',
): Pick<ListItem, 'title' | 'subtitle' | 'icon' | 'keywords' | 'detail' | 'actions'> {
  const files = history.imageFiles(entry);
  if (entry.image && files) {
    const { width, height, bytes } = entry.image;
    const title = imageTitle(entry.image);
    return {
      title,
      subtitle: `PNG image, ${formatBytes(bytes)}`,
      icon: { path: files.thumbnail },
      keywords: ['image'],
      detail: {
        markdown: markdownImage(title, files.image),
        metadata: [
          { label: 'Copied', value: timeAgo(entry.copiedAt) },
          { label: 'Dimensions', value: `${width}×${height}` },
          { label: 'Size', value: formatBytes(bytes) },
        ],
      },
      actions: [
        { type: 'open-command', ref: COPY_IMAGE, argument: entry.id, title: 'Copy to Clipboard' },
        { type: 'open-command', ref: PASTE_IMAGE, argument: entry.id, title: 'Paste Image' },
      ],
    };
  }
  const actions: Action[] = [{ type: 'copy', text: entry.text, title: 'Copy to Clipboard' }];
  if (isUrl(entry.text)) actions.push({ type: 'open-url', url: entry.text.trim(), title: 'Open in Browser' });
  const icon: Icon = { builtin: isUrl(entry.text) ? 'link' : 'text', tint };
  return {
    title: preview(entry.text),
    subtitle: describe(entry.text),
    icon,
    // Lets the search match text beyond the first line.
    keywords: [entry.text.slice(0, 2000)],
    detail: textDetail(entry),
    actions,
  };
}

/**
 * How many recent entries the root search carries. Each holds its whole text, so the whole
 * history (up to thousands of entries) would be a lot to send every time the launcher opens;
 * Clipboard History searches all of it.
 */
export const CLIPBOARD_ROOT_LIMIT = 200;

/** Recent clipboard entries, for the root search and its Clipboard tab. */
export function clipboardRootItems(history: ClipboardHistory, isEnabled: () => boolean): RootItem[] {
  if (!isEnabled()) return [];
  return history
    .entries()
    .slice(0, CLIPBOARD_ROOT_LIMIT)
    .map((entry) => ({
      id: `clipboard:${entry.id}`,
      kind: 'clipboard',
      ...entryRow(history, entry, 'orange'),
      accessory: timeAgo(entry.copiedAt),
      frecency: 0,
    }));
}

function toItem(history: ClipboardHistory, entry: ClipboardEntry): ListItem {
  const row = entryRow(history, entry, 'gray');
  return {
    id: entry.id,
    ...row,
    accessory: timeAgo(entry.copiedAt),
    actions: [
      ...row.actions,
      {
        type: 'callback',
        id: 'delete',
        payload: entry.id,
        title: 'Delete Entry',
        style: 'destructive',
        shortcut: { key: 'Backspace', modifiers: ['mod'] },
      },
      {
        type: 'callback',
        id: 'clear',
        title: 'Clear History',
        style: 'destructive',
        shortcut: { key: 'Backspace', modifiers: ['mod', 'shift'] },
      },
    ],
  };
}

export function clipboardHistoryExtension(history: ClipboardHistory, isEnabled: () => boolean): BuiltinExtension {
  const view = (): View => ({
    type: 'list',
    title: 'Clipboard History',
    searchPlaceholder: 'Search copied text and images…',
    sections: [{ title: 'Recent', items: history.entries().map((entry) => toItem(history, entry)) }],
    emptyText: isEnabled()
      ? 'Copy some text or an image and it will show up here.'
      : 'Clipboard history is turned off in settings.',
  });

  /** Puts the image back on the clipboard: `then` says what to do once it's there. */
  const restore = async (id: string | undefined, then: BuiltinActionResult): Promise<BuiltinActionResult> =>
    id && (await history.copyImage(id))
      ? then
      : { toast: 'That image isn’t in the history any more.', toastStyle: 'failure' };

  return {
    manifest: {
      name: 'clipboard',
      title: 'Clipboard',
      icon: { builtin: 'clipboard', tint: 'orange' },
      commands: [
        { name: 'history', title: 'Clipboard History', mode: 'view', keywords: ['paste', 'copy', 'pasteboard'] },
        { name: 'copy-image', title: 'Copy Image', mode: 'no-view' },
        { name: 'paste-image', title: 'Paste Image', mode: 'no-view' },
      ],
    },
    unlisted: ['copy-image', 'paste-image'],
    commands: {
      history: {
        view,
        onAction(id, payload) {
          if (id === 'delete' && typeof payload === 'string') {
            history.remove(payload);
            return { replace: view(), toast: 'Entry deleted' };
          }
          if (id === 'clear') {
            history.clear();
            return { replace: view(), toast: 'History cleared' };
          }
          return undefined;
        },
      },
      'copy-image': {
        run: (ctx) => restore(ctx.argument, { hide: true }),
      },
      'paste-image': {
        run: (ctx) => restore(ctx.argument, { pasteClipboard: true }),
      },
    },
  };
}
