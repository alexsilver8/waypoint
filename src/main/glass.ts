import { release } from 'node:os';
import { join } from 'node:path';
import { app, type BrowserWindow, nativeTheme } from 'electron';

/**
 * How a window gets its frosted-glass look:
 * - `vibrancy`: macOS blurs whatever is behind the window.
 * - `acrylic`: Windows 11 (22H2 and later) does the same.
 * - `none`: no system blur (Linux, older Windows), so the page draws an opaque surface.
 */
export type Glass = 'vibrancy' | 'acrylic' | 'none';

/** Windows 11 22H2 is build 22621, the first with the acrylic material Electron uses. */
const FIRST_ACRYLIC_BUILD = 22621;

export function glassFor(platform: NodeJS.Platform = process.platform, osRelease: string = release()): Glass {
  if (platform === 'darwin') return 'vibrancy';
  if (platform === 'win32') {
    const build = Number(osRelease.split('.')[2]);
    return Number.isFinite(build) && build >= FIRST_ACRYLIC_BUILD ? 'acrylic' : 'none';
  }
  return 'none';
}

/** BrowserWindow options for the glass effect. */
export function glassWindowOptions(glass: Glass, frameless: boolean): Electron.BrowserWindowConstructorOptions {
  switch (glass) {
    case 'vibrancy':
      return { vibrancy: 'under-window', visualEffectState: 'active', backgroundColor: '#00000000' };
    case 'acrylic':
      return { backgroundMaterial: 'acrylic', backgroundColor: '#00000000' };
    case 'none':
      // A frameless window stays transparent so the page can draw rounded corners.
      return frameless
        ? { transparent: true, backgroundColor: '#00000000' }
        : { backgroundColor: nativeTheme.shouldUseDarkColors ? '#1e1e21' : '#f6f6f8' };
  }
}

/** Loads one of the renderer pages, telling it which glass it sits on. */
export function loadPage(
  window: BrowserWindow,
  page: 'index' | 'notes' | 'settings' | 'onboarding',
  glass: Glass,
): void {
  const query = { glass };
  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(`${process.env.ELECTRON_RENDERER_URL}/${page}.html?${new URLSearchParams(query)}`);
  } else {
    void window.loadFile(join(import.meta.dirname, `../renderer/${page}.html`), { query });
  }
}
