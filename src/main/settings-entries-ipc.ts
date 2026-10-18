import { ipcMain } from 'electron';
import { quicklinkFields } from '../shared/quicklinks';
import { type AppChoice, type SaveResult, SettingsChannel, type SettingsState } from '../shared/settings-ipc';
import { snippetFields } from '../shared/snippets';
import type { AppIndex } from './apps/app-index';
import { EntryError, type QuicklinkStore, type SnippetStore } from './entry-store';

export interface SettingsEntries {
  quicklinks: QuicklinkStore;
  snippets: SnippetStore;
  apps: AppIndex;
}

type Sender = Electron.IpcMainInvokeEvent | Electron.IpcMainEvent;

/** Saves an entry: adds it, or changes the one with its `id`. A problem comes back as `error`. */
function save<T>(
  raw: unknown,
  add: (draft: T) => unknown,
  update: (id: string, draft: T) => unknown,
  fields: (raw: unknown) => T,
): string | undefined {
  if (typeof raw !== 'object' || raw === null) return 'Nothing to save.';
  const record = raw as Record<string, unknown>;
  try {
    // Every field is sent, so one left empty is cleared rather than kept.
    const draft = fields(record);
    if (typeof record.id === 'string' && record.id) update(record.id, draft);
    else add(draft);
    return undefined;
  } catch (error) {
    if (error instanceof EntryError) return error.message;
    console.error('[settings] Could not save:', error);
    return `Couldn't save it: ${(error as Error).message}`;
  }
}

/** Removes an entry. A problem, like a file that can't be read, comes back as `error`. */
function remove(id: unknown, removeEntry: (id: string) => unknown): string | undefined {
  try {
    if (typeof id === 'string') removeEntry(id);
    return undefined;
  } catch (error) {
    if (error instanceof EntryError) return error.message;
    console.error('[settings] Could not delete:', error);
    return `Couldn't delete it: ${(error as Error).message}`;
  }
}

/** The Settings window's quicklinks and snippets, wired to their stores. */
export function registerEntriesIpc(
  check: (event: Sender) => void,
  { quicklinks, snippets, apps }: SettingsEntries,
  state: () => SettingsState,
): void {
  ipcMain.handle(SettingsChannel.saveQuicklink, (event, raw: unknown): SaveResult => {
    check(event);
    const error = save(
      raw,
      (draft) => quicklinks.add(draft),
      (id, draft) => quicklinks.update(id, draft),
      quicklinkFields,
    );
    return error ? { state: state(), error } : { state: state() };
  });

  ipcMain.handle(SettingsChannel.deleteQuicklink, (event, id: unknown): SaveResult => {
    check(event);
    const error = remove(id, (entry) => quicklinks.remove(entry));
    return error ? { state: state(), error } : { state: state() };
  });

  ipcMain.handle(SettingsChannel.saveSnippet, (event, raw: unknown): SaveResult => {
    check(event);
    const error = save(
      raw,
      (draft) => snippets.add(draft),
      (id, draft) => snippets.update(id, draft),
      snippetFields,
    );
    return error ? { state: state(), error } : { state: state() };
  });

  ipcMain.handle(SettingsChannel.deleteSnippet, (event, id: unknown): SaveResult => {
    check(event);
    const error = remove(id, (entry) => snippets.remove(entry));
    return error ? { state: state(), error } : { state: state() };
  });

  ipcMain.handle(SettingsChannel.listApps, (event): AppChoice[] => {
    check(event);
    return apps.byName().map(({ name, path }) => ({ name, path }));
  });
}
