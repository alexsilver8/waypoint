import { join } from 'node:path';
import { app, BrowserWindow, screen } from 'electron';
import { NotesChannel, type NotesWindowState, normalizeNotesState } from '../../shared/notes';
import { glassFor, glassWindowOptions, loadPage } from '../glass';
import { debounce, readJsonFile, writeJsonFile } from '../json-file';
import { showOnEverySpace } from '../spaces';

const isMac = process.platform === 'darwin';

/** The size of Raycast Notes' window, in points. */
export const WINDOW_WIDTH = 475;
export const WINDOW_HEIGHT = 308;
const MIN_WIDTH = 360;
const MIN_HEIGHT = 120;
/** A long note grows the window up to this share of the screen, then scrolls. */
const MAX_SCREEN_SHARE = 0.75;
/** Saved state before version 2 was for the window with a sidebar, at a different size. */
const STATE_VERSION = 2;

interface SavedState extends NotesWindowState {
  version: number;
  /** Where the window is, and the size you gave it: auto-resizing never makes it smaller. */
  bounds?: Electron.Rectangle;
  currentId?: string;
}

function isRectangle(value: unknown): value is Electron.Rectangle {
  if (typeof value !== 'object' || value === null) return false;
  const { x, y, width, height } = value as Record<string, unknown>;
  return [x, y, width, height].every((n) => typeof n === 'number' && Number.isFinite(n));
}

/** Reads the saved state. State from before version 2 keeps its notes and position, not its size. */
export function readNotesState(raw: unknown): SavedState {
  const saved = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const current = saved.version === STATE_VERSION;
  // The old window didn't float unless you pinned it; Raycast's always does.
  const state: SavedState = {
    ...normalizeNotesState(current ? saved : { ...saved, alwaysOnTop: undefined }),
    version: STATE_VERSION,
  };
  if (isRectangle(saved.bounds)) {
    const { x, y } = saved.bounds;
    state.bounds = current ? saved.bounds : { x, y, width: WINDOW_WIDTH, height: WINDOW_HEIGHT };
  }
  if (typeof saved.currentId === 'string' && saved.currentId) state.currentId = saved.currentId;
  return state;
}

/**
 * The Notes window, laid out like Raycast Notes: one note at a time in a small floating
 * window that grows with what you write. There's one per app; closing it only hides it, so it
 * opens again instantly where you left off.
 */
export class NotesWindow {
  private window: BrowserWindow | undefined;
  private state: SavedState;
  private readonly save = debounce(() => writeJsonFile(this.statePath, this.state), 500);
  /** What the page last said it needs: the note's height, and an open popover's. */
  private heights = { content: 0, overlay: 0 };
  /** The height last set here, to tell auto-resizing apart from you resizing on Linux. */
  private lastHeight = 0;
  private quitting = false;

  constructor(private readonly statePath: string) {
    let saved: unknown;
    try {
      saved = readJsonFile(statePath);
    } catch {
      saved = undefined;
    }
    this.state = readNotesState(saved);
    app.on('before-quit', () => {
      this.quitting = true;
    });
  }

  get webContents(): Electron.WebContents | undefined {
    return this.window?.webContents;
  }

  getState(): SavedState {
    return this.state;
  }

  setState(patch: Partial<NotesWindowState>): void {
    const { version, bounds, currentId, alwaysOnTop, autoResize } = this.state;
    this.state = {
      ...normalizeNotesState({ ...this.state, ...patch }),
      version,
      ...(bounds ? { bounds } : {}),
      ...(currentId ? { currentId } : {}),
    };
    if (this.state.alwaysOnTop !== alwaysOnTop) this.applyAlwaysOnTop();
    if (this.state.autoResize !== autoResize) this.fitHeight();
    this.save();
  }

  setCurrent(id: string): void {
    this.state.currentId = id;
    this.save();
  }

  /** Shows the window, optionally on a specific note. */
  open(noteId?: string): void {
    const window = this.window ?? this.create();
    if (noteId) {
      this.state.currentId = noteId;
      const send = () => window.webContents.send(NotesChannel.open, noteId);
      if (window.webContents.isLoading()) window.webContents.once('did-finish-load', send);
      else send();
    }
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
    if (isMac) app.focus({ steal: true });
  }

  /** Hides the window and, on macOS, hands the keyboard back to the app you were in. */
  hide(): void {
    const window = this.window;
    if (!window || window.isDestroyed() || !window.isVisible()) return;
    window.hide();
    const otherWindowOpen = BrowserWindow.getAllWindows().some((other) => other !== window && other.isVisible());
    if (isMac && !otherWindowOpen) app.hide();
  }

  /** The page's heights changed: grow or shrink the window to fit. */
  fit(heights: { content: number; overlay: number }): void {
    this.heights = heights;
    this.fitHeight();
  }

