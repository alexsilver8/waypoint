import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { app, BrowserWindow, ClipboardItem, clipboard, dialog, ipcMain, shell } from 'electron';
import {
  type ExportFormat,
  isOpenableLink,
  NotesChannel,
  type NotesWindowState,
  RECENTLY_DELETED_DAYS,
} from '../../shared/notes';
import type { NotesStore } from './store';
import type { NotesWindow } from './window';

const EXPORT_FILTERS: Record<ExportFormat, Electron.FileFilter> = {
  md: { name: 'Markdown', extensions: ['md'] },
  html: { name: 'HTML', extensions: ['html'] },
  txt: { name: 'Plain Text', extensions: ['txt'] },
};

/** A note's title as a file name: no characters any system refuses, never empty. */
export function exportFileName(title: string): string {
  const name = [...title]
    .map((char) => (char.charCodeAt(0) < 32 || '\\/:*?"<>|'.includes(char) ? ' ' : char))
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .slice(0, 100)
    .trim();
  return name || 'Note';
}

/** Wires the Notes window's `window.notes` API to the store. */
export function registerNotesIpc(store: NotesStore, notesWindow: NotesWindow): void {
  const check = (event: Electron.IpcMainInvokeEvent | Electron.IpcMainEvent) => {
    if (!notesWindow.webContents || event.sender !== notesWindow.webContents) throw new Error('Unexpected sender');
  };
  const text = (value: unknown) => {
    if (typeof value !== 'string') throw new Error('Note text must be a string');
    return value;
  };
  const id = (value: unknown) => {
    if (typeof value !== 'string') throw new Error('Note id must be a string');
    return value;
  };
  const record = (value: unknown): Record<string, unknown> =>
    typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
  const height = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0);
  const windowOf = (event: Electron.IpcMainInvokeEvent) => BrowserWindow.fromWebContents(event.sender) ?? undefined;

  ipcMain.handle(NotesChannel.list, (event) => {
    check(event);
    return store.list();
  });
  ipcMain.handle(NotesChannel.create, (event, value: unknown) => {
    check(event);
    return store.create(value === undefined ? '' : text(value));
  });
  ipcMain.handle(NotesChannel.update, (event, noteId: unknown, value: unknown) => {
    check(event);
    return store.update(id(noteId), text(value));
  });
  ipcMain.on(NotesChannel.flush, (event, noteId: unknown, value: unknown) => {
    check(event);
    store.update(id(noteId), text(value)).catch((error: unknown) => console.error('[notes] Save failed:', error));
  });
  ipcMain.handle(NotesChannel.discardIfEmpty, (event, noteId: unknown) => {
    check(event);
    return store.discardIfEmpty(id(noteId));
  });
  ipcMain.handle(NotesChannel.delete, (event, noteId: unknown) => {
    check(event);
    return store.delete(id(noteId));
  });
  ipcMain.handle(NotesChannel.deleteAll, async (event) => {
    check(event);
    const count = (await store.list()).length;
    if (count === 0) return false;
    const options: Electron.MessageBoxOptions = {
      type: 'warning',
      message: count === 1 ? 'Delete your note?' : `Delete all ${count} notes?`,
      detail: `They stay in Recently Deleted for ${RECENTLY_DELETED_DAYS} days.`,
      buttons: [count === 1 ? 'Delete Note' : 'Delete All Notes', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
    };
    const window = windowOf(event);
    const { response } = window ? await dialog.showMessageBox(window, options) : await dialog.showMessageBox(options);
    if (response !== 0) return false;
    await store.deleteAll();
    return true;
  });
  ipcMain.handle(NotesChannel.listDeleted, (event) => {
    check(event);
    return store.listDeleted();
  });
  ipcMain.handle(NotesChannel.restore, (event, noteId: unknown) => {
    check(event);
    return store.restore(id(noteId));
  });
  ipcMain.handle(NotesChannel.purge, (event, noteId: unknown) => {
    check(event);
    return store.purge(id(noteId));
  });
  ipcMain.on(NotesChannel.openLink, (event, url: unknown) => {
    check(event);
    if (typeof url === 'string' && isOpenableLink(url)) void shell.openExternal(url.trim());
  });
  ipcMain.on(NotesChannel.reveal, (event, noteId: unknown) => {
    check(event);
    shell.showItemInFolder(store.pathOf(id(noteId)));
  });
  ipcMain.on(NotesChannel.copy, (event, content: unknown) => {
    check(event);
    const { text: plain, html } = record(content);
    if (typeof plain !== 'string') return;
    const item = new ClipboardItem(
      typeof html === 'string' ? { 'text/plain': plain, 'text/html': html } : { 'text/plain': plain },
    );
    clipboard.write([item]).catch((error: unknown) => console.error('[notes] Copy failed:', error));
  });
  ipcMain.handle(NotesChannel.export, async (event, file: unknown) => {
    check(event);
    const { name, format, content } = record(file);
    if (typeof name !== 'string' || typeof content !== 'string') throw new Error('Invalid export');
    if (format !== 'md' && format !== 'html' && format !== 'txt') throw new Error('Invalid export format');
    const options: Electron.SaveDialogOptions = {
      defaultPath: join(app.getPath('documents'), `${exportFileName(name)}.${format}`),
      filters: [EXPORT_FILTERS[format]],
    };
    const window = windowOf(event);
    const result = window ? await dialog.showSaveDialog(window, options) : await dialog.showSaveDialog(options);
    if (result.canceled || !result.filePath) return false;
    await writeFile(result.filePath, content);
    return true;
  });
  ipcMain.on(NotesChannel.fit, (event, value: unknown) => {
    check(event);
    notesWindow.fit(height(value));
  });
  ipcMain.on(NotesChannel.hide, (event) => {
    check(event);
    notesWindow.hide();
  });
  ipcMain.on(NotesChannel.placePopover, (event, value: unknown) => {
    check(event);
    const popoverHeight = height(value);
    if (popoverHeight > 0) notesWindow.placePopover(popoverHeight);
  });
  ipcMain.on(NotesChannel.hidePopover, (event, focusWindow: unknown) => {
    check(event);
    notesWindow.hidePopover(focusWindow === true);
  });
  ipcMain.handle(NotesChannel.getState, (event) => {
    check(event);
    const { version: _version, bounds: _bounds, ...state } = notesWindow.getState();
    return state;
  });
  ipcMain.on(NotesChannel.setState, (event, patch: Partial<NotesWindowState>) => {
    check(event);
    notesWindow.setState(typeof patch === 'object' && patch !== null ? patch : {});
  });
  ipcMain.on(NotesChannel.setCurrent, (event, noteId: unknown) => {
    check(event);
    notesWindow.setCurrent(id(noteId));
  });
}
