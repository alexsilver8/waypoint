/** Updates: how this copy of Waypoint gets new versions, and what to show about them. */
import type { Platform } from './types';

/**
 * How this copy updates:
 * - `install`: downloads new versions by itself and installs them when you restart or quit.
 * - `notify`: says a new version is out and takes you to its download.
 * - `off`: never checks (run from source).
 */
export type UpdateMode = 'install' | 'notify' | 'off';

export interface UpdateEnvironment {
  platform: Platform;
  /** Running the installed app, rather than from source. */
  packaged: boolean;
  /** Set by an AppImage when it runs. */
  appImage?: string;
}

/**
 * macOS only installs updates to an app signed with an Apple Developer ID, which Waypoint isn't yet,
 * so there it says when one is out. On Linux the AppImage can replace itself; a .deb belongs to the
 * system's package manager, which would ask for your password, so it says instead too.
 */
export function updateMode({ platform, packaged, appImage }: UpdateEnvironment): UpdateMode {
  if (!packaged) return 'off';
  if (platform === 'win32') return 'install';
  if (platform === 'linux' && appImage) return 'install';
  return 'notify';
}

/** Where updates stand. */
export type UpdateStatus =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'up-to-date' }
  /** A new version is out; in `notify` mode, to download yourself. */
  | { state: 'available'; version: string }
  | { state: 'downloading'; version: string; percent: number }
  /** Downloaded; it installs on restart. */
  | { state: 'ready'; version: string }
  | { state: 'error'; message: string };

export const RELEASES_URL = 'https://github.com/alexsilver8/waypoint/releases';

export function releaseUrl(version: string): string {
  return `${RELEASES_URL}/tag/v${version}`;
}

/** The tray's update item: what it says, and whether it does anything. */
export function updateMenuLabel(status: UpdateStatus, mode: UpdateMode): { label: string; enabled: boolean } {
  switch (status.state) {
    case 'checking':
      return { label: 'Checking for Updates…', enabled: false };
    case 'available':
      return mode === 'notify'
        ? { label: `Download Waypoint ${status.version}…`, enabled: true }
        : { label: `Downloading Waypoint ${status.version}…`, enabled: false };
    case 'downloading':
      return { label: `Downloading Waypoint ${status.version} (${Math.floor(status.percent)}%)…`, enabled: false };
    case 'ready':
      return { label: `Restart to Update to ${status.version}`, enabled: true };
    default:
      return { label: 'Check for Updates…', enabled: true };
  }
}

/** One line for Settings → About. */
export function updateDescription(status: UpdateStatus, mode: UpdateMode): string {
  switch (status.state) {
    case 'checking':
      return 'Checking for updates…';
    case 'up-to-date':
      return 'Waypoint is up to date.';
    case 'available':
      return mode === 'notify'
        ? `Waypoint ${status.version} is out. Download it to update.`
        : `Downloading Waypoint ${status.version}…`;
    case 'downloading':
      return `Downloading Waypoint ${status.version} (${Math.floor(status.percent)}%)…`;
    case 'ready':
      return `Waypoint ${status.version} is ready. It installs when you restart Waypoint.`;
    case 'error':
      return `Couldn't check for updates: ${status.message}`;
    default:
      return mode === 'install'
        ? 'New versions download by themselves and install when you restart.'
        : 'Waypoint tells you when a new version is out.';
  }
}
