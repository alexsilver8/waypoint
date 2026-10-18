import { rankItems } from '../../shared/search';
import type { Action, ListItem, View } from '../../shared/types';

/** A row as the launcher draws it. */
export interface DisplayItem extends ListItem {
  /** Matched characters in the title, to highlight. */
  titlePositions?: number[];
  /** Set for root items, so using them raises their rank next time. */
  rootItemId?: string;
  /** Set for the inline calculator row. */
  calculator?: { expression: string; result: string };
  /** For commands: the global shortcut that runs it, drawn beside it. */
  hotkey?: string;
}

export interface DisplaySection {
  title?: string;
  items: DisplayItem[];
}

export function actionTitle(action: Action): string {
  if (action.title) return action.title;
  switch (action.type) {
    case 'open-command':
      return 'Open Command';
    case 'open-url':
      return 'Open in Browser';
    case 'open-path':
      return 'Open';
    case 'reveal-path':
      return 'Show in Folder';
    case 'copy':
      return 'Copy to Clipboard';
    case 'paste':
      return 'Paste to Active App';
    case 'callback':
      return action.title;
  }
}

/** Applies the launcher's fuzzy filter to a command's view, keeping its sections. */
export function filterView(view: View, query: string): DisplaySection[] {
  if (view.filtering === false || !query.trim()) return view.sections;
  return view.sections
    .map((section) => ({
      ...section,
      items: rankItems(section.items, query).map(({ item, titlePositions }) => ({ ...item, titlePositions })),
    }))
    .filter((section) => section.items.length > 0);
}
