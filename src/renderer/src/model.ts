import { rankItems } from '../../shared/search';
import type { Action, ListItem, ListView, View } from '../../shared/types';
import { submitAction } from './form';

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
  /** For commands: the alias that finds it first, drawn beside it. */
  alias?: string;
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

/** What ⌘↵ runs: the second action, unless it's only for the action panel. */
export function secondaryAction(item: DisplayItem): Action | undefined {
  const action = item.actions[1];
  return action?.panelOnly ? undefined : action;
}

/** Applies the launcher's fuzzy filter to a command's list, keeping its sections. */
export function filterView(view: ListView, query: string): DisplaySection[] {
  if (view.filtering === false || !query.trim()) return view.sections;
  return view.sections
    .map((section) => ({
      ...section,
      items: rankItems(section.items, query).map(({ item, titlePositions }) => ({ ...item, titlePositions })),
    }))
    .filter((section) => section.items.length > 0);
}

/**
 * A view as it shows when an action pushed it, rather than the command opening with it. Asking the
 * command's `view()` again would give its own view, not this one, so nothing here asks: `loading`
 * is left out, as nothing would ever end it, and a list is filtered by the launcher even if it
 * says `filtering: false`.
 */
export function pushedView(view: View): View {
  if (view.type === 'form') return view;
  if (view.type === 'detail') {
    const { loading: _loading, ...detail } = view;
    return detail;
  }
  const { loading: _loading, filtering: _filtering, ...list } = view;
  return list;
}

/**
 * A detail view or a form as one item with the view's actions, so ↵, ⌘↵, ⌘K, the action bar and
 * shortcuts work on it as on a list's selected row. A form's first action submits it.
 */
export function pageItem(view: View, title: string): DisplayItem | undefined {
  if (view.type === 'detail') return { id: 'detail', title: title || 'Details', actions: view.actions ?? [] };
  if (view.type === 'form') {
    const submit = submitAction(view);
    return { id: 'form', title: title || actionTitle(submit), actions: [submit, ...(view.actions ?? [])] };
  }
  return undefined;
}
