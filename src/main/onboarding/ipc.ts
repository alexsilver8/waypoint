import { ipcMain, shell, systemPreferences } from 'electron';
import {
  type AccessibilityStatus,
  OnboardingChannel,
  type OnboardingOutcome,
  type OnboardingPatch,
  type OnboardingState,
  onboardingSteps,
} from '../../shared/onboarding';
import type { Platform } from '../../shared/types';
import { changeHotkey, type HotkeyManager } from '../hotkey';
import { isWayland } from '../paste';
import type { SettingsStore } from '../settings';
import type { OnboardingWindow } from './window';

/** The settings setup may change directly. */
const PATCHABLE: Array<keyof OnboardingPatch> = ['theme', 'launchAtLogin', 'clipboardHistory'];

/** System Settings → Privacy & Security → Accessibility. */
export const ACCESSIBILITY_PANE = 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility';
/** System Settings → Keyboard, whose Keyboard Shortcuts… holds Spotlight's. */
const KEYBOARD_PANE = 'x-apple.systempreferences:com.apple.Keyboard-Settings.extension';

export interface OnboardingIpcOptions {
  store: SettingsStore;
  window: OnboardingWindow;
  hotkeys: HotkeyManager;
  platform: Platform;
  canLaunchAtLogin: boolean;
  onFinish(outcome: OnboardingOutcome): void;
}

function accessibilityStatus(platform: Platform): AccessibilityStatus {
  if (platform !== 'darwin') return 'not-needed';
  return systemPreferences.isTrustedAccessibilityClient(false) ? 'allowed' : 'not-allowed';
}

/** Wires the setup window's `window.onboarding` API. */
export function registerOnboardingIpc(options: OnboardingIpcOptions): { notifyChanged(): void } {
  const { store, window, hotkeys, platform, canLaunchAtLogin, onFinish } = options;

  const check = (event: Electron.IpcMainInvokeEvent | Electron.IpcMainEvent) => {
    if (!window.webContents || event.sender !== window.webContents) throw new Error('Unexpected sender');
  };

  const state = (): OnboardingState => {
    const { hotkey, theme, launchAtLogin, clipboardHistory } = store.get();
    const activeHotkey = hotkeys.current;
    return {
      settings: { hotkey, theme, launchAtLogin, clipboardHistory },
      ...(activeHotkey ? { activeHotkey } : {}),
      steps: onboardingSteps(platform),
      accessibility: accessibilityStatus(platform),
      canLaunchAtLogin,
      wayland: platform === 'linux' && isWayland(),
    };
  };

  ipcMain.handle(OnboardingChannel.get, (event) => {
    check(event);
    return state();
  });

  ipcMain.handle(OnboardingChannel.update, (event, raw: unknown) => {
    check(event);
    // Only these keys get through; the store drops values of the wrong type.
    const patch: OnboardingPatch = {};
    if (typeof raw === 'object' && raw !== null) {
      for (const key of PATCHABLE) {
        if (key in raw) (patch as Record<string, unknown>)[key] = (raw as Record<string, unknown>)[key];
      }
    }
    store.update(patch);
    return state();
  });

  ipcMain.handle(OnboardingChannel.setHotkey, (event, accelerator: unknown) => {
    check(event);
    const error = changeHotkey(hotkeys, store, accelerator);
    return error ? { state: state(), error } : { state: state() };
  });

  ipcMain.on(OnboardingChannel.pauseHotkey, (event, paused: unknown) => {
    check(event);
    if (paused === true) hotkeys.pause();
    else hotkeys.resume();
  });

  ipcMain.handle(OnboardingChannel.checkAccessibility, (event) => {
    check(event);
    return accessibilityStatus(platform);
  });

  ipcMain.on(OnboardingChannel.openAccessibility, (event) => {
    check(event);
    if (platform !== 'darwin') return;
    // Asking puts Waypoint in the list, so there's only a switch to turn on. macOS shows its own
    // prompt just once, so open the page too.
    systemPreferences.isTrustedAccessibilityClient(true);
    void shell.openExternal(ACCESSIBILITY_PANE);
  });

  ipcMain.on(OnboardingChannel.openKeyboardSettings, (event) => {
    check(event);
    if (platform === 'darwin') void shell.openExternal(KEYBOARD_PANE);
  });

  ipcMain.on(OnboardingChannel.finish, (event, outcome: unknown) => {
    check(event);
    onFinish(outcome === 'finished' ? 'finished' : 'skipped');
  });

  return {
    notifyChanged: () => window.webContents?.send(OnboardingChannel.changed),
  };
}
