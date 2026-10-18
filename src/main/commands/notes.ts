import { countWords, type Note, notePreview, noteTitle, readableMarkdown } from '../../shared/notes';
import { timeAgo } from '../../shared/time';
import type { ItemDetail, ListItem, RootItem, View } from '../../shared/types';
import type { NotesStore } from '../notes/store';
import type { NotesWindow } from '../notes/window';
import type { BuiltinExtension } from './types';

const REVEAL_LABEL: Record<string, string> = {
  darwin: 'Show in Finder',
  win32: 'Show in File Explorer',
};

const PREVIEW_LENGTH = 4000;

function noteDetail(note: Note): ItemDetail {
  const words = countWords(note.text);
  return {
    body: readableMarkdown(note.text.length > PREVIEW_LENGTH ? `${note.text.slice(0, PREVIEW_LENGTH)}…` : note.text),
    metadata: [
      { label: 'Edited', value: timeAgo(note.updatedAt) },
      { label: 'Words', value: words.toLocaleString('en-US') },
    ],
  };
}

/** Every note, for the root search and its Notes tab. */
export async function noteRootItems(store: NotesStore): Promise<RootItem[]> {
  const notes = await store.list();
  return notes.map((note) => ({
    id: `note:${note.id}`,
    kind: 'note',
    title: noteTitle(note.text),
    subtitle: notePreview(note.text),
    icon: { builtin: 'note', tint: 'yellow' },
    keywords: [note.text.slice(0, 2000)],
    accessory: timeAgo(note.updatedAt),
    frecency: 0,
    detail: noteDetail(note),
    actions: [
      { type: 'open-command', ref: { extension: 'notes', command: 'open' }, argument: note.id, title: 'Open Note' },
      { type: 'copy', text: note.text, title: 'Copy Note' },
      { type: 'reveal-path', path: store.pathOf(note.id), title: REVEAL_LABEL[process.platform] ?? 'Show in Folder' },
    ],
  }));
}

/** Launcher commands for Notes. The notes themselves live in the Notes window. */
export function notesExtension(store: NotesStore, notesWindow: NotesWindow): BuiltinExtension {
  const searchView = async (): Promise<View> => {
    const notes = await store.list();
    const items: ListItem[] = notes.map((note) => ({
      id: note.id,
      title: noteTitle(note.text),
      subtitle: notePreview(note.text),
      icon: { builtin: 'note', tint: 'yellow' },
      // Search the whole note, not just its title.
      keywords: [note.text.slice(0, 5000)],
      accessory: timeAgo(note.updatedAt),
      detail: noteDetail(note),
      actions: [
        { type: 'callback', id: 'open', payload: note.id, title: 'Open Note' },
        { type: 'copy', text: note.text, title: 'Copy Note' },
        { type: 'reveal-path', path: store.pathOf(note.id), title: REVEAL_LABEL[process.platform] ?? 'Show in Folder' },
        {
          type: 'callback',
          id: 'delete',
          payload: note.id,
          title: 'Delete Note',
          style: 'destructive',
          shortcut: { key: 'Backspace', modifiers: ['mod'] },
        },
      ],
    }));
    return {
      type: 'list',
      title: 'Notes',
      searchPlaceholder: 'Search notes…',
      sections: [{ title: `${notes.length} note${notes.length === 1 ? '' : 's'}`, items }],
      emptyText: 'No notes yet. Run Create Note to write one.',
    };
  };

  return {
    manifest: {
      name: 'notes',
      title: 'Notes',
      icon: { builtin: 'note', tint: 'yellow' },
      commands: [
        {
          name: 'create',
          title: 'Create Note',
          mode: 'no-view',
          fallback: true,
          keywords: ['new note', 'jot', 'write', 'memo'],
        },
        {
          name: 'search',
          title: 'Search Notes',
          mode: 'view',
          icon: { builtin: 'search', tint: 'yellow' },
          keywords: ['find note', 'browse notes'],
        },
        { name: 'open', title: 'Open Notes', mode: 'no-view', keywords: ['notes window', 'scratchpad'] },
      ],
    },
    commands: {
      create: {
        // As a fallback, whatever you typed in the launcher becomes the note.
        async run(ctx) {
          const note = await store.create(ctx.argument?.trim() ? `${ctx.argument.trim()}\n` : '');
          notesWindow.open(note.id);
          return { hide: true };
        },
      },
      search: {
        view: searchView,
        async onAction(id, payload) {
          if (typeof payload !== 'string') return undefined;
          if (id === 'open') {
            notesWindow.open(payload);
            return { hide: true };
          }
          if (id === 'delete') {
            await store.delete(payload);
            return { replace: await searchView(), toast: 'Moved to Recently Deleted' };
          }
          return undefined;
        },
      },
      open: {
        // Opened from a note in the root search, the argument is that note's id.
        run(ctx) {
          notesWindow.open(ctx.argument || undefined);
          return { hide: true };
        },
      },
    },
  };
}