  flushState(): void {
    this.save.flush();
  }

  private create(): BrowserWindow {
    const bounds = this.onScreen(this.state.bounds);
    const glass = glassFor();
    const window = new BrowserWindow({
      width: bounds?.width ?? WINDOW_WIDTH,
      height: bounds?.height ?? WINDOW_HEIGHT,
      ...(bounds ? { x: bounds.x, y: bounds.y } : {}),
      minWidth: MIN_WIDTH,
      minHeight: MIN_HEIGHT,
      show: false,
      title: 'Notes',
      fullscreenable: false,
      ...glassWindowOptions(glass, false),
      ...(isMac
        ? ({
            titleBarStyle: 'hiddenInset',
            trafficLightPosition: { x: 19, y: 19 },
            // Like Raycast's, the window only closes: minimize and zoom are greyed out.
            minimizable: false,
            maximizable: false,
          } as const)
        : ({ autoHideMenuBar: true } as const)),
      webPreferences: {
        preload: join(import.meta.dirname, '../preload/notes.cjs'),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        spellcheck: true,
        // A hidden window keeps working, so it opens instantly.
        backgroundThrottling: false,
      },
    });
    this.window = window;
    showOnEverySpace(window);
    this.applyAlwaysOnTop();

    // You resizing the window sets the height auto-resizing starts from, if you changed the
    // height: widening a window that grew with its note doesn't make that its smallest. Linux
    // has no will-resize, so there a height that isn't the one set here counts as yours.
    window.on('will-resize', (_event, next) => {
      const height = next.height === window.getBounds().height ? this.state.bounds?.height : next.height;
      this.state.bounds = { x: next.x, y: next.y, width: next.width, height: height ?? WINDOW_HEIGHT };
      this.save();
    });
    const rememberBounds = debounce(() => {
      if (window.isDestroyed()) return;
      const { x, y, width, height } = window.getBounds();
      const yours = process.platform === 'linux' && height !== this.lastHeight;
      const base = yours ? height : (this.state.bounds?.height ?? WINDOW_HEIGHT);
      this.state.bounds = { x, y, width, height: base };
      this.save();
    }, 300);
    window.on('move', rememberBounds);
    window.on('resize', rememberBounds);
    window.on('close', (event) => {
      if (this.quitting) return;
      event.preventDefault();
      this.hide();
    });
    window.on('closed', () => {
      this.window = undefined;
      this.save.flush();
    });
    window.webContents.on('render-process-gone', (_event, details) => {
      console.error(`[notes] Renderer gone: ${details.reason}`);
      if (details.reason !== 'clean-exit' && !window.isDestroyed()) loadPage(window, 'notes', glass);
    });

    loadPage(window, 'notes', glass);
    return window;
  }

  /** Saved bounds, unless the screen they were on is gone. */
  private onScreen(bounds: Electron.Rectangle | undefined): Electron.Rectangle | undefined {
    if (!bounds) return undefined;
    const area = screen.getDisplayMatching(bounds).workArea;
    const visible =
      bounds.x < area.x + area.width - 40 &&
      bounds.x + bounds.width > area.x + 40 &&
      bounds.y >= area.y - 8 &&
      bounds.y < area.y + area.height - 40;
    return visible ? bounds : { ...bounds, x: Math.round(area.x + (area.width - bounds.width) / 2), y: area.y + 80 };
  }

  /**
   * Fits the window to the note when auto-resizing is on, never below the height you gave it,
   * and makes room for an open popover. It grows downwards and stops at the bottom of the screen.
   */
  private fitHeight(): void {
    const window = this.window;
    if (!window || window.isDestroyed()) return;
    const outer = window.getBounds();
    // The page measures without the frame Windows and Linux draw around it.
    const frame = outer.height - window.getContentBounds().height;
    const area = screen.getDisplayMatching(outer).workArea;
    const room = area.y + area.height - outer.y;
    const base = this.state.bounds?.height ?? WINDOW_HEIGHT;
    const content = this.state.autoResize
      ? Math.min(this.heights.content + frame, room, Math.round(area.height * MAX_SCREEN_SHARE))
      : 0;
    const overlay = Math.min(this.heights.overlay + frame, room);
    const height = Math.round(Math.max(base, content, overlay, MIN_HEIGHT));
    if (height === outer.height) return;
    this.lastHeight = height;
    window.setBounds({ ...outer, height }, isMac);
  }

  /** The window floats above other windows unless you turn it off, as in Raycast. */
  private applyAlwaysOnTop(): void {
    const window = this.window;
    if (!window) return;
    window.setAlwaysOnTop(this.state.alwaysOnTop, 'floating');
  }
}
