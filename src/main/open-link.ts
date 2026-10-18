/** Opening a quicklink: a web address, an app's link or a path, with the app it names or the system's choice. */
import { execFile, spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { posix, win32 } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isBareDomain } from '../shared/quicklinks';
import type { Platform } from '../shared/types';
import { execToArgv, parseDesktopEntry } from './apps/desktop-entry';

export type LinkTarget = { type: 'url'; url: string } | { type: 'path'; path: string };

const SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const BLOCKED_SCHEMES = new Set(['javascript:', 'data:', 'vbscript:', 'blob:']);

function isAbsolutePath(path: string, platform: Platform): boolean {
  return platform === 'win32' ? win32.isAbsolute(path) && !path.startsWith('/') : posix.isAbsolute(path);
}

/** What a quicklink, placeholders filled in, points at. Throws when it's neither a link nor a path. */
export function linkTarget(link: string, platform: Platform, home: string): LinkTarget {
  const value = link.trim();
  if (value === '~' || /^~[\\/]/.test(value)) {
    const join = platform === 'win32' ? win32.join : posix.join;
    return { type: 'path', path: join(home, value.slice(1)) };
  }
  if (isAbsolutePath(value, platform)) return { type: 'path', path: value };
  if (/^file:/i.test(value)) {
    try {
      return { type: 'path', path: fileURLToPath(value, { windows: platform === 'win32' }) };
    } catch {
      throw new Error(`Not a file link: ${value}`);
    }
  }
  if (SCHEME.test(value) && !/^[a-z]:[\\/]/i.test(value)) {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new Error(`Not a valid link: ${value}`);
    }
    if (BLOCKED_SCHEMES.has(url.protocol)) throw new Error(`Can't open ${url.protocol} links.`);
    // As the URL parser writes it: spaces and quotes in a web address are percent-encoded.
    return { type: 'url', url: url.href };
  }
  if (isBareDomain(value)) return { type: 'url', url: new URL(`https://${value}`).href };
  throw new Error(`Not a link or a path: ${value}`);
}

export interface LaunchCommand {
  file: string;
  args: string[];
  /** Environment variables to add, for values a command reads rather than has written into it. */
  env?: Record<string, string>;
}

/**
 * One argument as Windows programs split their command line (`CommandLineToArgvW`): in quotes,
 * with any quote inside escaped and the backslashes before a quote, or the end, doubled. Nothing
 * in it can close the quotes and start another argument, like a switch for the app.
 */
export function windowsArgument(text: string): string {
  return `"${text.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, '$1$1')}"`;
}

/**
 * How to open a link or path with a given app: `open -a` on macOS, which takes the app's name or
 * path; PowerShell's Start-Process on Windows, which also follows Start menu shortcuts; and on
 * Linux `gio launch` for a `.desktop` file, or the program itself. Each is started with a list of
 * arguments, never through a shell's command line: on Windows the app and the target reach
 * PowerShell as environment variables, which it reads as values and never as code.
 */
export function openWithCommand(platform: Platform, app: string, target: string): LaunchCommand {
  switch (platform) {
    case 'darwin':
      return { file: 'open', args: ['-a', app, target] };
    case 'win32':
      return {
        file: 'powershell.exe',
        args: [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          'Start-Process -FilePath $env:WAYPOINT_OPEN_APP -ArgumentList $env:WAYPOINT_OPEN_ARGUMENT',
        ],
        env: { WAYPOINT_OPEN_APP: app, WAYPOINT_OPEN_ARGUMENT: windowsArgument(target) },
      };
    default:
      return app.endsWith('.desktop') ? { file: 'gio', args: ['launch', app, target] } : { file: app, args: [target] };
  }
}

export interface InstalledApp {
  name: string;
  path: string;
}

/**
 * The app a quicklink names, by path or by name. macOS's `open -a` finds apps by name itself;
 * elsewhere the name is looked up among the installed apps. Throws when there's no such app.
 */
export function resolveApp(app: string, apps: readonly InstalledApp[], platform: Platform): string {
  if (platform === 'darwin' || isAbsolutePath(app, platform)) return app;
  const wanted = app.toLowerCase();
  const found = apps.find((candidate) => candidate.name.toLowerCase() === wanted);
  if (!found) throw new Error(`Couldn't find an app called “${app}”.`);
  return found.path;
}

function run({ file, args, env }: LaunchCommand): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      { timeout: 15_000, windowsHide: true, ...(env ? { env: { ...process.env, ...env } } : {}) },
      (error) => (error ? reject(error) : resolve()),
    );
  });
}

/** Starts a program and lets it run on its own, without waiting for it to exit. */
function launch({ file, args }: LaunchCommand): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { detached: true, stdio: 'ignore' });
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
}

/** Opens a `.desktop` file's program with the target, for when `gio` isn't installed. */
async function launchDesktopEntry(path: string, target: string): Promise<void> {
  const entry = parseDesktopEntry(await readFile(path, 'utf8'));
  const [file, ...args] = entry?.exec ? execToArgv(entry.exec) : [];
  if (!file) throw new Error('This app has no command to run.');
  await launch({ file, args: [...args, target] });
}

export interface OpenLinkDeps {
  platform: Platform;
  home: string;
  apps: () => readonly InstalledApp[];
  /** Electron's `shell`, read when it's used. */
  shell: {
    openExternal(url: string): Promise<void>;
    openPath(path: string): Promise<string>;
  };
}

/** Opens a quicklink, placeholders filled in, with `openWith` if it names an app. */
export async function openLink(link: string, openWith: string | undefined, deps: OpenLinkDeps): Promise<void> {
  const target = linkTarget(link, deps.platform, deps.home);
  const where = target.type === 'url' ? target.url : target.path;
  if (!openWith) {
    if (target.type === 'url') return deps.shell.openExternal(target.url);
    const error = await deps.shell.openPath(target.path);
    if (error) throw new Error(error);
    return;
  }
  const app = resolveApp(openWith, deps.apps(), deps.platform);
  const command = openWithCommand(deps.platform, app, where);
  try {
    // A program started directly keeps running; the helpers return once they've started the app.
    if (deps.platform === 'linux' && command.file === app) await launch(command);
    else await run(command);
  } catch (error) {
    const missing = (error as NodeJS.ErrnoException).code === 'ENOENT';
    if (deps.platform === 'linux' && missing && app.endsWith('.desktop')) return launchDesktopEntry(app, where);
    throw new Error(`Couldn't open it with ${openWith}.`);
  }
}
