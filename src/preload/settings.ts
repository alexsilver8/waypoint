import { contextBridge, ipcRenderer } from 'electron';
import { type SettingsApi, SettingsChannel } from '../shared/settings-ipc';
import type { Platform } from '../shared/types';

const api: SettingsApi = {
  platform: process.platform as Platform,
  get: () => ipcRenderer.invoke(SettingsChannel.get),
  update: (patch) => ipcRenderer.invoke(SettingsChannel.update, patch),
  setHotkey: (accelerator) => ipcRenderer.invoke(SettingsChannel.setHotkey, accelerator),
  pauseHotkey: (paused) => ipcRenderer.send(SettingsChannel.pauseHotkey, paused),
  chooseFolder: (title) => ipcRenderer.invoke(SettingsChannel.chooseFolder, title),
  open: (location) => ipcRenderer.send(SettingsChannel.open, location),
  openLink: (link) => ipcRenderer.send(SettingsChannel.openLink, link),
  reloadExtensions: () => ipcRenderer.invoke(SettingsChannel.reloadExtensions),
  clearClipboard: () => ipcRenderer.invoke(SettingsChannel.clearClipboard),
  openOnboarding: () => ipcRenderer.send(SettingsChannel.openOnboarding),
  setCommandHotkey: (key, accelerator) => ipcRenderer.invoke(SettingsChannel.setCommandHotkey, key, accelerator),
  saveQuicklink: (draft) => ipcRenderer.invoke(SettingsChannel.saveQuicklink, draft),
  deleteQuicklink: (id) => ipcRenderer.invoke(SettingsChannel.deleteQuicklink, id),
  saveSnippet: (draft) => ipcRenderer.invoke(SettingsChannel.saveSnippet, draft),
  deleteSnippet: (id) => ipcRenderer.invoke(SettingsChannel.deleteSnippet, id),
  listApps: () => ipcRenderer.invoke(SettingsChannel.listApps),
  takeTarget: () => ipcRenderer.invoke(SettingsChannel.takeTarget),
  openAccessibility: () => ipcRenderer.send(SettingsChannel.openAccessibility),
  onChanged: (listener) => {
    const handler = () => listener();
    ipcRenderer.on(SettingsChannel.changed, handler);
    return () => ipcRenderer.removeListener(SettingsChannel.changed, handler);
  },
  onNavigate: (listener) => {
    const handler = () => listener();
    ipcRenderer.on(SettingsChannel.navigate, handler);
    return () => ipcRenderer.removeListener(SettingsChannel.navigate, handler);
  },
};

contextBridge.exposeInMainWorld('settings', api);
