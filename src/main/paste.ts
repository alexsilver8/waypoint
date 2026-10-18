import { execFile } from 'node:child_process';
import { Notification, systemPreferences } from 'electron';

/** A program that presses the paste shortcut in whichever app is in front. */
export interface PasteKeystroke {
  file: string;
  args: string[];
  /** Shown if it can't run, e.g. a tool that isn't installed. */
  missing?: string;
}

/** Whether this is a Wayland session rather than X11. */
export function isWayland(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.XDG_SESSION_TYPE === 'wayland' || (!!env.WAYLAND_DISPLAY && !env.DISPLAY);
}

/**
 * How to press paste in the frontmost app on each system, in the order to try them.
 * macOS asks System Events (which needs Accessibility permission), Windows uses SendKeys,
 * and Linux needs xdotool (X11) or wtype (Wayland).
 */
export function pasteKeystrokes(platform: NodeJS.Platform, env: NodeJS.ProcessEnv = process.env): PasteKeystroke[] {
  switch (platform) {
    case 'darwin':
      return [
        { file: 'osascript', args: ['-e', 'tell application "System Events" to keystroke "v" using command down'] },
      ];
    case 'win32':
      return [
        {
          file: 'powershell.exe',
          args: ['-NoProfile', '-NonInteractive', '-Command', "(New-Object -ComObject WScript.Shell).SendKeys('^v')"],
        },
      ];
    default: {
      const xdotool = {
        file: 'xdotool',
        args: ['key', '--clearmodifiers', 'ctrl+v'],
        missing: 'Install xdotool to paste straight into apps.',
      };
      const wtype = {
        file: 'wtype',
        args: ['-M', 'ctrl', 'v', '-m', 'ctrl'],
        missing: 'Install wtype to paste straight into apps.',
      };
      return isWayland(env) ? [wtype, xdotool] : [xdotool, wtype];
    }
  }
}

/** How long to give the previous app to come back to the front after the launcher hides. */
export const FOCUS_DELAY_MS = 150;

function run(keystroke: PasteKeystroke): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(keystroke.file, keystroke.args, { timeout: 5000, windowsHide: true }, (error) =>
      error ? reject(error) : resolve(),
    );
  });
}

let explained = false;

/** Says once per run why text was copied rather than pasted. */
function explain(body: string): void {
  if (explained || !Notification.isSupported()) return;
  explained = true;
  new Notification({ title: 'Copied, not pasted', body }).show();
}

/**
 * Presses paste in the app that's in front. The text must already be on the clipboard and
 * the launcher hidden. Resolves to whether it pasted; when it can't, the text stays on the
 * clipboard and a notification says how to fix it.
 */
export async function pasteIntoFrontApp(platform: NodeJS.Platform = process.platform): Promise<boolean> {
  if (platform === 'darwin' && !systemPreferences.isTrustedAccessibilityClient(false)) {
    // Asks macOS to show its "allow Waypoint to control your computer" prompt.
    if (!explained) systemPreferences.isTrustedAccessibilityClient(true);
    explain(
      'Press ⌘V to paste it. To paste straight into apps, turn on Waypoint in System Settings → Privacy & Security → Accessibility.',
    );
    return false;
  }
  await new Promise((resolve) => setTimeout(resolve, FOCUS_DELAY_MS));
  const shortcut = platform === 'darwin' ? '⌘V' : 'Ctrl+V';
  const keystrokes = pasteKeystrokes(platform);
  for (const keystroke of keystrokes) {
    try {
      await run(keystroke);
      return true;
    } catch (error) {
      // Not installed: try the next tool, and if none is, suggest the first.
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      console.warn(`[paste] ${keystroke.file} failed:`, error);
      const automation = /not authori[sz]ed|-1743/i.test(String((error as Error).message));
      explain(
        automation
          ? `Press ${shortcut} to paste it. To paste straight into apps, allow Waypoint to control System Events in System Settings → Privacy & Security → Automation.`
          : `Press ${shortcut} to paste it.`,
      );
      return false;
    }
  }
  const suggestion = keystrokes[0]?.missing;
  explain(suggestion ? `Press ${shortcut} to paste it. ${suggestion}` : `Press ${shortcut} to paste it.`);
  return false;
}
