/**
 * Opening at login on Linux, the freedesktop.org way: an XDG Autostart entry, a `.desktop` file in
 * `~/.config/autostart` that GNOME, KDE, Xfce, Cinnamon and most other desktops start at login.
 * Electron's `app.setLoginItemSettings` does nothing on Linux.
 *
 * https://specifications.freedesktop.org/autostart-spec/latest/
 * https://specifications.freedesktop.org/desktop-entry-spec/latest/
 */
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, sep } from 'node:path';

/**
 * The entry's file name, from the app id. The deb's app-menu entry is `waypoint.desktop` (named after
 * the executable), and so is the copy GNOME Tweaks puts in autostart, so this one never takes their
 * place, and turning it off never removes one you added yourself.
 */
export const AUTOSTART_ID = 'dev.waypoint.app';

/** How the entry starts Waypoint. */
export interface AutostartCommand {
  /** The command line, unquoted. */
  args: string[];
  /** A program that has to exist for the entry to run (`TryExec`), so a deleted AppImage is skipped. */
  tryExec?: string;
  icon: string;
}

/** The `.desktop` file, under `$XDG_CONFIG_HOME/autostart` or `~/.config/autostart`. */
export function autostartFile(env: NodeJS.ProcessEnv, home: string): string {
  // Inside a Flatpak, XDG_CONFIG_HOME is the app's own folder; the desktop reads the real one.
  const configured = env.FLATPAK_ID ? env.HOST_XDG_CONFIG_HOME : env.XDG_CONFIG_HOME;
  // The spec says to ignore a relative path, as well as an empty one.
  const base = configured && isAbsolute(configured) ? configured : join(home, '.config');
  return join(base, 'autostart', `${AUTOSTART_ID}.desktop`);
}

const inside = (path: string, dir: string | undefined): dir is string =>
  !!dir && path.startsWith(dir.endsWith(sep) ? dir : dir + sep);

/**
 * What starts this copy of Waypoint again at login. An AppImage runs from a temporary mount, so the
 * entry points at the AppImage file itself; a Snap or a Flatpak goes through `snap run` or
 * `flatpak run`; anything else (the deb, an unpacked folder) through its executable. Those variables
 * also reach programs started from inside an AppImage or a Snap, so each only counts when Waypoint
 * itself runs from there. From source there is none: it would start Electron, not Waypoint.
 */
export function autostartCommand(options: {
  execPath: string;
  env: NodeJS.ProcessEnv;
  packaged: boolean;
}): AutostartCommand | null {
  const { execPath, env, packaged } = options;
  if (!packaged) return null;
  if (env.FLATPAK_ID && execPath.startsWith('/app/')) {
    return { args: ['flatpak', 'run', env.FLATPAK_ID], icon: env.FLATPAK_ID };
  }
  const snap = env.SNAP_INSTANCE_NAME || env.SNAP_NAME;
  if (snap && inside(execPath, env.SNAP)) return { args: ['snap', 'run', snap], icon: 'waypoint' };
  if (env.APPIMAGE && inside(execPath, env.APPDIR)) {
    return { args: [env.APPIMAGE], tryExec: env.APPIMAGE, icon: 'waypoint' };
  }
  return { args: [execPath], tryExec: execPath, icon: 'waypoint' };
}

/** Escapes a `string` value: backslashes, line breaks, tabs, and a leading space. */
export function escapeValue(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/\t/g, '\\t')
    .replace(/\r/g, '\\r')
    .replace(/^ /, '\\s');
}

const UNESCAPED: Record<string, string> = { '\\': '\\', n: '\n', t: '\t', r: '\r', s: ' ' };

export function unescapeValue(value: string): string {
  return value.replace(/\\([\\ntrs])/g, (_match, code: string) => UNESCAPED[code] as string);
}

/** Characters that mean an `Exec` argument has to be quoted. */
const RESERVED = /[\s"'\\><~|&;$*?#()`]/;

/** One `Exec` argument: `%` doubled, and in double quotes with `"`, `` ` ``, `$` and `\` escaped if needed. */
export function quoteExecArg(arg: string): string {
  const literal = arg.replace(/%/g, '%%');
  if (literal && !RESERVED.test(literal)) return literal;
  return `"${literal.replace(/["`$\\]/g, '\\$&')}"`;
}

/**
 * The `Exec` value for a command line, as written in the file. The string escapes apply on top of
 * the quoting, so a backslash in a path is written as four.
 */
export function formatExec(args: string[]): string {
  return escapeValue(args.map(quoteExecArg).join(' '));
}

/** Reads an `Exec` value back into the command line, without field codes such as `%U`. */
export function parseExec(value: string): string[] {
  const exec = unescapeValue(value);
  const args: string[] = [];
  let current = '';
  let started = false;
  let quoted = false;
  for (let i = 0; i < exec.length; i++) {
    const ch = exec[i] as string;
    if (quoted) {
      const next = exec[i + 1];
      if (ch === '\\' && next !== undefined && '"`$\\'.includes(next)) {
        current += next;
        i++;
      } else if (ch === '"') quoted = false;
      else current += ch;
    } else if (ch === '"') {
      quoted = true;
      started = true;
    } else if (/\s/.test(ch)) {
      if (started) args.push(current);
      current = '';
      started = false;
    } else {
      current += ch;
      started = true;
    }
  }
  if (started) args.push(current);
  return args
    .filter((arg) => !/^%[a-zA-Z]$/.test(arg))
    .map((arg) => arg.replace(/%([\s\S])/g, (_match, code: string) => (code === '%' ? '%' : '')));
}

