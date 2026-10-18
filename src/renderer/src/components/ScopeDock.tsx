import { Clipboard, Command, LayoutGrid, type LucideIcon, Puzzle, Settings, Sparkles, StickyNote } from 'lucide-react';
import type { Platform } from '../../../shared/types';
import { ROOT_FILTERS, type RootFilter } from '../root-search';

const ICONS: Record<RootFilter, LucideIcon> = {
  all: Sparkles,
  application: LayoutGrid,
  command: Command,
  extensions: Puzzle,
  note: StickyNote,
  clipboard: Clipboard,
};

interface ScopeDockProps {
  value: RootFilter;
  /** Matches per scope; hidden when there's nothing typed. */
  counts: Record<RootFilter, number> | null;
  /** Inside a command's view no scope applies, so none shows as picked. */
  inactive: boolean;
  /** ⌘ (Ctrl) is held: Settings shows its shortcut, as the rows show their quick keys. */
  showShortcut: boolean;
  platform: Platform;
  onChange(filter: RootFilter): void;
  onSettings(): void;
}

/**
 * What the root search looks through, as a column of icons down the left of the window. Tab
 * cycles through them; while searching, each one's badge counts its matches. Settings sits at
 * the foot, its shortcut on a badge while ⌘ (Ctrl) is held or the pointer is on it.
 */
export function ScopeDock({ value, counts, inactive, showShortcut, platform, onChange, onSettings }: ScopeDockProps) {
  const mac = platform === 'darwin';
  return (
    <nav className="dock" aria-label="Scopes" data-inactive={inactive || undefined}>
      <div className="dock__tabs" role="tablist" aria-label="Show" aria-orientation="vertical">
        {ROOT_FILTERS.map((filter) => {
          const Icon = ICONS[filter.id];
          const count = counts?.[filter.id];
          return (
            <button
              key={filter.id}
              type="button"
              role="tab"
              tabIndex={-1}
              aria-selected={!inactive && filter.id === value}
              aria-label={count === undefined ? filter.label : `${filter.label}, ${count}`}
              title={filter.label}
              className="dock__button"
              data-empty={count === 0 || undefined}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onChange(filter.id)}
            >
              <Icon size={18} strokeWidth={2} aria-hidden="true" />
              {count !== undefined && count > 0 && (
                <span className="dock__badge" aria-hidden="true">
                  {count > 99 ? '99+' : count}
                </span>
              )}
            </button>
          );
        })}
      </div>
      <span className="dock__divider" aria-hidden="true" />
      <button
        type="button"
        tabIndex={-1}
        aria-label="Open Settings"
        aria-keyshortcuts={mac ? 'Meta+,' : 'Control+,'}
        title="Settings"
        className="dock__button dock__settings"
        data-shortcut={showShortcut || undefined}
        onMouseDown={(event) => event.preventDefault()}
        onClick={onSettings}
      >
        <Settings size={18} strokeWidth={2} aria-hidden="true" />
        <span className="dock__badge dock__shortcut" aria-hidden="true">
          {mac ? '⌘,' : 'Ctrl+,'}
        </span>
      </button>
    </nav>
  );
}
