import { RotateCcw, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { type DeletedNote, noteLength, noteTitle, RECENTLY_DELETED_DAYS, relativeTime } from '../../../shared/notes';
import { rankItems } from '../../../shared/search';
import { Highlight } from '../components/Highlight';
import { ListPopover, type PopoverEntry, type PopoverSection } from './ListPopover';

const api = window.notes;

interface DeletedEntry extends PopoverEntry {
  note: DeletedNote;
  title: string;
  keywords: string[];
  positions: number[];
}

/**
 * Recently Deleted: notes you deleted in the last 60 days. ↵ brings the selected one back;
 * its trash button deletes it for good, to the system Trash.
 */
export function RecentlyDeleted({
  count,
  now,
  onRestore,
  onClose,
  onHeight,
}: {
  count: 'characters' | 'words';
  now: number;
  onRestore(id: string): void;
  onClose(): void;
  onHeight(height: number): void;
}) {
  const [deleted, setDeleted] = useState<DeletedNote[] | null>(null);
  const [query, setQuery] = useState('');

  const load = useCallback(() => {
    void api.listDeleted().then(setDeleted, () => setDeleted([]));
  }, []);
  useEffect(() => load(), [load]);

  const sections = useMemo<PopoverSection<DeletedEntry>[]>(() => {
    const all = (deleted ?? []).map((note) => ({
      key: note.id,
      note,
      title: noteTitle(note.text),
      keywords: [note.text.slice(0, 5000)],
      positions: [] as number[],
    }));
    const items = query.trim()
      ? rankItems(all, query).map((ranked) => ({ ...ranked.item, positions: ranked.titlePositions }))
      : all;
    return [{ key: 'deleted', title: 'Recently Deleted', items }];
  }, [deleted, query]);

  return (
    <ListPopover
      className="browse"
      itemClassName="browse__item"
      label="Recently Deleted Notes"
      placeholder="Search recently deleted notes..."
      query={query}
      onQueryChange={setQuery}
      sections={sections}
      onChoose={(entry) => onRestore(entry.note.id)}
      onClose={onClose}
      onHeight={onHeight}
      header={
        <div className="browse__count">
          Deleted notes are kept for {RECENTLY_DELETED_DAYS} days, then moved to the Trash.
        </div>
      }
      empty={
        deleted && (
          <div className="popover__empty">
            <span>{query.trim() ? 'No Notes Found' : 'No Recently Deleted Notes'}</span>
          </div>
        )
      }
      renderItem={(entry, selected) => (
        <>
          <span className="browse__text">
            <span className="browse__title">
              <Highlight text={entry.title} positions={entry.positions} />
            </span>
            <span className="browse__meta">
              {`Deleted ${relativeTime(entry.note.deletedAt, now)}`}
              <span aria-hidden="true"> • </span>
              {noteLength(entry.note.text, count)}
            </span>
          </span>
          {selected && (
            <span className="browse__buttons">
              <button
                type="button"
                tabIndex={-1}
                className="browse__button"
                aria-label="Restore Note"
                title="Restore Note"
                onClick={(event) => {
                  event.stopPropagation();
                  onRestore(entry.note.id);
                }}
              >
                <RotateCcw size={16} strokeWidth={2.2} />
              </button>
              <button
                type="button"
                tabIndex={-1}
                className="browse__button"
                aria-label="Delete Permanently"
                title="Delete Permanently"
                onClick={(event) => {
                  event.stopPropagation();
                  void api.purge(entry.note.id).then(load);
                }}
              >
                <Trash2 size={16} strokeWidth={2.2} />
              </button>
            </span>
          )}
        </>
      )}
    />
  );
}
