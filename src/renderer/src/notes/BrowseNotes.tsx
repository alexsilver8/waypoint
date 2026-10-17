import { Pin, PinOff, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import {
  browseSections,
  type Note,
  type NotesWindowState,
  noteLength,
  noteTitle,
  relativeTime,
} from '../../../shared/notes';
import { rankItems } from '../../../shared/search';
import type { Platform, Shortcut } from '../../../shared/types';
import { Highlight } from '../components/Highlight';
import { ListPopover, type PopoverEntry, type PopoverSection } from './ListPopover';
import { matchesShortcut } from './shortcuts';

interface NoteEntry extends PopoverEntry {
  note: Note;
  title: string;
  keywords: string[];
  positions: number[];
}

function entries(notes: Note[], query: string): NoteEntry[] {
  const all = notes.map((note) => ({
    key: note.id,
    note,
    title: noteTitle(note.text),
    keywords: [note.text.slice(0, 5000)],
    positions: [] as number[],
  }));
  if (!query.trim()) return all;
  return rankItems(all, query).map((ranked) => ({ ...ranked.item, positions: ranked.titlePositions }));
}

/** "5 Notes", or "2/5 Notes" while searching. */
export function notesCount(shown: number, total: number, searching: boolean): string {
  return searching ? `${shown}/${total} Notes` : `${total} ${total === 1 ? 'Note' : 'Notes'}`;
}

/**
 * Browse Notes (⌘P): every note, pinned ones first, each with when you last had it open and
 * how long it is. ↵ opens the selected note; its buttons pin and delete it.
 */
export function BrowseNotes({
  notes,
  currentId,
  state,
  platform,
  now,
  pinShortcut,
  deleteShortcut,
  onOpen,
  onTogglePin,
  onDelete,
  onCreate,
  onClose,
  onHeight,
}: {
  notes: Note[];
  currentId: string | null;
  state: Pick<NotesWindowState, 'pinned' | 'opened' | 'count'>;
  platform: Platform;
  now: number;
  pinShortcut: Shortcut;
  deleteShortcut: Shortcut;
  onOpen(id: string): void;
  onTogglePin(id: string): void;
  onDelete(id: string): void;
  /** Makes a note from what you searched for, when nothing matches. */
  onCreate(text: string): void;
  onClose(): void;
  onHeight(height: number): void;
}) {
  const [query, setQuery] = useState('');
  const { pinned, opened, count } = state;

  const sections = useMemo<PopoverSection<NoteEntry>[]>(() => {
    const groups = browseSections(notes, { pinned, opened, currentId });
    return [
      { key: 'pinned', title: 'Pinned', items: entries(groups.pinned, query) },
      { key: 'notes', title: 'Notes', items: entries(groups.notes, query) },
    ];
  }, [notes, pinned, opened, currentId, query]);
  const shown = sections.reduce((total, section) => total + section.items.length, 0);
  const searching = query.trim().length > 0;

  return (
    <ListPopover
      className="browse"
      itemClassName="browse__item"
      label="Browse Notes"
      placeholder="Search for notes..."
      query={query}
      onQueryChange={setQuery}
      sections={sections}
      initialKey={currentId ?? undefined}
      onChoose={(entry) => onOpen(entry.note.id)}
      onClose={onClose}
      onHeight={onHeight}
      onItemKey={(event, entry) => {
        if (!entry) return false;
        if (matchesShortcut(event, pinShortcut, platform)) onTogglePin(entry.note.id);
        else if (matchesShortcut(event, deleteShortcut, platform)) onDelete(entry.note.id);
        else return false;
        return true;
      }}
      header={<div className="browse__count">{notesCount(shown, notes.length, searching)}</div>}
      empty={
        <div className="popover__empty">
          <span>No Notes Found</span>
          <button type="button" className="popover__empty-button" onClick={() => onCreate(query.trim())}>
            Create New Note
          </button>
        </div>
      }
      renderItem={(entry, selected) => {
        const { note } = entry;
        const current = note.id === currentId;
        const isPinned = pinned.includes(note.id);
        return (
          <>
            <span className="browse__text">
              <span className="browse__title">
                <Highlight text={entry.title} positions={entry.positions} />
              </span>
              <span className="browse__meta">
                {current ? (
                  <>
                    <span className="browse__dot" aria-hidden="true" />
                    Current
                  </>
                ) : (
                  `Opened ${relativeTime(opened[note.id] ?? note.updatedAt, now)}`
                )}
                <span aria-hidden="true"> • </span>
                {noteLength(note.text, count)}
              </span>
            </span>
            {selected && (
              <span className="browse__buttons">
                <button
                  type="button"
                  tabIndex={-1}
                  className="browse__button"
                  aria-label={isPinned ? 'Unpin Note' : 'Pin Note'}
                  title={isPinned ? 'Unpin Note' : 'Pin Note'}
                  onClick={(event) => {
                    event.stopPropagation();
                    onTogglePin(note.id);
                  }}
                >
                  {isPinned ? <PinOff size={16} strokeWidth={2.2} /> : <Pin size={16} strokeWidth={2.2} />}
                </button>
                <button
                  type="button"
                  tabIndex={-1}
                  className="browse__button"
                  aria-label="Delete Note"
                  title="Delete Note"
                  onClick={(event) => {
                    event.stopPropagation();
                    onDelete(note.id);
                  }}
                >
                  <Trash2 size={16} strokeWidth={2.2} />
                </button>
              </span>
            )}
          </>
        );
      }}
    />
  );
}
