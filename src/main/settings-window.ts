import { join } from 'node:path';
import { app, BrowserWindow } from 'electron';
import { type Glass, glassFor, glassWindowOptions, loadPage } from './glass';
import { showOnEverySpace } from './spaces';

const isMac = process.platform === 'darwin';

/** The Settings window. One at a time; opening it again brings it forward. */
export class SettingsWindow {
  private window: BrowserWindow | undefined;

  /** `onClosed`: e.g. so closing it mid-recording doesn't leave the shortcuts paused. */
  constructor(private readonly options: { onClosed?(): void } = {}) {}

  get webContents(): Electron.WebContents | undefined {
    return this.window?.webContents;
  }

  open(): void {
    const window = this.window ?? this.create();
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
    if (isMac) app.focus({ steal: true });
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