/** The whole entry, for a new file. */
export function autostartEntry(command: AutostartCommand): string {
  const lines = [
    '# Added by Waypoint for Settings → Open at login. Turning that off removes this file.',
    '[Desktop Entry]',
    'Type=Application',
    'Name=Waypoint',
    'Comment=Keyboard-first launcher, ready in the tray when you log in',
    `Exec=${formatExec(command.args)}`,
    ...(command.tryExec ? [`TryExec=${escapeValue(command.tryExec)}`] : []),
    `Icon=${escapeValue(command.icon)}`,
    'Terminal=false',
    'NoDisplay=false',
    'Hidden=false',
    'X-GNOME-Autostart-enabled=true',
  ];
  return `${lines.join('\n')}\n`;
}

/**
 * Calls `visit` with each `key=value` line of the `[Desktop Entry]` group. A string it returns
 * replaces the line, and `null` removes it.
 */
function eachEntryKey(text: string, visit: (key: string, value: string) => string | null | undefined): string {
  let inEntry = false;
  const lines: string[] = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('[')) inEntry = trimmed === '[Desktop Entry]';
    const eq = line.indexOf('=');
    const replaced =
      !inEntry || trimmed.startsWith('#') || eq === -1
        ? undefined
        : visit(line.slice(0, eq).trim(), line.slice(eq + 1).trim());
    if (replaced !== null) lines.push(replaced ?? line);
  }
  return lines.join('\n');
}

/** What an existing entry says: whether it's on, and what it runs. */
export function readAutostartEntry(text: string): { enabled: boolean; exec?: string[] } {
  const keys = new Map<string, string>();
  eachEntryKey(text, (key, value) => {
    if (!keys.has(key)) keys.set(key, value);
    return undefined;
  });
  // Desktops turn an entry off with either of these, rather than deleting it.
  const enabled = keys.get('Hidden') !== 'true' && keys.get('X-GNOME-Autostart-enabled') !== 'false';
  const exec = keys.get('Exec');
  return exec === undefined ? { enabled } : { enabled, exec: parseExec(exec) };
}

/** Whether `exec` runs `command`, perhaps with something around it, like `env` or extra flags. */
export function runsCommand(exec: string[], command: string[]): boolean {
  for (let start = 0; start + command.length <= exec.length; start++) {
    if (command.every((arg, i) => exec[start + i] === arg)) return true;
  }
  return false;
}

/** The entry pointed at `command`, keeping everything else in it as it is. */
export function withCommand(text: string, command: AutostartCommand): string {
  return eachEntryKey(text, (key) => {
    if (key === 'Exec') return `Exec=${formatExec(command.args)}`;
    if (key === 'TryExec') return command.tryExec ? `TryExec=${escapeValue(command.tryExec)}` : null;
    return undefined;
  });
}

/** Waypoint's autostart entry: on when the file is there and no desktop has turned it off. */
export class LinuxLoginItem {
  constructor(
    readonly file: string,
    private readonly command: AutostartCommand,
  ) {}

  isEnabled(): boolean {
    try {
      const text = this.read();
      return text !== undefined && readAutostartEntry(text).enabled;
    } catch {
      return false;
    }
  }

  /**
   * Writes the entry or removes it. An entry that's already on and runs this copy is left alone, so
   * changes you made to it stay; one that runs something else (an AppImage since moved) gets this
   * copy's `Exec`. Throws if the file can't be written or removed.
   */
  set(enabled: boolean): void {
    if (!enabled) {
      rmSync(this.file, { force: true });
      return;
    }
    const text = this.read();
    const existing = text === undefined ? undefined : readAutostartEntry(text);
    if (text !== undefined && existing?.enabled && existing.exec) {
      if (!runsCommand(existing.exec, this.command.args)) this.write(withCommand(text, this.command));
    } else {
      this.write(autostartEntry(this.command));
    }
  }

  /** Turns it on or off, logging why if that fails. Returns whether it's on afterwards, from the file. */
  sync(enabled: boolean): boolean {
    try {
      this.set(enabled);
    } catch (error) {
      console.warn(`[login item] Could not ${enabled ? 'write' : 'remove'} ${this.file}: ${(error as Error).message}`);
    }
    return this.isEnabled();
  }

  private read(): string | undefined {
    try {
      return readFileSync(this.file, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
  }

  /** Through a temporary file and a rename, so a half-written entry never runs. */
  private write(text: string): void {
    mkdirSync(dirname(this.file), { recursive: true });
    const temporary = `${this.file}.${process.pid}.tmp`;
    try {
      writeFileSync(temporary, text);
      renameSync(temporary, this.file);
    } finally {
      rmSync(temporary, { force: true });
    }
  }
}
