import { useMemo, useState } from 'react';
import { rankItems } from '../../../shared/search';
import type { Platform } from '../../../shared/types';
import { Keycaps } from '../components/Keycaps';
import { shortcutKeys } from '../keys';
import type { NoteAction, NoteActionGroup } from './actions';
import { ListPopover, type PopoverSection } from './ListPopover';

/**
 * The action panel (⌘K): every action for the note, grouped, with its shortcut. Actions
 * ending in "..." open a list of their own; Esc goes back from it.
 */
export function NoteActions({
  groups,
  initialSubmenu,
  platform,
  onRun,
  onClose,
  onHeight,
}: {
  groups: NoteActionGroup[];
  /** Opens on this action's own list, as ⇧⌘C opens Copy Note As... */
  initialSubmenu?: string | null;
  platform: Platform;
  onRun(action: NoteAction): void;
  onClose(): void;
  onHeight(height: number): void;
}) {
  const [query, setQuery] = useState('');
  const [submenuKey, setSubmenuKey] = useState<string | null>(initialSubmenu ?? null);
  // Looked up afresh each time, so the list reflects the note as it is now.
  const submenu = groups.flatMap((group) => group.items).find((action) => action.key === submenuKey) ?? null;

  const sections = useMemo<PopoverSection<NoteAction>[]>(() => {
    const shown: NoteActionGroup[] = submenu ? [{ key: submenu.key, items: submenu.submenu?.() ?? [] }] : groups;
    if (!query.trim()) return shown;
    const all = shown.flatMap((group) => group.items);
    return [{ key: 'results', items: rankItems(all, query).map((ranked) => ranked.item) }];
  }, [groups, submenu, query]);

  return (
    <ListPopover
      key={submenu?.key ?? 'actions'}
      className="actions"
      label={submenu ? submenu.title.replace(/\.+$/, '') : 'Actions'}
      placeholder="Search for actions..."
      query={query}
      onQueryChange={setQuery}
      sections={sections}
      onChoose={(action) => {
        if (action.submenu) {
          setSubmenuKey(action.key);
          setQuery('');
        } else {
          onRun(action);
        }
      }}
      onClose={onClose}
      onBack={
        submenu
          ? () => {
              setSubmenuKey(null);
              setQuery('');
            }
          : undefined
      }
      onHeight={onHeight}
      empty={<p className="popover__empty">No matching actions</p>}
      renderItem={(action) => (
        <>
          <span className="actions__icon" aria-hidden="true">
            <action.icon size={16} strokeWidth={2.2} />
          </span>
          <span className="actions__title">{action.title}</span>
          {action.shortcut && <Keycaps keys={shortcutKeys(action.shortcut, platform)} />}
        </>
      )}
    />
  );
}
