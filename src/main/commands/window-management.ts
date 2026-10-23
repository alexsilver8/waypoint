import { BrowserWindow, Notification, screen, systemPreferences } from 'electron';
import type { ActionResult, CommandImplementation, Platform, WindowIconName } from '../../shared/types';
import { FOCUS_DELAY_MS } from '../paste';
import type { LauncherWindow } from '../window';
import { delay, type WindowBackend, WindowError } from '../windows/backend';
import type { Rect } from '../windows/layout';
import { macBackend } from '../windows/macos';
import { type WindowCommand, WindowManager } from '../windows/manager';
import { PowerShellWindows } from '../windows/win32';
import { isWayland, x11Backend } from '../windows/x11';
import type { BuiltinExtension } from './types';

interface WindowCommandInfo {
  command: WindowCommand;
  title: string;
  keywords?: string[];
}

/** In the order they're listed. Every command's name is its layout. */
const COMMANDS: WindowCommandInfo[] = [
  { command: 'left-half', title: 'Left Half' },
  { command: 'right-half', title: 'Right Half' },
  { command: 'top-half', title: 'Top Half' },
  { command: 'bottom-half', title: 'Bottom Half' },
  { command: 'center-half', title: 'Center Half', keywords: ['centre', 'middle'] },
  { command: 'top-left', title: 'Top Left Quarter' },
  { command: 'top-right', title: 'Top Right Quarter' },
  { command: 'bottom-left', title: 'Bottom Left Quarter' },
  { command: 'bottom-right', title: 'Bottom Right Quarter' },
  { command: 'first-third', title: 'First Third' },
  { command: 'center-third', title: 'Center Third', keywords: ['centre', 'middle'] },
  { command: 'last-third', title: 'Last Third' },
  { command: 'first-two-thirds', title: 'First Two Thirds' },
  { command: 'center-two-thirds', title: 'Center Two Thirds', keywords: ['centre', 'middle'] },
  { command: 'last-two-thirds', title: 'Last Two Thirds' },
  { command: 'top-left-sixth', title: 'Top Left Sixth' },
  { command: 'top-center-sixth', title: 'Top Center Sixth', keywords: ['centre', 'middle'] },
  { command: 'top-right-sixth', title: 'Top Right Sixth' },
  { command: 'bottom-left-sixth', title: 'Bottom Left Sixth' },
  { command: 'bottom-center-sixth', title: 'Bottom Center Sixth', keywords: ['centre', 'middle'] },
  { command: 'bottom-right-sixth', title: 'Bottom Right Sixth' },
  { command: 'maximize', title: 'Maximize', keywords: ['maximise'] },
  { command: 'almost-maximize', title: 'Almost Maximize', keywords: ['almost maximise'] },
  { command: 'center', title: 'Center', keywords: ['centre', 'middle'] },
  { command: 'make-larger', title: 'Make Larger', keywords: ['bigger', 'grow', 'resize'] },
  { command: 'make-smaller', title: 'Make Smaller', keywords: ['shrink', 'resize'] },
  { command: 'next-display', title: 'Next Display', keywords: ['monitor'] },
  { command: 'previous-display', title: 'Previous Display', keywords: ['monitor'] },
  { command: 'restore', title: 'Restore' },
];

/** Typing "window" lists them all. Kept short: these act at once, so a common word shouldn't pick one. */
const SHARED_KEYWORDS = ['window', 'snap'];

/** Electron's work areas in real pixels, which is what X11 uses. */
function pixelWorkAreas(): Rect[] {
  return screen.getAllDisplays().map(({ workArea: area, scaleFactor: scale }) => ({
    x: Math.round(area.x * scale),
    y: Math.round(area.y * scale),
    width: Math.round(area.width * scale),
    height: Math.round(area.height * scale),
  }));
}

/** Waypoint's own windows (Notes, Settings) are moved directly. */
function ownWindowBackend(window: BrowserWindow): WindowBackend {
  return {
    async front() {
      return {
        window: { id: String(window.id), key: `own:${window.id}`, bounds: window.getBounds() },
        displays: screen.getAllDisplays().map((display) => display.workArea),
      };
    },
    async move(_target, bounds) {
      if (window.isDestroyed()) throw new WindowError('That window has closed.');
      if (window.isFullScreen()) window.setFullScreen(false);
      if (window.isMaximized()) window.unmaximize();
      window.setBounds(bounds);
    },
  };
}

function systemBackend(platform: Platform): WindowBackend | undefined {
  switch (platform) {
    case 'darwin':
      return macBackend(() => screen.getAllDisplays().map((display) => display.workArea));
    case 'win32':
      return new PowerShellWindows();
    case 'linux':
      return x11Backend(pixelWorkAreas);
    default:
      return undefined;
  }
}

/** The launcher is hidden by the time a move fails, so the reason comes as a notification. */
function report(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  if (!(error instanceof WindowError)) console.error('[windows]', error);
  if (Notification.isSupported()) new Notification({ title: "Couldn't move the window", body: message }).show();
}

interface WindowManagementOptions {
  platform: Platform;
  launcher: () => LauncherWindow;
}

/**
 * Snaps the window you were using to halves, thirds, quarters, sixths and other displays, or
 * grows and shrinks it. The launcher steps aside first, so the window in front is yours.
 */
export function windowManagementExtension({ platform, launcher }: WindowManagementOptions): BuiltinExtension {
  const manager = new WindowManager();
  let backend: WindowBackend | undefined;

  /** Problems known before the launcher hides, shown in it rather than as a notification. */
  const preflight = (): string | undefined => {
    if (platform === 'linux' && isWayland()) {
      return "Wayland doesn't let apps move other apps' windows. Log in with an X11 session to use this.";
    }
    if (platform === 'darwin' && !systemPreferences.isTrustedAccessibilityClient(false)) {
      // Shows macOS's "allow Waypoint to control your computer" prompt.
      systemPreferences.isTrustedAccessibilityClient(true);
      return 'Allow Waypoint in System Settings → Privacy & Security → Accessibility, then try again.';
    }
    return undefined;
  };

  const run = async (command: WindowCommand): Promise<ActionResult> => {
    const problem = preflight();
    if (problem) return { toast: problem, toastStyle: 'failure' };
    const palette = launcher();
    palette.hideAndReturnFocus();
    await delay(FOCUS_DELAY_MS);
    const own = BrowserWindow.getFocusedWindow();
    try {
      if (own && own !== palette.window && !own.isDestroyed()) {
        await manager.apply(ownWindowBackend(own), command);
      } else {
        backend ??= systemBackend(platform);
        if (!backend) throw new WindowError('Moving windows isn’t available on this system.');
        await manager.apply(backend, command);
      }
    } catch (error) {
      report(error);
    }
    return { hide: true };
  };

  const commands: Record<string, CommandImplementation> = {};
  for (const { command } of COMMANDS) commands[command] = { run: () => run(command) };

  return {
    manifest: {
      name: 'window-management',
      title: 'Window Management',
      icon: { builtin: 'window-left-half', tint: 'blue' },
      commands: COMMANDS.map(({ command, title, keywords }) => ({
        name: command,
        title,
        mode: 'no-view' as const,
        icon: { builtin: `window-${command}` as WindowIconName, tint: 'blue' as const },
        keywords: [...SHARED_KEYWORDS, ...(keywords ?? [])],
      })),
    },
    commands,
  };
}
