import { join } from 'node:path';
import { app, BrowserWindow, screen } from 'electron';
import { type CommandRequest, IpcChannel, type ShownInfo, type ToastMessage } from '../shared/ipc';
import { DragGuides } from './drag-guides';
import { type Glass, glassWindowOptions, loadPage } from './glass';
import { showOnEverySpace } from './spaces';
import { launcherPosition, type Point, snapLauncher } from './window-position';

// The panes take 776 × 476; the clear margin around them leaves room for their shadows.
const WIDTH = 816;
const HEIGHT = 516;
const SIZE = { width: WIDTH, height: HEIGHT };
/** The clear margin between the window's edge and its panes (`.launcher` padding in styles.css). */
const PANE_INSET = 20;
/** How often the window catches up with the pointer while you drag it. */
const DRAG_FRAME_MS = 16;
/** After this long hidden, the launcher opens at the root again instead of where you left it. */
const RESET_AFTER_MS = 90_000;

const isMac = process.platform === 'darwin';

export interface LauncherWindowOptions {
  hideOnBlur: () => boolean;
}

/** The frameless launcher window, toggled by the global hotkey. */
export class LauncherWindow {
  readonly window: BrowserWindow;
  private hiddenAt = 0;
  private openedFromOwnWindow = false;
  /** Where you last dragged the launcher on each display, by display id, so it opens there again. */
  private readonly dragged = new Map<number, Point>();
  /** Where the launcher was put when it last opened, to tell whether it has been dragged since. */
  private placedAt: Point | null = null;
  /** While you drag the launcher: the timer that moves it with the pointer. */
  private dragTimer: NodeJS.Timeout | null = null;
  private readonly guides = new DragGuides();
  /** A toast that came while the launcher was hidden, where it would have gone unseen. */
  private pendingToast: ToastMessage | null = null;

  constructor(private readonly options: LauncherWindowOptions) {
    // The launcher draws its own floating panes, so the window itself is clear: system blur
    // would frost the whole rectangle around them, and the panes cast their own shadows.
    const glass: Glass = 'none';
    this.window = new BrowserWindow({
      width: WIDTH,
      height: HEIGHT,
      show: false,
      frame: false,
      resizable: false,
      maximizable: false,
      minimizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      hasShadow: false,
      // Transparent, so only the panes show.
      ...glassWindowOptions(glass, true),
      // On macOS a panel can float above full-screen apps.
      ...(isMac ? ({ type: 'panel' } as const) : {}),
      webPreferences: {
        preload: join(import.meta.dirname, '../preload/index.cjs'),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        spellcheck: false,
        // Keep the renderer responsive while hidden so it opens instantly.
        backgroundThrottling: false,
      },
    });

    showOnEverySpace(this.window);

    // If the page crashes, bring it back rather than leaving an empty window.
    this.window.webContents.on('render-process-gone', (_event, details) => {
      console.error(`[launcher] Renderer gone: ${details.reason}`);
      // It can't say the pointer was let go any more.
      this.endDrag();
      if (details.reason !== 'clean-exit') loadPage(this.window, 'index', glass);
    });

    this.window.on('blur', () => {
      this.endDrag();
      if (this.options.hideOnBlur() && !this.window.webContents.isDevToolsFocused()) this.hide();
    });

    loadPage(this.window, 'index', glass);
  }

  get visible(): boolean {
    return this.window.isVisible();
  }

  /** On screen and taking the keyboard, so its shortcut closes it rather than bringing it forward. */
  get inFront(): boolean {
    return this.visible && this.window.isFocused();
  }

  toggle(): void {
    if (this.visible && this.window.isFocused()) this.hide();
    else this.show();
  }

  show(): void {
    const info: ShownInfo = {
      reset: !this.visible && this.hiddenAt > 0 && Date.now() - this.hiddenAt > RESET_AFTER_MS,
    };
    if (!this.visible) {
      this.place();
      // Was one of our own windows (Notes, Settings) in front, or another app?
      const focused = BrowserWindow.getFocusedWindow();
      this.openedFromOwnWindow = focused !== null && focused !== this.window;
    }
    this.window.show();
    this.window.focus();
    if (isMac) app.focus({ steal: true });
    this.window.webContents.send(IpcChannel.shown, info);
    if (this.pendingToast) this.send(IpcChannel.toast, this.pendingToast);
    this.pendingToast = null;
  }

