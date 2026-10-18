import { join } from 'node:path';
import { app, BrowserWindow } from 'electron';
import { SettingsChannel, type SettingsTarget } from '../shared/settings-ipc';
import { type Glass, glassFor, glassWindowOptions, loadPage } from './glass';
import { showOnEverySpace } from './spaces';

const isMac = process.platform === 'darwin';

/** The Settings window. One at a time; opening it again brings it forward. */
export class SettingsWindow {
  private window: BrowserWindow | undefined;
  private target: SettingsTarget | undefined;

  /** `onClosed`: e.g. so closing it mid-recording doesn't leave the shortcuts paused. */
  constructor(private readonly options: { onClosed?(): void } = {}) {}

  get webContents(): Electron.WebContents | undefined {
    return this.window?.webContents;
  }

  /** Opens the window, at `target` if given: a section, and something to edit there. */
  open(target?: SettingsTarget): void {
    if (target) {
      // The page asks for it when it loads, or when told to now if it's already open.
      this.target = target;
      this.window?.webContents.send(SettingsChannel.navigate);
    }
    const window = this.window ?? this.create();
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
    if (isMac) app.focus({ steal: true });
  }

  /** Where the window was last asked to go, once. */
  takeTarget(): SettingsTarget | null {
    const target = this.target ?? null;
    this.target = undefined;
    return target;
  }

  private create(): BrowserWindow {
    // On macOS, Settings floats like the launcher: a clear window holding a sidebar pane and a
    // content sheet, with the window buttons in the sidebar. A clear window can't be resized, so
    // it has a fixed size; the sheet scrolls. Elsewhere it keeps its frame and system glass.
    const glass: Glass = isMac ? 'none' : glassFor();
    const window = new BrowserWindow({
      show: false,
      title: 'Waypoint Settings',
      fullscreenable: false,
      maximizable: false,
      ...(isMac
        ? ({
            width: 840,
            height: 620,
            resizable: false,
            transparent: true,
            backgroundColor: '#00000000',
            hasShadow: false,
            titleBarStyle: 'hiddenInset',
            trafficLightPosition: { x: 38, y: 38 },
          } as const)
        : ({
            width: 800,
            height: 580,
            minWidth: 660,
            minHeight: 440,
            autoHideMenuBar: true,
            ...glassWindowOptions(glass, false),
          } as const)),
      webPreferences: {
        preload: join(import.meta.dirname, '../preload/settings.cjs'),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        spellcheck: false,
      },
    });
    this.window = window;
    showOnEverySpace(window);
    window.once('ready-to-show', () => window.show());
    window.on('closed', () => {
      this.window = undefined;
      this.options.onClosed?.();
    });
    loadPage(window, 'settings', glass);
    return window;
  }
}
