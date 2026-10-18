import { contextBridge, ipcRenderer } from 'electron';
import { type CommandRequest, IpcChannel, type PaletteApi, type ShownInfo, type ToastMessage } from '../shared/ipc';
import type { Platform } from '../shared/types';

function subscribe<T extends unknown[]>(channel: string, listener: (...args: T) => void): () => void {
  const handler = (_event: Electron.IpcRendererEvent, ...args: unknown[]) => listener(...(args as T));
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

// A `--command` at launch can arrive before the page listens; it waits here until it does.
const commandRequests: CommandRequest[] = [];
let commandListener: ((request: CommandRequest) => void) | undefined;
ipcRenderer.on(IpcChannel.runCommand, (_event, request: CommandRequest) => {
  if (commandListener) commandListener(request);
  else commandRequests.push(request);
});

const api: PaletteApi = {
  platform: process.platform as Platform,
  getRootItems: () => ipcRenderer.invoke(IpcChannel.rootItems),
  runAction: (action, context) => ipcRenderer.invoke(IpcChannel.runAction, action, context),
  searchView: (ref, query) => ipcRenderer.invoke(IpcChannel.searchView, ref, query),
  getExchangeRates: () => ipcRenderer.invoke(IpcChannel.exchangeRates),
  hide: () => ipcRenderer.send(IpcChannel.hide),
  startDrag: () => ipcRenderer.send(IpcChannel.startDrag),
  endDrag: () => ipcRenderer.send(IpcChannel.endDrag),
  onShown: (listener) => subscribe<[ShownInfo]>(IpcChannel.shown, listener),
  onHidden: (listener) => subscribe(IpcChannel.hidden, listener),
  onRootItemsChanged: (listener) => subscribe(IpcChannel.rootItemsChanged, listener),
  onExchangeRatesChanged: (listener) => subscribe(IpcChannel.exchangeRatesChanged, listener),
  onToast: (listener) => subscribe<[ToastMessage]>(IpcChannel.toast, listener),
  onRunCommand: (listener) => {
    commandListener = listener;
    for (const request of commandRequests.splice(0)) listener(request);
    return () => {
      if (commandListener === listener) commandListener = undefined;
    };
  },
};

contextBridge.exposeInMainWorld('palette', api);
