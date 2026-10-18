import { contextBridge, ipcRenderer } from 'electron';
import { IpcChannel, type PaletteApi, type ShownInfo, type ToastMessage } from '../shared/ipc';
import type { Platform } from '../shared/types';

function subscribe<T extends unknown[]>(channel: string, listener: (...args: T) => void): () => void {
  const handler = (_event: Electron.IpcRendererEvent, ...args: unknown[]) => listener(...(args as T));
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

const api: PaletteApi = {
  platform: process.platform as Platform,
  getRootItems: () => ipcRenderer.invoke(IpcChannel.rootItems),
  runAction: (action, context) => ipcRenderer.invoke(IpcChannel.runAction, action, context),
  searchView: (ref, query) => ipcRenderer.invoke(IpcChannel.searchView, ref, query),
  hide: () => ipcRenderer.send(IpcChannel.hide),
  startDrag: () => ipcRenderer.send(IpcChannel.startDrag),
  endDrag: () => ipcRenderer.send(IpcChannel.endDrag),
  onShown: (listener) => subscribe<[ShownInfo]>(IpcChannel.shown, listener),
  onRootItemsChanged: (listener) => subscribe(IpcChannel.rootItemsChanged, listener),
  onToast: (listener) => subscribe<[ToastMessage]>(IpcChannel.toast, listener),
};

contextBridge.exposeInMainWorld('palette', api);
