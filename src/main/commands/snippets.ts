import { type PlaceholderValues, placeholderList, valuesWithClipboard } from '../../shared/placeholders';
import {
  expandSnippet,
  SNIPPET_PLACEHOLDERS,
  type Snippet,
  snippetFields,
  snippetPreview,
} from '../../shared/snippets';
import type {
  ActionResult,
  CommandRef,
  FormView,
  Icon,
  ItemDetail,
  Json,
  ListItem,
  RootItem,
  Shortcut,
  View,
} from '../../shared/types';
import { EntryError, type SnippetStore } from '../entry-store';
import { isSaveId, saveFromForm, saveId } from './entry-forms';
import type { BuiltinExtension } from './types';

export interface SnippetsOptions {
  store: SnippetStore;
  readClipboard(): Promise<string>;
  /** Opens Settings at Snippets, editing the one with this id. */
  editInSettings(id: string): void;
}

/**
 * The form that makes a snippet, or changes one: the same fields as in Settings. It submits with
 * `save`, or `save:<id>` for the one it changes.
 */
export function snippetForm(snippet?: Snippet): FormView {
  return {
    type: 'form',
    title: snippet ? 'Edit Snippet' : 'Create Snippet',
    submit: { id: saveId(snippet?.id), title: snippet ? 'Save Snippet' : 'Create Snippet' },
    fields: [
      {
        type: 'text',
        id: 'name',
        title: 'Name',
        placeholder: 'Email signature',
        defaultValue: snippet?.name ?? '',
        required: true,
        info: 'What you type in the launcher to find it.',
      },
      {
        type: 'textarea',
        id: 'text',
        title: 'Text',
        placeholder: 'Thanks,\nAlex',
        defaultValue: snippet?.text ?? '',
        required: true,
        info: `Pasted just as it is, with ${placeholderList(SNIPPET_PLACEHOLDERS)} filled in.`,
      },
      {
        type: 'text',
        id: 'keyword',
        title: 'Keyword',
        placeholder: '!sig',
        defaultValue: snippet?.keyword ?? '',
        info: 'Optional. Type it in the launcher to paste the snippet.',
      },
    ],
  };
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
export function snippetsExtension({ store, readClipboard, editInSettings }: SnippetsOptions): BuiltinExtension {
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
        { type: 'callback', id: 'settings', payload: snippet.id, title: 'Edit in Settings' },
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
  const toastFor = (created: boolean) => (created ? 'Snippet created' : 'Snippet saved');

  /**
   * A form opened from the root search (Create Snippet, or ⌘E on a snippet there) goes back to it
   * once saved. A new one empties the search, ready to try its keyword.
   */
  const saveFromRoot = (id: string, values: Json | undefined): ActionResult | undefined => {
    if (!isSaveId(id)) return undefined;
    const saved = saveFromForm(store, id, snippetFields(values));
    if (saved.failure) return saved.failure;
    return { pop: true, ...(saved.created ? { clearSearch: true } : {}), toast: toastFor(saved.created) };
  };

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
        { name: 'create', title: 'Create Snippet', mode: 'view', keywords: ['new snippet', 'add snippet'] },
        { name: 'paste', title: 'Paste Snippet', mode: 'no-view' },
        { name: 'copy', title: 'Copy Snippet', mode: 'no-view' },
        { name: 'edit', title: 'Edit Snippet', mode: 'view' },
      ],
    },
    unlisted: ['paste', 'copy', 'edit'],
    commands: {
      search: {
        view,
        async onAction(id, payload) {
          if (id === 'create') return { push: snippetForm() };
          if (isSaveId(id)) {
            // Back to the list, with the change in it.
            const saved = saveFromForm(store, id, snippetFields(payload));
            if (saved.failure) return saved.failure;
            return { pop: true, replace: await view(), toast: toastFor(saved.created) };
          }
          const snippet = typeof payload === 'string' ? store.get(payload) : undefined;
          if (!snippet) return { ...gone, replace: await view() };
          if (id === 'paste') return { paste: await expanded(snippet) };
          if (id === 'copy') return { copy: await expanded(snippet) };
          if (id === 'edit') return { push: snippetForm(snippet) };
          if (id === 'settings') {
            editInSettings(snippet.id);
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
        view: () => snippetForm(),
        onAction: saveFromRoot,
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
        view(ctx) {
          if (!ctx.argument) return snippetForm();
          const snippet = store.get(ctx.argument);
          if (!snippet) throw new EntryError('That snippet doesn’t exist any more.');
          return snippetForm(snippet);
        },
        onAction: saveFromRoot,
      },
    },
  };
}
