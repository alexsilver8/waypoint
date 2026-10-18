import { type PlaceholderValues, valuesWithClipboard } from '../../shared/placeholders';
import { expandSnippet, type Snippet, snippetPreview } from '../../shared/snippets';
import type {
  ActionResult,
  CommandRef,
  Icon,
  ItemDetail,
  ListItem,
  RootItem,
  Shortcut,
  View,
} from '../../shared/types';
import type { SnippetStore } from '../entry-store';
import type { BuiltinExtension } from './types';

export interface SnippetsOptions {
  store: SnippetStore;
  readClipboard(): Promise<string>;
  /** Opens Settings at Snippets, editing the one with this id, or a new one. */
  edit(id?: string): void;
}

/** Paste, copy or edit one snippet; the argument is its id. Not listed: the snippets' own rows run them. */
const PASTE: CommandRef = { extension: 'snippets', command: 'paste' };
const COPY: CommandRef = { extension: 'snippets', command: 'copy' };
const EDIT: CommandRef = { extension: 'snippets', command: 'edit' };
const EDIT_SHORTCUT: Shortcut = { key: 'e', modifiers: ['mod'] };
const DELETE_SHORTCUT: Shortcut = { key: 'Backspace', modifiers: ['mod'] };
const SNIPPET_ICON: Icon = { builtin: 'text', tint: 'teal' };
const PREVIEW_LENGTH = 4000;

function snippetDetail(snippet: Snippet, values: PlaceholderValues): ItemDetail {
  const text = expandSnippet(snippet.text, values);
  return {
    body: text.length > PREVIEW_LENGTH ? `${text.slice(0, PREVIEW_LENGTH)}…` : text,
    metadata: [
      ...(snippet.keyword ? [{ label: 'Keyword', value: snippet.keyword }] : []),
      { label: 'Characters', value: text.length.toLocaleString('en-US') },
    ],
  };
}

/**
 * Your snippets, for the root search: found by name or keyword once something is typed (`!email`
 * ↵ pastes it), but not listed among the commands before that.
 */
export async function snippetRootItems(
  store: SnippetStore,
  score: (id: string) => number,
  readClipboard: () => Promise<string>,
): Promise<RootItem[]> {
  const snippets = store.list();
  const values = await valuesWithClipboard(
    snippets.map((snippet) => snippet.text),
    readClipboard,
  );
  return snippets.map((snippet) => {
    const id = `snippet:${snippet.id}`;
    return {
      id,
      kind: 'command',
      title: snippet.name,
      subtitle: snippetPreview(snippet.text),
      icon: SNIPPET_ICON,
      accessory: snippet.keyword ?? 'Snippet',
      ...(snippet.keyword ? { keywords: [snippet.keyword] } : {}),
      frecency: score(id),
      searchOnly: true,
      detail: snippetDetail(snippet, values),
      actions: [
        { type: 'open-command', ref: PASTE, argument: snippet.id, title: 'Paste Snippet' },
        { type: 'open-command', ref: COPY, argument: snippet.id, title: 'Copy Snippet' },
        { type: 'open-command', ref: EDIT, argument: snippet.id, title: 'Edit Snippet', shortcut: EDIT_SHORTCUT },
      ],
    };
  });
}

/** Search Snippets, Create Snippet, and the unlisted commands the snippets' rows run. */
export function snippetsExtension({ store, readClipboard, edit }: SnippetsOptions): BuiltinExtension {
  const view = async (): Promise<View> => {
    const snippets = store.list();
    const values = await valuesWithClipboard(
      snippets.map((snippet) => snippet.text),
      readClipboard,
    );
    const items: ListItem[] = snippets.map((snippet) => ({
      id: snippet.id,
      title: snippet.name,
      subtitle: snippetPreview(snippet.text),
      icon: SNIPPET_ICON,
      // Lets the search find words in the text, not just the name.
      keywords: [...(snippet.keyword ? [snippet.keyword] : []), snippet.text.slice(0, 2000)],
      ...(snippet.keyword ? { accessory: snippet.keyword } : {}),
      detail: snippetDetail(snippet, values),
      actions: [
        { type: 'callback', id: 'paste', payload: snippet.id, title: 'Paste Snippet' },
        { type: 'callback', id: 'copy', payload: snippet.id, title: 'Copy Snippet' },
        { type: 'callback', id: 'edit', payload: snippet.id, title: 'Edit Snippet', shortcut: EDIT_SHORTCUT },
        {
          type: 'callback',
          id: 'delete',
          payload: snippet.id,
          title: 'Delete Snippet',
          style: 'destructive',
          shortcut: DELETE_SHORTCUT,
        },
        { type: 'callback', id: 'create', title: 'Create Snippet' },
      ],
    }));
    return {
      type: 'list',
      title: 'Snippets',
      searchPlaceholder: 'Search snippets…',
      sections: [{ title: `${items.length} snippet${items.length === 1 ? '' : 's'}`, items }],
      emptyText: 'No snippets yet. Run Create Snippet to add one.',
    };
  };

  const gone: ActionResult = { toast: 'That snippet doesn’t exist any more.', toastStyle: 'failure' };
  /** The snippet's text as it goes out: placeholders filled in now. */
  const expanded = async (snippet: Snippet) =>
    expandSnippet(snippet.text, await valuesWithClipboard([snippet.text], readClipboard));
  const byArgument = (argument: string | undefined) => (argument ? store.get(argument) : undefined);

  return {
    manifest: {
      name: 'snippets',
      title: 'Snippets',
      icon: SNIPPET_ICON,
      commands: [
        {
          name: 'search',
          title: 'Search Snippets',
          mode: 'view',
          icon: { builtin: 'search', tint: 'teal' },
          keywords: ['text', 'paste', 'templates', 'expand'],
        },
        { name: 'create', title: 'Create Snippet', mode: 'no-view', keywords: ['new snippet', 'add snippet'] },
        { name: 'paste', title: 'Paste Snippet', mode: 'no-view' },
        { name: 'copy', title: 'Copy Snippet', mode: 'no-view' },
        { name: 'edit', title: 'Edit Snippet', mode: 'no-view' },
      ],
    },
    unlisted: ['paste', 'copy', 'edit'],
    commands: {
      search: {
        view,
        async onAction(id, payload) {
          if (id === 'create') {
            edit();
            return { hide: true };
          }
          const snippet = typeof payload === 'string' ? store.get(payload) : undefined;
          if (!snippet) return { ...gone, replace: await view() };
          if (id === 'paste') return { paste: await expanded(snippet) };
          if (id === 'copy') return { copy: await expanded(snippet) };
          if (id === 'edit') {
            edit(snippet.id);
            return { hide: true };
          }
          if (id === 'delete') {
            store.remove(snippet.id);
            return { replace: await view(), toast: 'Snippet deleted' };
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
      paste: {
        async run(ctx) {
          const snippet = byArgument(ctx.argument);
          return snippet ? { paste: await expanded(snippet) } : gone;
        },
      },
      copy: {
        async run(ctx) {
          const snippet = byArgument(ctx.argument);
          return snippet ? { copy: await expanded(snippet) } : gone;
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
