/**
 * Puts the colour theme's stylesheet into every window: the launcher, Notes, Settings and setup,
 * the ones open now and any opened later. Each page loads tokens.css; this goes on top of it.
 */
import { app, BrowserWindow, type WebContents } from 'electron';
import { type ThemeColors, themeCss } from '../shared/themes';

export class WindowTheme {
  private css: string | undefined;
  /** The stylesheet each page has now, to take out when the theme changes. */
  private readonly inserted = new WeakMap<WebContents, string>();
  /** One change at a time per page, so a quick second change can't leave two stylesheets. */
  private readonly queue = new WeakMap<WebContents, Promise<void>>();

  constructor() {
    app.on('browser-window-created', (_event, window) => {
      // A page that loads, or loads again, starts without it.
      window.webContents.on('dom-ready', () => {
        this.inserted.delete(window.webContents);
        this.apply(window.webContents);
      });
    });
  }

  /** The colours to show, or none for the default look. */
  set(colors: ThemeColors | undefined): void {
    const css = colors ? themeCss(colors) : undefined;
    if (css === this.css) return;
    this.css = css;
    for (const window of BrowserWindow.getAllWindows()) this.apply(window.webContents);
  }

  private apply(contents: WebContents): void {
    const previous = this.queue.get(contents) ?? Promise.resolve();
    const next = previous.then(async () => {
      if (contents.isDestroyed()) return;
      const css = this.css;
      const old = this.inserted.get(contents);
      if (old !== undefined) {
        this.inserted.delete(contents);
        await contents.removeInsertedCSS(old);
      }
      if (css && !contents.isDestroyed()) this.inserted.set(contents, await contents.insertCSS(css));
    });
    // A page that went away mid-change has nothing to undo.
    this.queue.set(
      contents,
      next.catch(() => undefined),
    );
  }
}
