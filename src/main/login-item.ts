import { homedir } from 'node:os';
import { app } from 'electron';
import type { Settings } from '../shared/settings';
import type { Platform } from '../shared/types';
import { autostartCommand, autostartFile, LinuxLoginItem } from './login-item/linux';
import type { SettingsStore } from './settings';

/**
 * Whether this copy can open at login: the installed app can, on every system. From source it
 * would register Electron itself rather than Waypoint (and macOS refuses: "Operation not permitted").
 */
export function canLaunchAtLogin(): boolean {
  return app.isPackaged;
}

/** Turns opening at login on or off. Returns whether Waypoint opens at login afterwards. */
function setOpenAtLogin(platform: Platform, openAtLogin: boolean): boolean {
  if (platform === 'linux') {
    const command = autostartCommand({ execPath: process.execPath, env: process.env, packaged: app.isPackaged });
    if (!command) return false;
    return new LinuxLoginItem(autostartFile(process.env, homedir()), command).sync(openAtLogin);
  }
  try {
    if (app.getLoginItemSettings().openAtLogin !== openAtLogin) app.setLoginItemSettings({ openAtLogin });
  } catch (error) {
    console.warn('[login item] Could not update:', error);
  }
  // Taken as done: macOS may report it off until it's allowed under Login Items in System Settings.
  return openAtLogin;
}

/**
 * Makes the system open Waypoint at login, or not, as the setting says. That happens at startup
 * (where the setting wins if they disagree, and an AppImage that moved is pointed at again) and when
 * the setting changes, but not on every other change, so it doesn't undo what you change in the
 * system's own startup settings meanwhile. Opened at login, Waypoint starts in the tray, as it does
 * whenever the installed app starts without `--show`.
 *
 * If it can't be done (a read-only home folder, say), the reason is logged and the setting goes
 * back to what will really happen, so the toggle doesn't say otherwise.
 */
export function syncLoginItem(platform: Platform, store: SettingsStore, current: Settings, previous?: Settings): void {
  if (!canLaunchAtLogin() || current.launchAtLogin === previous?.launchAtLogin) return;
  const enabled = setOpenAtLogin(platform, current.launchAtLogin);
  if (enabled === current.launchAtLogin) return;
  try {
    store.update({ launchAtLogin: enabled });
  } catch (error) {
    console.warn('[login item] Could not save the setting:', error);
  }
}
