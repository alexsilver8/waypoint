import { contextBridge, ipcRenderer } from 'electron';
import { type OnboardingApi, OnboardingChannel } from '../shared/onboarding';
import type { Platform } from '../shared/types';

function subscribe(channel: string, listener: () => void): () => void {
  const handler = () => listener();
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

const api: OnboardingApi = {
  platform: process.platform as Platform,
  get: () => ipcRenderer.invoke(OnboardingChannel.get),
  update: (patch) => ipcRenderer.invoke(OnboardingChannel.update, patch),
  setHotkey: (accelerator) => ipcRenderer.invoke(OnboardingChannel.setHotkey, accelerator),
  pauseHotkey: (paused) => ipcRenderer.send(OnboardingChannel.pauseHotkey, paused),
  checkAccessibility: () => ipcRenderer.invoke(OnboardingChannel.checkAccessibility),
  openAccessibility: () => ipcRenderer.send(OnboardingChannel.openAccessibility),
  openKeyboardSettings: () => ipcRenderer.send(OnboardingChannel.openKeyboardSettings),
  finish: (outcome) => ipcRenderer.send(OnboardingChannel.finish, outcome),
  onHotkeyPressed: (listener) => subscribe(OnboardingChannel.hotkeyPressed, listener),
  onChanged: (listener) => subscribe(OnboardingChannel.changed, listener),
};

contextBridge.exposeInMainWorld('onboarding', api);
