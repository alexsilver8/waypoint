import { contextBridge, ipcRenderer } from 'electron';
import { type NotesApi, NotesChannel } from '../shared/notes';
import type { Platform } from '../shared/types';

const api: NotesApi = {
  platform: process.platform as Platform,
  list: () => ipcRenderer.invoke(NotesChannel.list),
  create: (text) => ipcRenderer.invoke(NotesChannel.create, text),
  update: (id, text) => ipcRenderer.invoke(NotesChannel.update, id, text),
  flush: (id, text) => ipcRenderer.send(NotesChannel.flush, id, text),
  discardIfEmpty: (id) => ipcRenderer.invoke(NotesChannel.discardIfEmpty, id),
  delete: (id) => ipcRenderer.invoke(NotesChannel.delete, id),
  deleteAll: () => ipcRenderer.invoke(NotesChannel.deleteAll),
  listDeleted: () => ipcRenderer.invoke(NotesChannel.listDeleted),
  restore: (id) => ipcRenderer.invoke(NotesChannel.restore, id),
  purge: (id) => ipcRenderer.invoke(NotesChannel.purge, id),
  reveal: (id) => ipcRenderer.send(NotesChannel.reveal, id),
  getState: () => ipcRenderer.invoke(NotesChannel.getState),
  setState: (patch) => ipcRenderer.send(NotesChannel.setState, patch),
  setCurrent: (id) => ipcRenderer.send(NotesChannel.setCurrent, id),
  openLink: (url) => ipcRenderer.send(NotesChannel.openLink, url),
  copy: (content) => ipcRenderer.send(NotesChannel.copy, content),
  export: (file) => ipcRenderer.invoke(NotesChannel.export, file),
  fit: (heights) => ipcRenderer.send(NotesChannel.fit, heights),
  hide: () => ipcRenderer.send(NotesChannel.hide),
  onOpen: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, id: string) => listener(id);
    ipcRenderer.on(NotesChannel.open, handler);
    return () => ipcRenderer.removeListener(NotesChannel.open, handler);
  },
  onChanged: (listener) => {
    const handler = () => listener();
    ipcRenderer.on(NotesChannel.changed, handler);
    return () => ipcRenderer.removeListener(NotesChannel.changed, handler);
  },
};

contextBridge.exposeInMainWorld('notes', api);
