import { join } from 'node:path';
import { app, BrowserWindow, screen } from 'electron';
import { OnboardingChannel } from '../../shared/onboarding';
import { glassWindowOptions, loadPage } from '../glass';
import { showOnEverySpace } from '../spaces';

// The panes take 840 × 580; the clear margin around them leaves room for their shadows.
const WIDTH = 880;
const HEIGHT = 620;

const isMac = process.platform === 'darwin';

/**
 * The setup window that opens on first launch. Like the launcher it's clear and the page draws
 * floating panes: the steps down the left, the step's name in a capsule along the top and the
 * step itself in the sheet below. One at a time; opening it again brings it forward.
 */
export class OnboardingWindow {
  private window: BrowserWindow | undefined;

  /** `onClosed` runs whenever the window closes, however that happened. */
  constructor(private readonly onClosed: () => void) {}

  get webContents(): Electron.WebContents | undefined {
    return this.window?.webContents;
  }

  get isOpen(): boolean {
    return this.window !== undefined;
  }

  open(): void {
    const window = this.window ?? this.create();
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
    if (isMac) app.focus({ steal: true });
  }

  /** The shortcut was pressed while setup is open: brings it forward and tells the page. */
  hotkeyPressed(): void {
    if (!this.window) return;
    this.open();
    this.window.webContents.send(OnboardingChannel.hotkeyPressed);
  }

  close(): void {
    this.window?.close();
  }

  private create(): BrowserWindow {
    // Centred on the display you're using.
    const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
    const window = new BrowserWindow({
      x: Math.round(area.x + (area.width - WIDTH) / 2),
      y: Math.round(area.y + (area.height - HEIGHT) / 2),
      width: WIDTH,
      height: HEIGHT,
      show: false,
      title: 'Welcome to Waypoint',
      frame: false,
      resizable: false,
      maximizable: false,
      fullscreenable: false,
      hasShadow: false,
      // Transparent, so only the panes show.
      ...glassWindowOptions('none', true),
      webPreferences: {
        preload: join(import.meta.dirname, '../preload/onboarding.cjs'),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        spellcheck: false,
      },
    });
    this.window = window;
    showOnEverySpace(window);
    window.once('ready-to-show', () => this.open());
    window.webContents.on('render-process-gone', (_event, details) => {
      console.error(`[onboarding] Renderer gone: ${details.reason}`);
      if (details.reason !== 'clean-exit') loadPage(window, 'onboarding', 'none');
    });
    window.on('closed', () => {
      this.window = undefined;
      this.onClosed();
    });
    loadPage(window, 'onboarding', 'none');
    return window;
  }
}
