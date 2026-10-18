import { BrowserWindow, type Display } from 'electron';
import { showOnEverySpace } from './spaces';
import type { Guide } from './window-position';

const isMac = process.platform === 'darwin';

/**
 * The page that draws the guides: thin lines that read on light and dark desktops, and turn
 * the accent colour when the launcher sits on them.
 */
const PAGE = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>Waypoint guides</title>
<style>
  html, body { margin: 0; height: 100%; overflow: hidden; background: transparent; }
  .line {
    position: absolute;
    background: rgb(255 255 255 / 0.55);
    box-shadow: 0 0 0 0.5px rgb(0 0 0 / 0.3);
    transition: background-color 120ms ease, box-shadow 120ms ease;
  }
  .line--vertical { top: 0; bottom: 0; width: 1px; }
  .line--horizontal { left: 0; right: 0; height: 1px; }
  .line[data-snapped] { background: #8b9bff; box-shadow: 0 0 8px rgb(139 155 255 / 0.9); }
</style>
</head>
<body>
<script>
  window.render = (lines) => {
    document.body.replaceChildren(...lines.map((line) => {
      const element = document.createElement('div');
      element.className = 'line line--' + line.axis;
      element.style[line.axis === 'vertical' ? 'left' : 'top'] = line.at + 'px';
      if (line.snapped) element.dataset.snapped = '';
      return element;
    }));
  };
</script>
</body>
</html>`;

/**
 * The lines on screen that the launcher snaps to while you drag it, like Raycast's. A clear
 * window over the display's work area draws them; it ignores the mouse and never takes focus.
 */
export class DragGuides {
  private window: BrowserWindow | undefined;
  /** What the page shows now, so a drag that doesn't change the lines doesn't redraw them. */
  private drawn = '';

  /** Shows `guides` (in screen coordinates) over `display`, just below `launcher`. */
  show(display: Display, guides: Guide[], launcher: BrowserWindow): void {
    const window = this.window ?? this.create();
    const area = display.workArea;
    const bounds = window.getBounds();
    if (bounds.x !== area.x || bounds.y !== area.y || bounds.width !== area.width || bounds.height !== area.height) {
      window.setBounds(area);
    }
    const lines = guides.map((guide) => ({
      ...guide,
      at: guide.at - (guide.axis === 'vertical' ? area.x : area.y),
    }));
    const json = JSON.stringify(lines);
    if (json !== this.drawn) {
      this.drawn = json;
      this.draw(window, json);
    }
    if (!window.isVisible()) {
      window.showInactive();
      launcher.moveTop();
    }
  }

  hide(): void {
    if (this.window && !this.window.isDestroyed() && this.window.isVisible()) this.window.hide();
  }

  /** Whether the guides are on screen; for tests. */
  get visible(): boolean {
    return Boolean(this.window && !this.window.isDestroyed() && this.window.isVisible());
  }

  private draw(window: BrowserWindow, json: string): void {
    const { webContents } = window;
    const run = () => {
      webContents.executeJavaScript(`render(${json})`).catch(() => {
        // The window can close mid-drag when the app quits; there's nothing left to draw on.
      });
    };
    if (webContents.isLoading()) webContents.once('did-finish-load', run);
    else run();
  }

  private create(): BrowserWindow {
    const window = new BrowserWindow({
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      hasShadow: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      focusable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      enableLargerThanScreen: true,
      title: 'Waypoint guides',
      ...(isMac ? ({ type: 'panel' } as const) : {}),
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, spellcheck: false },
    });
    window.setIgnoreMouseEvents(true);
    showOnEverySpace(window);
    window.on('closed', () => {
      this.window = undefined;
      this.drawn = '';
    });
    void window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(PAGE)}`);
    this.window = window;
    return window;
  }
}
