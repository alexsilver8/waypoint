import { app } from 'electron';
import { DEEPLINK_SCHEME } from '../../shared/notes';

/** Links that arrived before the app could open them. */
const pending: string[] = [];
let open: ((url: string) => void) | undefined;

/** The waypoint:// link among a copy of the app's arguments, if there is one. */
export function deeplinkIn(argv: readonly string[]): string | undefined {
  return argv.find((arg) => arg.toLowerCase().startsWith(`${DEEPLINK_SCHEME}://`));
}

/**
 * Starts listening for waypoint:// links, like the deeplinks Raycast copies for a note. Call
 * it before the app is ready: macOS can hand one over while the app launches. On Windows and
 * Linux a link starts a new copy of the app, so it's in the arguments instead.
 */
export function captureDeeplinks(): void {
  app.on('open-url', (event, url) => {
    event.preventDefault();
    if (open) open(url);
    else pending.push(url);
  });
  const launchedWith = deeplinkIn(process.argv);
  if (launchedWith) pending.push(launchedWith);
}

/** Opens links from now on, and any that arrived early. */
export function handleDeeplinks(handler: (url: string) => void): void {
  open = handler;
  for (const url of pending.splice(0)) handler(url);
}

/** Makes Waypoint the app for waypoint:// links. A development copy would register Electron itself, so it doesn't. */
export function registerDeeplinkScheme(): void {
  if (!app.isPackaged) return;
  try {
    if (!app.isDefaultProtocolClient(DEEPLINK_SCHEME)) app.setAsDefaultProtocolClient(DEEPLINK_SCHEME);
  } catch (error) {
    console.warn('[deeplinks] Could not register waypoint:// links:', error);
  }
}
