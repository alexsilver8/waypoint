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
  onChanged: (listener) => {
    const handler = () => listener();
    ipcRenderer.on(SettingsChannel.changed, handler);
    return () => ipcRenderer.removeListener(SettingsChannel.changed, handler);
  },
};

contextBridge.exposeInMainWorld('settings', api);
