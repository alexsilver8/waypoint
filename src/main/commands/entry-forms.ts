/**
 * What the quicklink and snippet forms in the launcher have in common: how a form says which
 * entry it's for, and saving what it was filled in with through the store, whose checks are the
 * same as the file's and the Settings window's.
 */
import type { ActionResult } from '../../shared/types';
import { EntryError, type EntryStore } from '../entry-store';

const SAVE = 'save';
const SAVE_PREFIX = 'save:';

/** A form's submit id: `save` makes a new entry, `save:<id>` changes that one. */
export function saveId(id?: string): string {
  return id ? `${SAVE_PREFIX}${id}` : SAVE;
}

/** Whether an action id is one a form submits with, rather than a row's action. */
export function isSaveId(actionId: string): boolean {
  return actionId === SAVE || actionId.startsWith(SAVE_PREFIX);
}

export type SaveOutcome<T> = { entry: T; created: boolean; failure?: undefined } | { failure: ActionResult };

/**
 * Saves a submitted form: a new entry for `save`, or changes to the one `save:<id>` names. A
 * problem the store finds, like a link that can't open, comes back as a failure toast, which
 * leaves the form open with what was typed.
 */
export function saveFromForm<T extends { id: string; name: string }>(
  store: EntryStore<T>,
  actionId: string,
  fields: Omit<T, 'id'>,
): SaveOutcome<T> {
  const id = actionId.startsWith(SAVE_PREFIX) ? actionId.slice(SAVE_PREFIX.length) : undefined;
  try {
    return id ? { entry: store.update(id, fields), created: false } : { entry: store.add(fields), created: true };
  } catch (error) {
    if (error instanceof EntryError) return { failure: { toast: error.message, toastStyle: 'failure' } };
    throw error;
  }
}