  hide(): void {
    this.endDrag();
    if (!this.visible) return;
    this.hiddenAt = Date.now();
    this.rememberDrag();
    this.window.hide();
    // The page can't tell by itself: with background throttling off it always counts as visible.
    this.window.webContents.send(IpcChannel.hidden);
    // Hand focus back to the app that was active before the launcher opened — unless
    // another of our windows (like Notes) is open and should keep it.
    const otherWindowOpen = BrowserWindow.getAllWindows().some((w) => w !== this.window && w.isVisible());
    if (isMac && !otherWindowOpen) app.hide();
  }

  /**
   * Hides the launcher and makes sure what you were using before is in front again, so a
   * paste lands there. On macOS, a visible Notes window would otherwise keep Waypoint the
   * active app; unless you opened the launcher from Notes, the whole app steps aside.
   */
  hideAndReturnFocus(): void {
    const wasVisible = this.visible;
    this.hide();
    if (wasVisible && isMac && !this.openedFromOwnWindow) app.hide();
  }

  /**
   * Tells the page the root items changed. A hidden launcher reloads them when it opens, so
   * it isn't told (a note being typed changes them every few keystrokes). Changes can also
   * arrive while the app quits, after the window is gone, when sending would throw.
   */
  rootItemsChanged(): void {
    if (!this.window.isDestroyed() && this.window.isVisible()) {
      this.window.webContents.send(IpcChannel.rootItemsChanged);
    }
  }

  /**
   * Shows a message in the launcher's footer, once the page has loaded. While the launcher is
   * hidden it waits for it to open, since it would time out unseen.
   */
  toast(message: ToastMessage): void {
    if (this.window.isDestroyed()) return;
    if (!this.visible) {
      this.pendingToast = message;
      return;
    }
    this.send(IpcChannel.toast, message);
  }

  /** Opens a command as if it was picked from the root search. Show the launcher first. */
  runCommand(request: CommandRequest): void {
    if (!this.window.isDestroyed()) this.send(IpcChannel.runCommand, request);
  }

  private send(channel: string, message: unknown): void {
    const { webContents } = this.window;
    if (webContents.isLoading()) webContents.once('did-finish-load', () => webContents.send(channel, message));
    else webContents.send(channel, message);
  }

  /**
   * Moves the launcher with the pointer, which the page saw pressed on its glass and moved, until
   * `endDrag`. Like Raycast, it snaps to guides (the display's center line, where the launcher
   * opens and the display's middle) and shows them while you drag.
   */
  startDrag(): void {
    this.endDrag();
    const pointer = screen.getCursorScreenPoint();
    const [x = 0, y = 0] = this.window.getPosition();
    const offset = { x: pointer.x - x, y: pointer.y - y };
    const follow = () => {
      if (this.window.isDestroyed()) {
        this.endDrag();
        return;
      }
      const now = screen.getCursorScreenPoint();
      const display = screen.getDisplayNearestPoint(now);
      const target = { x: now.x - offset.x, y: now.y - offset.y };
      const { position, guides } = snapLauncher(target, display.workArea, SIZE, PANE_INSET, now);
      const [currentX, currentY] = this.window.getPosition();
      if (currentX !== position.x || currentY !== position.y) this.window.setPosition(position.x, position.y);
      this.guides.show(display, guides, this.window);
    };
    this.dragTimer = setInterval(follow, DRAG_FRAME_MS);
    follow();
  }

  /** Stops moving the launcher with the pointer, and hides the guides. */
  endDrag(): void {
    if (this.dragTimer) clearInterval(this.dragTimer);
    this.dragTimer = null;
    this.guides.hide();
  }

  /** Whether the drag guides are on screen; for tests. */
  get guidesVisible(): boolean {
    return this.guides.visible;
  }

  /**
   * Puts the window on the display under the cursor: where you last dragged it on that display,
   * or else centered across and a bit above the middle.
   */
  private place(): void {
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    this.window.setBounds({ ...launcherPosition(display.workArea, SIZE, this.dragged.get(display.id)), ...SIZE });
    // Where the system actually put it, which can differ by a pixel from what was asked.
    const [x = 0, y = 0] = this.window.getPosition();
    this.placedAt = { x, y };
  }

  /** If the launcher was dragged since it opened, remembers where, for the display it's on. */
  private rememberDrag(): void {
    const [x = 0, y = 0] = this.window.getPosition();
    if (!this.placedAt || (x === this.placedAt.x && y === this.placedAt.y)) return;
    this.dragged.set(screen.getDisplayMatching(this.window.getBounds()).id, { x, y });
  }
}
