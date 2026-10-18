import { clipboard, ipcMain } from 'electron';
import { IpcChannel } from '../shared/ipc';
import type { ActionContext, CommandRef } from '../shared/types';
import { sanitizeAction } from './extensions/validate';
import { pasteIntoFrontApp } from './paste';
import type { CommandRegistry } from './registry';
import type { LauncherWindow } from './window';

function isCommandRef(value: unknown): value is CommandRef {
  const ref = value as CommandRef | undefined;
  return typeof ref?.extension === 'string' && typeof ref.command === 'string';
}

function toActionContext(value: unknown): ActionContext {
  const raw = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;
  const context: ActionContext = {};
  if (isCommandRef(raw.ref)) context.ref = { extension: raw.ref.extension, command: raw.ref.command };
  if (typeof raw.rootItemId === 'string') context.rootItemId = raw.rootItemId;
  if (typeof raw.query === 'string') context.query = raw.query;
  return context;
}

/** Wires the renderer's `window.palette` API to the registry and the window. */
export function registerIpc(
  registry: CommandRegistry,
  launcher: LauncherWindow,
  options: { pasteIntoApps(): boolean },
): void {
  const fromLauncher = (event: Electron.IpcMainInvokeEvent | Electron.IpcMainEvent) =>
    event.sender === launcher.window.webContents;

  ipcMain.handle(IpcChannel.rootItems, (event) => {
    if (!fromLauncher(event)) throw new Error('Unexpected sender');
    return registry.getRootItems();
  });

  ipcMain.handle(IpcChannel.runAction, async (event, rawAction: unknown, rawContext: unknown) => {
    if (!fromLauncher(event)) throw new Error('Unexpected sender');
    const action = sanitizeAction(rawAction);
    if (!action) return { toast: 'Invalid action', toastStyle: 'failure' };
    const { copy, paste, ...result } = await registry.runAction(action, toActionContext(rawContext));
    const text = paste ?? copy;
    if (text !== undefined) {
      await clipboard.writeText(text);
      result.hide = true;
    }
    if (paste !== undefined && options.pasteIntoApps()) {
      // Hand the keyboard back to the app you were in, then paste there.
      launcher.hideAndReturnFocus();
      void pasteIntoFrontApp();
    } else if (result.hide) {
      launcher.hide();
    }
    return result;
  });

  ipcMain.handle(IpcChannel.searchView, (event, ref: unknown, query: unknown) => {
    if (!fromLauncher(event)) throw new Error('Unexpected sender');
    if (!isCommandRef(ref) || typeof query !== 'string') throw new Error('Invalid arguments');
    return registry.searchView(ref, query);
  });

  ipcMain.on(IpcChannel.hide, (event) => {
    if (fromLauncher(event)) launcher.hide();
  });

  ipcMain.on(IpcChannel.startDrag, (event) => {
    if (fromLauncher(event)) launcher.startDrag();
  });

  ipcMain.on(IpcChannel.endDrag, (event) => {
    if (fromLauncher(event)) launcher.endDrag();
  });
}
